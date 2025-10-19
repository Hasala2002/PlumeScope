"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { askGemini, generateOptimizationPlan, validateMarkdown } from "@/lib/gemini";

// ---------------- Types ----------------
export interface OptimizeItem {
  id: string;
  cost: number;
  benefit: number;
}
export interface OptimizeResponse {
  picks?: OptimizeItem[];
  totalGain?: number;
  remainingBudget?: number;
}

type HazardSnapshot = {
  flood: 0 | 1;
  dm: "None" | "D0" | "D1" | "D2" | "D3" | "D4";
  heatIndex: number;
  ts: number;
};

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

interface LiveScoreResponse {
  meta: { cacheHits: number; duration_ms: number };
  items: (Site & { HazardSnapshot: HazardSnapshot })[];
}

export type OptimizeJobStatus = "idle" | "running" | "success" | "error";

export type ChartImage = { title?: string; dataUrl: string; description?: string };

export interface OptimizeJobState {
  status: OptimizeJobStatus;
  budget: number | null;
  result: OptimizeResponse | null;
  report: string | null;
  charts: ChartImage[];
  error: string | null;
}

interface OptimizeJobContextValue extends OptimizeJobState {
  start: (budget: number) => Promise<void>;
  reset: () => void;
}

const OptimizeJobContext = createContext<OptimizeJobContextValue | null>(null);

async function fetchScoreLive(): Promise<Site[]> {
  const { data } = await api.get<LiveScoreResponse>("/score/live");
  return data.items;
}

async function optimizeBudget(budget: number): Promise<OptimizeResponse> {
  const { data } = await axios.post<OptimizeResponse>(
    `http://localhost:3001/optimize?budget=${budget}`
  );
  return data;
}

function buildReportPrompt(res: OptimizeResponse, currentBudget: number) {
  const picks = res.picks ?? [];
  const totalGain = res.totalGain ?? 0;
  const remaining = res.remainingBudget ?? 0;
  const lines = picks
    .map(
      (p, idx) =>
        `- ${idx + 1}. ID: ${p.id} | Cost: $${p.cost.toLocaleString()} | Benefit: ${p.benefit.toFixed(3)} | Efficiency: ${(p.benefit / p.cost).toFixed(6)} per $1`
    )
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
}

export function OptimizeJobProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<OptimizeJobState>({
    status: "idle",
    budget: null,
    result: null,
    report: null,
    charts: [],
    error: null,
  });
  const loadingToastId = useRef<string | number | null>(null);

  const reset = useCallback(() => {
    setState({ status: "idle", budget: null, result: null, report: null, charts: [], error: null });
    if (loadingToastId.current != null) {
      toast.dismiss(loadingToastId.current);
      loadingToastId.current = null;
    }
  }, []);

  const start = useCallback(async (budget: number) => {
    // If already running, ignore duplicate start
    if (state.status === "running") return;

    setState((s) => ({ ...s, status: "running", budget, result: null, report: null, charts: [], error: null }));

    // Persistent loading toast visible across navigation
    const tid = toast.loading("Generating optimal solutions…", {
      description: "You can keep browsing. We'll notify you when it's ready.",
      duration: Infinity,
      dismissible: false,
      action: {
        label: "View",
        onClick: () => router.push("/optimize"),
      },
    });
    loadingToastId.current = tid;

    try {
      const [sites] = await Promise.all([fetchScoreLive()]);

      // 1) Optimize via backend
      let res = await optimizeBudget(budget);
      const hasPicks = (res.picks?.length ?? 0) > 0;
      const nonZero = (res.totalGain ?? 0) > 0 || (res.remainingBudget ?? 0) > 0;
      if (!hasPicks && !nonZero) {
        try {
          const aiPlan = await generateOptimizationPlan(sites ?? [], budget ?? 0);
          res = {
            picks: aiPlan.picks,
            totalGain: aiPlan.totalGain,
            remainingBudget: aiPlan.remainingBudget,
          };
        } catch {
          // keep res as-is
        }
      }

      setState((s) => ({ ...s, result: res }));

      // 2) Generate report via Gemini
      let md: string | null = null;
      try {
        const prompt = buildReportPrompt(res, budget);
        md = await askGemini(prompt, sites);
        if (!validateMarkdown(md)) {
          console.warn("Gemini response may not be proper markdown");
        }
      } catch (e) {
        console.warn("Report generation failed", e);
      }

      // 3) Generate charts via API (best-effort)
      let charts: ChartImage[] = [];
      try {
        const r = await fetch("http://localhost:3001/charts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ picks: res.picks ?? [], sites }),
        });
        if (r.ok) {
          const json = await r.json();
          const rawImages = (json?.images ?? []) as { title?: string; dataUrl?: string; description?: string }[];
          charts = rawImages
            .filter((img) => typeof img?.dataUrl === "string" && img.dataUrl!.trim().length > 0)
            .map((img) => ({ title: img.title, dataUrl: img.dataUrl!, description: img.description }));
        } else {
          console.warn("Chart generation failed:", await r.text());
        }
      } catch (err) {
        console.warn("Chart generation error:", err);
      }

      setState((s) => ({ ...s, report: md, charts, status: "success" }));

      // Notify completion, replace loading toast
      toast.success("Optimization complete", {
        id: loadingToastId.current ?? undefined,
        description: "Your report is ready.",
        action: {
          label: "View report",
          onClick: () => router.push("/optimize"),
        },
      });
      loadingToastId.current = null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate";
      console.error(error);
      setState((s) => ({ ...s, status: "error", error: message }));
      toast.error("Optimization failed", {
        id: loadingToastId.current ?? undefined,
        description: message ?? "Please try again.",
        action: {
          label: "View",
          onClick: () => router.push("/optimize"),
        },
      });
      loadingToastId.current = null;
    }
  }, [router, state.status]);

  const value = useMemo<OptimizeJobContextValue>(
    () => ({ ...state, start, reset }),
    [state, start, reset]
  );

  return (
    <OptimizeJobContext.Provider value={value}>{children}</OptimizeJobContext.Provider>
  );
}

export function useOptimizeJob() {
  const ctx = useContext(OptimizeJobContext);
  if (!ctx) throw new Error("useOptimizeJob must be used within OptimizeJobProvider");
  return ctx;
}
