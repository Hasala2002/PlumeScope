"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  DollarSign,
  Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Sliders as SlidersIcon } from "@geist-ui/icons";
import ReactMarkdown from "react-markdown";
import { askGemini, validateMarkdown, generateOptimizationPlan } from "@/lib/gemini";
import { api } from "@/lib/api";

/* ----------------------------- Validation ------------------------------ */

const budgetSchema = z.object({
  budget: z
    .number()
    .refine((v) => Number.isFinite(v), { message: "Budget is required" })
    .positive("Budget must be positive")
    .min(1000, "Budget must be at least 1,000")
    .max(100000000, "Budget must not exceed 100,000,000"),
});

type BudgetFormData = z.infer<typeof budgetSchema>;

/* ------------------------------ Types/API ------------------------------ */

interface OptimizeItem {
  id: string;
  cost: number;
  benefit: number;
}
interface OptimizeResponse {
  picks?: OptimizeItem[];
  totalGain?: number;
  remainingBudget?: number;
}

// Site analytics types for Gemini context
interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  CO2e_tpy: number;
  CH4_tpy: number;
  EmissionsScore: number;
  FloodScore: number;
  HeatScore: number;
  DroughtScore: number;
  Risk: number;
}

type HazardSnapshot = {
  flood: 0 | 1;
  dm: "None" | "D0" | "D1" | "D2" | "D3" | "D4";
  heatIndex: number;
  ts: number;
};

interface LiveScoreResponse {
  meta: { cacheHits: number; duration_ms: number };
  items: (Site & { HazardSnapshot: HazardSnapshot })[];
}

async function optimizeBudget(budget: number): Promise<OptimizeResponse> {
  const { data } = await axios.post<OptimizeResponse>(
    `http://localhost:3001/optimize?budget=${budget}`
  );
  return data;
}

async function fetchScoreLive(): Promise<Site[]> {
  const { data } = await api.get<LiveScoreResponse>("/score/live");
  return data.items;
}

/* ------------------------------ Utilities ------------------------------ */

const BUDGET_MIN = 1_000;
const BUDGET_MAX = 100_000_000;
const BUDGET_STEP = 1_000;

const presets = [
  100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000,
];

function clamp(n: number, min = BUDGET_MIN, max = BUDGET_MAX) {
  return Math.min(max, Math.max(min, n));
}

