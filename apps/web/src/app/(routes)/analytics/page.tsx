"use client";

import { useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import {
  Database as DatabaseIcon,
  Cloud as CloudIcon,
  Droplet as DropletIcon,
  AlertTriangle as AlertTriangleIcon,
  BarChart as BarChartIcon,
  Activity as ActivityIcon,
} from "@geist-ui/icons";
import ReactMarkdown from "react-markdown";
import { X, Send, Loader2 } from "lucide-react";
import { askGemini, validateMarkdown } from "@/lib/gemini";

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

interface TwinState {
  mode: "simulate" | "twin";
  speed: number;
  nowSimISO: string;
}

interface HealthData {
  status: "ok" | "error";
  latencyMs: number;
  timestamp: string;
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

async function fetchScoreLive(): Promise<Site[]> {
  const { data } = await api.get<LiveScoreResponse>("/score/live");
  return data.items;
}

async function fetchTwinState(): Promise<TwinState> {
  const { data } = await api.get<TwinState>("/twin/state");
  return data;
}

async function fetchHealth(): Promise<HealthData> {
  const start = Date.now();
  try {
    const { data } = await api.get<{ status?: string; timestamp?: string }>(
      "/health"
    );
    return {
      status: "ok",
      latencyMs: Date.now() - start,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }
}

function GeminiWidget({ sites }: { sites: Site[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [mdText, setMdText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear error state when opening widget
  const clearState = () => {
    setError(null);
    setMdText(null);
  };

  // Hardcoded suggestions that behave like sending a prompt
  const suggestions: readonly string[] = [
    "Why are risk scores trending up?",
    "Top 5 mitigation opportunities",
    "Summarize emissions vs risk",
    "Where should I focus this week?",
  ];

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    setIsLoading(true);
    setError(null);
    setMdText(null);
    
    try {
      const response = await askGemini(input, sites);
      
      // Validate the response is proper markdown
      if (!validateMarkdown(response)) {
        console.warn('Response may not be in proper markdown format');
      }
      
      setMdText(response);
    } catch (err) {
      console.error('Failed to get response from Gemini:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePick = async (s: string) => {
    setInput(s);
    
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);
    setMdText(null);
    
    try {
      const response = await askGemini(s, sites);
      
      // Validate the response is proper markdown
      if (!validateMarkdown(response)) {
        console.warn('Response may not be in proper markdown format');
      }
      
      setMdText(response);
    } catch (err) {
      console.error('Failed to get response from Gemini:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const resetAndClose = () => {
    setOpen(false);
    setInput("");
    setMdText(null);
    setError(null);
    setIsLoading(false);
  };

  // Taller panel when showing markdown or loading
  const panelHeight = mdText || isLoading || error ? "h-[460px]" : "h-[220px]";

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-2xl bg-white text-black px-4 py-3 shadow-xl ring-1 ring-black/10 transition hover:shadow-2xl"
        >
          <img src="/gemini.png" alt="Gemini" className="h-5 w-5" />
          <span className="text-sm font-medium">Ask Gemini</span>
        </button>
      ) : (
        <div
          className={`w-[360px] ${panelHeight} overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur transition-all`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <img src="/gemini.png" alt="Gemini" className="h-4 w-4" />
              <span>Gemini Assistant</span>
            </div>
            <button
              onClick={resetAndClose}
              className="rounded-md p-1 text-white/70 hover:bg-white/10"
              aria-label="Close Gemini Assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex h-[calc(100%-56px)] flex-col">
            <div className="flex-1 overflow-y-auto p-3">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-full space-y-4">
                  <Loader2 className="h-8 w-8 animate-spin text-white/70" />
                  <div className="text-sm text-white/70">Analyzing your data...</div>
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3">
                  <div className="text-sm font-medium text-red-200 mb-1">Error</div>
                  <div className="text-xs text-red-200/80">{error}</div>
                  <button
                    onClick={clearState}
                    className="mt-2 text-xs text-red-200 hover:text-red-100 underline"
                  >
                    Try again
                  </button>
                </div>
              ) : !mdText ? (
                input.trim().length === 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs text-white/60">Try:</div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => handlePick(s)}
                          className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/85 transition hover:bg-white/10 disabled:opacity-50"
                          disabled={isLoading}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-white/50">
                    Press{" "}
                    <span className="rounded bg-white/10 px-1 py-0.5">
                      Enter
                    </span>{" "}
                    to submit…
                  </div>
                )
              ) : (
                <div className="max-h-full space-y-3 text-sm leading-6 text-white/90">
                  {/* Keep styling minimal to avoid plugin dependencies */}
                  <ReactMarkdown
                    components={{
                      h1: ({ node, ...props }) => (
                        <h1
                          className="text-xl font-semibold text-white"
                          {...props}
                        />
                      ),
                      h2: ({ node, ...props }) => (
                        <h2
                          className="text-lg font-semibold text-white"
                          {...props}
                        />
                      ),
                      p: ({ node, ...props }) => (
                        <p className="text-white/85" {...props} />
                      ),
                      li: ({ node, ...props }) => (
                        <li
                          className="ml-4 list-disc text-white/85"
                          {...props}
                        />
                      ),
                      blockquote: ({ node, ...props }) => (
                        <blockquote
                          className="border-l-2 border-white/20 pl-3 text-white/70"
                          {...props}
                        />
                      ),
                      code: ({ node, ...props }) => {
                        // Check if it's inline code by looking at the element properties
                        const isInline = !props.className || !props.className.includes('language-');
                        return isInline ? (
                          <code
                            className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px]"
                            {...props}
                          />
                        ) : (
                          <code
                            className="block whitespace-pre-wrap rounded bg-white/10 p-2 font-mono text-[12px]"
                            {...props}
                          />
                        );
                      },
                    }}
                  >
                    {mdText}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="border-t border-white/10 p-3"
            >
              <div className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 ring-1 ring-inset ring-white/10">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Gemini for more insights!"
                  className="flex-1 bg-transparent py-2 text-sm text-white placeholder-white/40 outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md bg-white/10 p-1.5 text-white/80 transition hover:bg-white/20 disabled:opacity-50"
                  aria-label="Send to Gemini"
                  disabled={isLoading || !input.trim()}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  // Data fetching hooks
  const {
    data: sites,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["score-live"],
    queryFn: fetchScoreLive,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: twin } = useQuery({
    queryKey: ["twin-state"],
    queryFn: fetchTwinState,
    staleTime: 10_000,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 30_000,
  });

  /* ----------------------------- Derivations ---------------------------- */

  const kpis = useMemo(() => {
    if (!sites || sites.length === 0) return null;
    const totalCO2e = sites.reduce((sum, s) => sum + s.CO2e_tpy, 0);
    const totalCH4 = sites.reduce((sum, s) => sum + s.CH4_tpy, 0);
    const topRiskSite = sites.reduce(
      (max, s) => (s.Risk > max.Risk ? s : max),
      sites[0]
    );
    const avgRisk = sites.reduce((sum, s) => sum + s.Risk, 0) / sites.length;
    const avgEmissions =
      sites.reduce((sum, s) => sum + s.EmissionsScore, 0) / sites.length;
    const avgFlood =
      sites.reduce((sum, s) => sum + s.FloodScore, 0) / sites.length;
    const avgHeat =
      sites.reduce((sum, s) => sum + s.HeatScore, 0) / sites.length;
    const avgDrought =
      sites.reduce((sum, s) => sum + s.DroughtScore, 0) / sites.length;
    const highRiskCount = sites.filter((s) => s.Risk >= 0.7).length;
    const topEmissionsSite = sites.reduce(
      (max, s) => (s.EmissionsScore > max.EmissionsScore ? s : max),
      sites[0]
    );
    return {
      sitesCount: sites.length,
      totalCO2e,
      totalCH4,
      topRiskSite,
      avgRisk,
      avgEmissions,
      avgFlood,
      avgHeat,
      avgDrought,
      highRiskCount,
      topEmissionsSite,
    };
  }, [sites]);

  // Risk distribution bins
  const riskBins = useMemo(() => {
    if (!sites) return [];
    const defs = [
      { label: "0.0 – 0.2", min: 0, max: 0.2 },
      { label: "0.2 – 0.4", min: 0.2, max: 0.4 },
      { label: "0.4 – 0.6", min: 0.4, max: 0.6 },
      { label: "0.6 – 0.8", min: 0.6, max: 0.8 },
      { label: "0.8 – 1.0", min: 0.8, max: 1.0 },
    ] as const;
    return defs.map((bin, i) => {
      const count =
        i === defs.length - 1
          ? sites.filter((s) => s.Risk >= bin.min && s.Risk <= bin.max).length
          : sites.filter((s) => s.Risk >= bin.min && s.Risk < bin.max).length;
      return { ...bin, count };
    });
  }, [sites]);

  const maxBinCount = useMemo(
    () => Math.max(1, ...riskBins.map((b) => b.count)),
    [riskBins]
  );

  /* --------------------------- Scatter tooltip -------------------------- */

  const [tip, setTip] = useState<{
    x: number;
    y: number;
    site: Site;
  } | null>(null);
  const scatterWrapRef = useRef<HTMLDivElement | null>(null);

  const showTip = (e: React.MouseEvent<SVGCircleElement>, site: Site) => {
    const rect = scatterWrapRef.current?.getBoundingClientRect();
    setTip({
      x: (rect ? e.clientX - rect.left : e.clientX) + 8,
      y: (rect ? e.clientY - rect.top : e.clientY) + 8,
      site,
    });
  };

  const hideTip = () => setTip(null);

  /* ------------------------------ States UI ----------------------------- */

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-64 animate-pulse rounded bg-white/10" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-200">
          Error loading data: {(error as Error).message}
        </div>
      </div>
    );
  }

  if (!sites || sites.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-white/70">No data available</div>
      </div>
    );
  }

  /* --------------------------------- UI -------------------------------- */

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Backdrop effects */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(900px_300px_at_85%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(900px_300px_at_15%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70 ring-1 ring-inset ring-white/5">
            <BarChartIcon className="h-3.5 w-3.5 opacity-80" />
            Real-time Analytics
          </div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
            Climate Risk Intelligence
          </h1>
          <p className="text-sm text-white/70">
            {twin?.mode === "simulate"
              ? `Simulating at ${twin.speed}× speed`
              : "Live monitoring"}{" "}
            •{kpis?.highRiskCount} high-risk sites require attention
          </p>
        </div>

        {/* BENTO GRID LAYOUT */}
        <div className="grid grid-cols-12 gap-4 auto-rows-[140px]">
          {/* ROW 1: Hero KPIs */}

          {/* Total Sites - Large Hero */}
          <Card className="col-span-12 md:col-span-4 row-span-2 rounded-2xl border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent" />
            <CardContent className="relative h-full flex flex-col justify-between p-6">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-white/60 mb-2">
                  <DatabaseIcon className="h-4 w-4" />
                  Total Sites Monitored
                </div>
                <div className="text-6xl font-bold mb-3">
                  {kpis?.sitesCount}
                </div>
                <div className="text-sm text-white/70">
                  Across all facilities
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div>
                  <div className="text-white/60">High Risk</div>
                  <div className="text-lg font-semibold text-red-400">
                    {kpis?.highRiskCount}
                  </div>
                </div>
                <div className="h-8 w-px bg-white/10" />
                <div>
                  <div className="text-white/60">Avg Risk</div>
                  <div className="text-lg font-semibold font-mono">
                    {kpis?.avgRisk.toFixed(3)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Critical Alert - High Risk Site */}
          <Card className="col-span-12 md:col-span-5 row-span-2 rounded-2xl border-red-500/20 bg-gradient-to-br from-red-500/[0.12] to-white/[0.04] backdrop-blur ring-1 ring-inset ring-red-500/20 overflow-hidden relative">
            <div className="absolute top-2 right-2">
              <div className="animate-pulse h-2 w-2 rounded-full bg-red-400" />
            </div>
            <CardContent className="h-full flex flex-col justify-between p-6">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-red-300 mb-2">
                  <AlertTriangleIcon className="h-4 w-4" />
                  Critical Risk Alert
                </div>
                <div className="text-2xl font-bold mb-2">
                  {kpis?.topRiskSite.name}
                </div>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-4xl font-bold text-red-400">
                    {kpis?.topRiskSite.Risk.toFixed(3)}
                  </span>
                  <span className="text-sm text-white/60">risk score</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-white/60">Flood</div>
                  <div className="font-mono text-white/90">
                    {kpis?.topRiskSite.FloodScore.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-white/60">Heat</div>
                  <div className="font-mono text-white/90">
                    {kpis?.topRiskSite.HeatScore.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-white/60">Drought</div>
                  <div className="font-mono text-white/90">
                    {kpis?.topRiskSite.DroughtScore.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* System Health Indicators */}
          <Card className="col-span-12 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex items-center justify-between p-4">
              <div>
                <div className="text-xs text-white/60 mb-1">API Status</div>
                <div
                  className={`text-xl font-bold ${health?.status === "ok" ? "text-emerald-400" : "text-red-400"}`}
                >
                  {health?.status === "ok" ? "OPERATIONAL" : "ERROR"}
                </div>
              </div>
              <div
                className={`h-3 w-3 rounded-full ${health?.status === "ok" ? "bg-emerald-400" : "bg-red-400"} animate-pulse`}
              />
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex items-center justify-between p-4">
              <div>
                <div className="text-xs text-white/60 mb-1">Latency</div>
                <div className="text-xl font-bold font-mono">
                  {health?.latencyMs}ms
                </div>
              </div>
              <ActivityIcon className="h-5 w-5 text-white/40" />
            </CardContent>
          </Card>

          {/* ROW 2: Emissions Overview */}

          {/* Total Emissions - Wide */}
          <Card className="col-span-12 md:col-span-6 row-span-2 rounded-2xl border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur ring-1 ring-inset ring-white/5 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent" />
            <CardContent className="relative h-full flex flex-col justify-between p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-white/60 mb-4">
                <CloudIcon className="h-4 w-4" />
                Total Emissions Output
              </div>
              <div className="flex items-end gap-8">
                <div>
                  <div className="text-sm text-white/60 mb-1">
                    CO2 Equivalent
                  </div>
                  <div className="text-4xl font-bold">
                    {kpis?.totalCO2e.toLocaleString()}
                  </div>
                  <div className="text-xs text-white/60 mt-1">
                    tonnes per year
                  </div>
                </div>
                <div className="pb-2">
                  <div className="text-sm text-white/60 mb-1">Methane</div>
                  <div className="text-3xl font-bold">
                    {kpis?.totalCH4.toLocaleString()}
                  </div>
                  <div className="text-xs text-white/60 mt-1">
                    tonnes per year
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/60">Highest Emitter</span>
                  <span className="text-sm font-semibold">
                    {kpis?.topEmissionsSite.name}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Average Scores */}
          <Card className="col-span-6 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex flex-col justify-center p-4">
              <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                <ActivityIcon className="h-3.5 w-3.5" />
                Avg Emissions Score
              </div>
              <div className="text-3xl font-bold font-mono">
                {kpis?.avgEmissions.toFixed(3)}
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-6 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex flex-col justify-center p-4">
              <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                <ActivityIcon className="h-3.5 w-3.5" />
                Avg Flood Score
              </div>
              <div className="text-3xl font-bold font-mono">
                {kpis?.avgFlood.toFixed(3)}
              </div>
            </CardContent>
          </Card>

          {/* Hazard Breakdown */}
          <Card className="col-span-6 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex flex-col justify-center p-4">
              <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                <ActivityIcon className="h-3.5 w-3.5" />
                Avg Heat Score
              </div>
              <div className="text-3xl font-bold font-mono">
                {kpis?.avgHeat.toFixed(3)}
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-6 md:col-span-3 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex flex-col justify-center p-4">
              <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                <ActivityIcon className="h-3.5 w-3.5" />
                Avg Drought Score
              </div>
              <div className="text-3xl font-bold font-mono">
                {kpis?.avgDrought.toFixed(3)}
              </div>
            </CardContent>
          </Card>

          {/* ROW 3: Visualizations */}

          {/* Risk Distribution */}
          <Card className="col-span-12 md:col-span-7 row-span-3 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base text-white/90">
                <span className="flex items-center gap-2">
                  <ActivityIcon className="h-4 w-4 opacity-80" />
                  Risk Distribution
                </span>
                <span className="text-xs font-normal text-white/60">
                  Total: {sites?.length} sites
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-60px)]">
              <div className="space-y-4 h-full flex flex-col justify-center">
                {riskBins.map((bin) => {
                  const pct = (bin.count / maxBinCount) * 100;
                  const isHighRisk = bin.min >= 0.6;
                  return (
                    <div
                      key={bin.label}
                      className="grid grid-cols-[100px_1fr_60px] items-center gap-4"
                    >
                      <div className="text-right text-sm text-white/70 font-medium">
                        {bin.label}
                      </div>
                      <div className="relative h-8 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isHighRisk
                              ? "bg-gradient-to-r from-red-500/80 to-red-400/40"
                              : "bg-gradient-to-r from-white/60 to-white/20"
                          }`}
                          style={{ width: `${pct}%` }}
                          title={`${bin.label}: ${bin.count} sites`}
                        />
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold font-mono">
                          {bin.count}
                        </div>
                        <div className="text-[10px] text-white/50">sites</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Emissions vs Risk Scatter */}
          <Card className="col-span-12 md:col-span-5 row-span-3 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white/90">
                Emissions vs Risk Correlation
              </CardTitle>
              <p className="text-xs text-white/60 mt-1">
                Each point represents a facility
              </p>
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)]">
              <div ref={scatterWrapRef} className="relative h-full">
                <svg viewBox="0 0 420 340" className="w-full h-full">
                  <defs>
                    <clipPath id="plot">
                      <rect x="50" y="20" width="350" height="280" rx="2" />
                    </clipPath>
                    <linearGradient
                      id="pointGradient"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor="rgba(255,255,255,0.8)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
                    </linearGradient>
                  </defs>

                  {/* Axes */}
                  <line
                    x1="50"
                    y1="300"
                    x2="400"
                    y2="300"
                    stroke="currentColor"
                    className="text-white/40"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="50"
                    y1="20"
                    x2="50"
                    y2="300"
                    stroke="currentColor"
                    className="text-white/40"
                    strokeWidth="1.5"
                  />

                  {/* Gridlines */}
                  {[0.25, 0.5, 0.75].map((v) => (
                    <g key={`x-${v}`}>
                      <line
                        x1={50 + v * 350}
                        y1="20"
                        x2={50 + v * 350}
                        y2="300"
                        stroke="currentColor"
                        className="text-white/10"
                        strokeWidth="1"
                        strokeDasharray="2,4"
                      />
                    </g>
                  ))}
                  {[0.25, 0.5, 0.75].map((v) => (
                    <g key={`y-${v}`}>
                      <line
                        x1="50"
                        y1={300 - v * 280}
                        x2="400"
                        y2={300 - v * 280}
                        stroke="currentColor"
                        className="text-white/10"
                        strokeWidth="1"
                        strokeDasharray="2,4"
                      />
                    </g>
                  ))}

                  {/* Ticks & labels */}
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <g key={`xtick-${v}`}>
                      <text
                        x={50 + v * 350}
                        y="318"
                        fill="currentColor"
                        className="text-[11px] text-white/70"
                        textAnchor="middle"
                      >
                        {v.toFixed(2)}
                      </text>
                    </g>
                  ))}
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <g key={`ytick-${v}`}>
                      <text
                        x="38"
                        y={303 - v * 280}
                        fill="currentColor"
                        className="text-[11px] text-white/70"
                        textAnchor="end"
                      >
                        {v.toFixed(2)}
                      </text>
                    </g>
                  ))}

                  {/* Axis titles */}
                  <text
                    x="225"
                    y="336"
                    fill="currentColor"
                    className="text-xs text-white/70 font-medium"
                    textAnchor="middle"
                  >
                    Emissions Score
                  </text>
                  <text
                    x="16"
                    y="160"
                    fill="currentColor"
                    className="text-xs text-white/70 font-medium"
                    textAnchor="middle"
                    transform="rotate(-90 16 160)"
                  >
                    Risk Score
                  </text>

                  {/* Points */}
                  <g clipPath="url(#plot)">
                    {sites.map((site) => {
                      const x = 50 + site.EmissionsScore * 350;
                      const y = 300 - site.Risk * 280;
                      const isHighRisk = site.Risk >= 0.7;
                      return (
                        <circle
                          key={site.id}
                          cx={x}
                          cy={y}
                          r={isHighRisk ? "5" : "3.5"}
                          fill={
                            isHighRisk
                              ? "rgba(239, 68, 68, 0.9)"
                              : "url(#pointGradient)"
                          }
                          className={isHighRisk ? "" : "hover:opacity-100"}
                          opacity={isHighRisk ? "1" : "0.7"}
                          onMouseEnter={(e) => showTip(e, site)}
                          onMouseLeave={hideTip}
                          style={{ cursor: "pointer" }}
                        />
                      );
                    })}
                  </g>
                </svg>

                {/* Tooltip */}
                {tip && (
                  <div
                    className="pointer-events-none absolute z-10 rounded-xl border border-white/20 bg-black/90 px-4 py-3 text-xs text-white/90 shadow-2xl backdrop-blur-xl"
                    style={{ left: tip.x, top: tip.y }}
                  >
                    <div className="font-semibold text-sm mb-2">
                      {tip.site.name}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <div className="text-white/60">Emissions:</div>
                      <div className="font-mono text-white">
                        {tip.site.EmissionsScore.toFixed(3)}
                      </div>
                      <div className="text-white/60">Risk:</div>
                      <div className="font-mono text-white">
                        {tip.site.Risk.toFixed(3)}
                      </div>
                      <div className="text-white/60">CO2e:</div>
                      <div className="font-mono text-white">
                        {tip.site.CO2e_tpy.toLocaleString()} tpy
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Digital Twin Status - Wide */}
          <Card className="col-span-12 md:col-span-6 row-span-1 rounded-2xl border-white/10 bg-gradient-to-r from-purple-500/10 to-blue-500/10 backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                  <ActivityIcon className="h-3.5 w-3.5" />
                  Digital Twin Environment
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold capitalize">
                    {twin?.mode ?? "—"}
                  </div>
                  {twin?.mode === "simulate" && (
                    <div className="px-2 py-1 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium">
                      {twin.speed}× Speed
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-white/50 mb-1">
                  Simulation Time
                </div>
                <div className="font-mono text-xs text-white/80">
                  {twin?.nowSimISO
                    ? new Date(twin.nowSimISO).toLocaleString()
                    : "—"}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats Row */}
          <Card className="col-span-12 md:col-span-6 row-span-1 rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardContent className="h-full flex items-center justify-around p-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{kpis?.highRiskCount}</div>
                <div className="text-xs text-white/60">High Risk</div>
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {sites.length - (kpis?.highRiskCount ?? 0)}
                </div>
                <div className="text-xs text-white/60">Normal</div>
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div className="text-center">
                <div className="text-2xl font-bold font-mono">
                  {kpis?.avgRisk.toFixed(2)}
                </div>
                <div className="text-xs text-white/60">Avg Risk</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Insights Footer */}
        <div className="mt-6 p-4 rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <ActivityIcon className="h-4 w-4 text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium mb-1">Key Insights</div>
              <div className="text-xs text-white/70 space-y-1">
                <p>
                  • {kpis?.highRiskCount} sites exceed 0.7 risk threshold and
                  require immediate attention
                </p>
                <p>
                  • Average emissions score of {kpis?.avgEmissions.toFixed(3)}{" "}
                  indicates moderate environmental impact across portfolio
                </p>
                <p>
                  • Correlation between emissions and climate risk suggests
                  mitigation opportunities at high-emission facilities
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Gemini widget */}
      <GeminiWidget sites={sites} />

      {/* Bottom hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