function formatCurrency(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/* -------------------------------- Page --------------------------------- */

export default function Page() {
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<BudgetFormData>({
    resolver: zodResolver(budgetSchema),
    defaultValues: { budget: 500_000 },
    mode: "onChange",
  });

  const budget = watch("budget");

  // Analytics data for Gemini context
  const { data: sites } = useQuery({
    queryKey: ["score-live"],
    queryFn: fetchScoreLive,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: optimizeBudget,
    onSuccess: async (data) => {
      const hasPicks = (data.picks?.length ?? 0) > 0;
      const nonZero = (data.totalGain ?? 0) > 0 || (data.remainingBudget ?? 0) > 0;
      if (!hasPicks && !nonZero) {
        try {
          const aiPlan = await generateOptimizationPlan(sites ?? [], budget ?? 0);
          setResult({
            picks: aiPlan.picks,
            totalGain: aiPlan.totalGain,
            remainingBudget: aiPlan.remainingBudget,
          });
        } catch {
          setResult(data);
        }
      } else {
        setResult(data);
      }
    },
  });

  const onSubmit = (data: BudgetFormData) => {
    // reset previous report when re-running optimization
    setReport(null);
    setReportError(null);
    mutation.mutate(data.budget);
  };

  const bump = (delta: number) => {
    setValue("budget", clamp((budget ?? 0) + delta), {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    bump(dir * BUDGET_STEP);
  };

  const onArrow = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      bump(BUDGET_STEP);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bump(-BUDGET_STEP);
    }
  };

  // Build a prompt for Gemini to generate an optimization strategy report
  const buildReportPrompt = (res: OptimizeResponse, currentBudget: number) => {
    const picks = res.picks ?? [];
    const totalGain = res.totalGain ?? 0;
    const remaining = res.remainingBudget ?? 0;
    const lines = picks
      .map((p, idx) => `- ${idx + 1}. ID: ${p.id} | Cost: $${p.cost.toLocaleString()} | Benefit: ${p.benefit.toFixed(3)} | Efficiency: ${(p.benefit / p.cost).toFixed(6)} per $1`)
      .join("\n");

    return `Generate a concise Optimization Strategy Report for the selected mitigation plan.

CONTEXT:
- Budget: $${currentBudget.toLocaleString()}
- Picks: ${picks.length} items
- Total Expected Risk Reduction (0–1 scale): ${totalGain.toFixed(3)} (${(totalGain * 100).toFixed(1)}%)
- Remaining Budget: $${remaining.toLocaleString()}

PICKS DETAIL:
${lines || "- (no picks)"}

REQUIREMENTS:
- Use markdown with clear sections: Overview, Portfolio Impact, Prioritized Actions, Implementation Plan (0-90 days), Risk Hotspots by Site Profile, Monitoring KPIs, and Next Steps.
- Reference emissions vs risk patterns to justify priorities.
- Keep it actionable, with bullet points and specific thresholds.
- Avoid any HTML; markdown only.`;
  };

  const generateReport = async () => {
    if (!result || !sites || sites.length === 0) return;
    setReport(null);
    setReportError(null);
    setReportLoading(true);
    try {
      const prompt = buildReportPrompt(result, budget ?? 0);
      const md = await askGemini(prompt, sites as Site[]);
      if (!validateMarkdown(md)) {
        console.warn("Gemini response may not be proper markdown");
      }
      setReport(md);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  };

  // Auto-generate a report when optimization completes and analytics data is available
  useEffect(() => {
    if (result && sites && sites.length > 0 && !report && !reportLoading) {
      generateReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, sites]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Subtle Vercel-esque backdrop glows + top hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(900px_300px_at_85%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(900px_300px_at_15%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70 ring-1 ring-inset ring-white/5">
            <Sparkles className="h-3.5 w-3.5" />
            Optimize
          </div>
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">
            Budget Optimizer
          </h1>
          <p className="text-sm text-white/70">
            Find the best mitigation mix within your budget. Tweak the amount,
            then run the optimizer.
          </p>
        </div>

        {/* Budget Form */}
        <Card className="mb-8 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white/90">
              <SlidersIcon className="h-4 w-4 opacity-80" />
              Budget Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Input + steppers */}
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <div>
                  <div className="flex gap-3">
                    <label
                      htmlFor="budget"
                      className="mb-2 block text-sm text-white/85"
                    >
                      Budget (USD)
                    </label>
                    <div className="mt-1 text-xs text-white/60">
                      Range {formatCurrency(BUDGET_MIN)} –{" "}
                      {formatCurrency(BUDGET_MAX)}
                    </div>
                  </div>

                  <div className="relative" onWheel={onWheel}>
                    <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <Input
                      id="budget"
                      type="number"
                      step={BUDGET_STEP}
                      min={BUDGET_MIN}
                      max={BUDGET_MAX}
                      onKeyDown={onArrow}
                      {...register("budget", { valueAsNumber: true })}
                      className="rounded-xl border-white/10 bg-white/[0.06] pl-8 text-white placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-white/40"
                      disabled={mutation.isPending}
                    />
                  </div>
                  {errors.budget && (
                    <p className="mt-1 text-sm text-red-400">
                      {errors.budget.message}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => bump(-BUDGET_STEP)}
                    disabled={mutation.isPending}
                    className="rounded-xl border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  >
                    − {formatCurrency(BUDGET_STEP, 0)}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => bump(BUDGET_STEP)}
                    disabled={mutation.isPending}
                    className="rounded-xl border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  >
                    + {formatCurrency(BUDGET_STEP, 0)}
                  </Button>
                </div>

                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="rounded-xl bg-white text-black hover:bg-white/90"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    "Find Optimal Solutions"
                  )}
                </Button>
              </div>

              {/* Slider (wheel/drag) */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-white/70">
                  <span>
                    Adjust with slider (step {formatCurrency(BUDGET_STEP, 0)})
                  </span>
                  <span className="font-mono">
                    {formatCurrency(clamp(budget ?? 0), 0)}
                  </span>
                </div>
                <div onWheel={onWheel}>
                  <Slider
                    value={[clamp(budget ?? 0)]}
                    onValueChange={([v]) =>
                      setValue(
                        "budget",
                        clamp(Math.round(v / BUDGET_STEP) * BUDGET_STEP),
                        {
                          shouldValidate: true,
                          shouldDirty: true,
                        }
                      )
                    }
                    min={BUDGET_MIN}
                    max={BUDGET_MAX}
                    step={BUDGET_STEP}
                    className="relative py-2
                      [&_[data-orientation=horizontal]]:h-1.5
                      [&_[role=slider]]:size-4
                      [&_[role=slider]]:rounded-full
                      [&_[role=slider]]:border
                      [&_[role=slider]]:border-white/30
                      [&_[role=slider]]:bg-white
                      [&_[role=slider]]:shadow
                      focus-within:[&_[role=slider]]:ring-2
                      focus-within:[&_[role=slider]]:ring-white/40
                      [&_.relative>div:first-child]:bg-white/10
                      [&_.relative>div:last-child]:bg-white/40"
                  />
                </div>
                {/* Ticks */}
                <div className="mt-2 grid grid-cols-4 text-[10px] text-white/50">
                  <div>{formatCurrency(100_000)}</div>
                  <div className="text-center">{formatCurrency(1_000_000)}</div>
                  <div className="text-center">
                    {formatCurrency(10_000_000)}
                  </div>
                  <div className="text-right">
                    {formatCurrency(100_000_000)}
                  </div>
                </div>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      setValue("budget", p, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs transition
                      ${
                        budget === p
                          ? "border-white/20 bg-white text-black"
                          : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                      }`}
                    aria-label={`Set budget to ${formatCurrency(p, 0)}`}
                  >
                    {formatCurrency(p, 0)}
                  </button>
                ))}
              </div>

              {mutation.isError && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Error</p>
                    <p className="text-xs">
                      {mutation.error instanceof Error
                        ? mutation.error.message
                        : "Failed to optimize budget. Please try again."}
                    </p>
                  </div>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Summary KPIs */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-white/70">
                    Total Gain
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {result.totalGain?.toFixed(3) ?? "0.000"}
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    {((result.totalGain ?? 0) * 100).toFixed(1)}% risk reduction
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-white/70">
                    Items Selected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {result.picks?.length ?? 0}
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    Mitigation strategies
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-white/70">
                    Remaining Budget
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(result.remainingBudget ?? 0, 0)}
                  </div>
                  <p className="mt-1 text-xs text-white/60">Available funds</p>
                </CardContent>
              </Card>
            </div>

            {/* What this means */}
            <Card className="rounded-2xl border-green-500/20 bg-green-500/5 backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-lg">What This Means</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="leading-relaxed text-white/70">
                  Implementing these {result.picks?.length ?? 0} strategies
                  yields an estimated{" "}
                  <span className="font-semibold text-green-400">
                    {((result.totalGain ?? 0) * 100).toFixed(1)}% reduction
                  </span>{" "}
                  in overall risk (gain{" "}
                  {result.totalGain?.toFixed(3) ?? "0.000"} on a 0–1 scale).
                  You’ll retain {formatCurrency(result.remainingBudget ?? 0, 0)}{" "}
                  for additional improvements.
                </p>
              </CardContent>
            </Card>

            {/* Picks table */}
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader>
                <CardTitle className="text-base text-white/90">
                  Recommended Mitigation Strategies
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(result.picks?.length ?? 0) === 0 ? (
                  <p className="text-sm text-white/60">
                    No items selected. Try increasing your budget.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-white/70">
                          <th className="pb-3 text-left font-medium">
                            Item ID
                          </th>
                          <th className="pb-3 text-right font-medium">Cost</th>
                          <th className="pb-3 text-right font-medium">
                            Benefit
                          </th>
                          <th className="pb-3 text-right font-medium">
                            Efficiency
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.picks?.map((item) => {
                          const eff = item.benefit / item.cost; // benefit per $1
                          return (
                            <tr
                              key={item.id}
                              className="border-b border-white/10 last:border-0 hover:bg-white/[0.03]"
                            >
                              <td className="py-3 font-mono text-xs">
                                {item.id}
                              </td>
                              <td className="py-3 text-right font-mono">
                                {formatCurrency(item.cost, 0)}
                              </td>
                              <td className="py-3 text-right font-mono">
                                {item.benefit.toFixed(3)}
                              </td>
                              <td className="py-3 text-right font-mono text-white/80">
                                {eff.toFixed(6)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-white/10 font-semibold">
                          <td className="pt-3">Total</td>
                          <td className="pt-3 text-right font-mono">
                            {formatCurrency(
                              result.picks?.reduce((s, i) => s + i.cost, 0) ??
                                0,
                              0
                            )}
                          </td>
                          <td className="pt-3 text-right font-mono">
                            {result.totalGain?.toFixed(3) ?? "0.000"}
                          </td>
                          <td className="pt-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Gemini Optimization Strategy Report */}
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base text-white/90">
                  <span>Optimization Strategy Report</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={generateReport}
                      disabled={reportLoading || !sites?.length}
                      className="rounded-lg border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    >
                      {reportLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        "Regenerate"
                      )}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!sites?.length && (
                  <p className="text-sm text-white/60">
                    Analytics context unavailable. Report quality may be limited.
                  </p>
                )}
                {reportError ? (
                  <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                    {reportError}
                  </div>
                ) : reportLoading ? (
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating report...
                  </div>
                ) : report ? (
                  <div className="prose prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        h1: ({ node, ...props }) => (
                          <h1 className="text-xl font-semibold text-white" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="text-lg font-semibold text-white" {...props} />
                        ),
                        p: ({ node, ...props }) => (
                          <p className="text-white/85" {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li className="ml-4 list-disc text-white/85" {...props} />
                        ),
                        blockquote: ({ node, ...props }) => (
                          <blockquote
                            className="border-l-2 border-white/20 pl-3 text-white/70"
                            {...props}
                          />
                        ),
                        code: ({ node, ...props }) => {
                          const isInline = !props.className || !props.className.includes('language-');
                          return isInline ? (
                            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]" {...props} />
                          ) : (
                            <code className="block whitespace-pre-wrap rounded bg-white/10 p-2 font-mono text-[12px]" {...props} />
                          );
                        },
                      }}
                    >
                      {report}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-white/60">
                    No report yet. Run the optimizer to generate AI insights.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Bottom hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
