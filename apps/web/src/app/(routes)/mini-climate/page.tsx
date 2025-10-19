"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Download, Sparkles } from "lucide-react";
import { Thermometer as ThermometerIcon } from "@geist-ui/icons";
import { api } from "@/lib/api";

interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface PlumeResponse {
  n: number;
  cell: number;
  half: number;
  grid: number[][];
}

interface PlumeParams {
  windSpeed: number;
  emissionRate: number;
  stability: string;
}

async function fetchSites(): Promise<Site[]> {
  const response = await api.get<Site[]>("/sites");
  return response.data;
}

async function fetchPlume(params: { u:number; q:number; dir?:number; stab?:string; Hs?:number; half?:number }): Promise<PlumeResponse> {
  const usp = new URLSearchParams();
  usp.set("u", String(params.u));
  usp.set("q", String(params.q));
  if (params.dir!=null) usp.set("dir", String(params.dir));
  if (params.stab!=null) usp.set("stab", String(params.stab));
  if (params.Hs!=null) usp.set("Hs", String(params.Hs));
  if (params.half!=null) usp.set("half", String(params.half));
  const response = await api.get<PlumeResponse>(`/plume?${usp.toString()}`);
  return response.data;
}

/* -------------------------- Heatmap color utils -------------------------- */

// Linear interpolate between two colors
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
  ] as [number, number, number];
}

// Compact Viridis-like palette (stops) for nice perceptual mapping
const VIRIDIS_STOPS: [number, number, number][] = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [41, 120, 142],
  [32, 144, 140],
  [34, 167, 132],
  [68, 190, 112],
  [121, 209, 81],
  [189, 222, 38],
  [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const n = VIRIDIS_STOPS.length;
  const x = Math.max(0, Math.min(1, t)) * (n - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= n - 1) return VIRIDIS_STOPS[n - 1];
  return lerpColor(VIRIDIS_STOPS[i], VIRIDIS_STOPS[i + 1], f);
}

/* --------------------------------- Page --------------------------------- */

export default function Page() {
  const [windSpeed, setWindSpeed] = useState(5);
  const [emissionRate, setEmissionRate] = useState(1);
  const [stability, setStability] = useState("D");
  const [selectedSite, setSelectedSite] = useState("");
  const [palette, setPalette] = useState<"viridis" | "gray">("viridis");
  const [logScale, setLogScale] = useState(false);
  const [cellSize, setCellSize] = useState(4);
  // Twin mode state
  const [mode, setMode] = useState<"simulate"|"twin">("simulate");
  const [speed, setSpeed] = useState<number>(3600);
  const [simTime, setSimTime] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);
  const inFlightRef = useRef(false);
  const skippedRef = useRef(false);
  const lastTwinParamsRef = useRef<{ u:number; dir:number; q:number; half:number; stab:string; Hs:number } | null>(null);
  const lastMsgTsRef = useRef<number>(0);
  const [reconnecting, setReconnecting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizWrapRef = useRef<HTMLDivElement>(null);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });

  const plumeMutation = useMutation({ mutationFn: fetchPlume });

  const handleGenerate = () => {
    plumeMutation.mutate({ u: windSpeed, q: emissionRate, stab: stability });
  };

  const handleDownload = () => {
    const el = canvasRef.current;
    if (!el) return;
    const link = document.createElement("a");
    link.href = el.toDataURL("image/png");
    link.download = `plume_${Date.now()}.png`;
    link.click();
  };

  // Cursor-follow glow
  const handleGlow = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--y", `${e.clientY - rect.top}px`);
  };

  // Wheel/arrow helpers for numeric inputs
  const bump = (
    setter: (n: number) => void,
    value: number,
    step: number,
    min: number,
    max: number,
    dir: 1 | -1
  ) => {
    const next = Math.min(max, Math.max(min, +(value + dir * step).toFixed(2)));
    setter(next);
  };

  const wsStep = 0.1,
    wsMin = 0.1,
    wsMax = 20;
  const erStep = 0.1,
    erMin = 0.1,
    erMax = 10;
  const csStep = 1,
    csMin = 1,
    csMax = 10;

  // Render heatmap with ImageData for performance
  useEffect(() => {
    const data = plumeMutation.data;
    const canvas = canvasRef.current;
    if (!data || !canvas) return;

    const grid = data.grid;
    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    if (!rows || !cols) return;

    // Canvas pixel size equals grid; we upscale via CSS for crisp pixels.
    canvas.width = cols;
    canvas.height = rows;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Compute max for normalization
    let maxValue = 0;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) maxValue = Math.max(maxValue, grid[i][j]);
    if (maxValue <= 0) {
      ctx.clearRect(0, 0, cols, rows);
      return;
    }

    const img = ctx.createImageData(cols, rows);
    const buf = img.data;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        let t = v / maxValue;
        if (logScale) {
          // simple log compression (avoid log(0))
          const eps = 1e-6;
          t = Math.log1p(v) / Math.log1p(maxValue + eps);
        }
        const [r, g, b] =
          palette === "viridis" ? viridis(t) : [t * 255, t * 255, t * 255];
        const idx = (y * cols + x) * 4;
        buf[idx] = r | 0;
        buf[idx + 1] = g | 0;
        buf[idx + 2] = b | 0;
        buf[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [plumeMutation.data, palette, logScale]);

  // Max value (for readout)
  const maxValue = plumeMutation.data
    ? Math.max(...plumeMutation.data.grid.flat())
    : 0;

  // Micro-ΔT heuristic
  const calculateMicroDeltaT = () => {
    if (!plumeMutation.data) return null;
    const factor = emissionRate / windSpeed;
    const minDelta = (0.05 * factor).toFixed(2);
    const maxDelta = (0.15 * factor).toFixed(2);
    return `~${minDelta}–${maxDelta} °C`;
  };

  // Initialize twin state
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ mode:"simulate"|"twin"; speed:number; nowSimISO:string }>("/twin/state");
        setMode(data.mode);
        setSpeed(data.speed);
        setSimTime(data.nowSimISO);
      } catch {/* ignore */}
    })();
  }, []);

  // SSE subscription when in twin mode
  useEffect(() => {
    if (mode !== "twin" || !selectedSite) { esRef.current?.close(); esRef.current = null; return; }
    const url = `${api.defaults.baseURL}/twin/stream?siteId=${encodeURIComponent(selectedSite)}`;
    const ev = new EventSource(url);
    esRef.current = ev;
    ev.onopen = () => { lastMsgTsRef.current = Date.now(); setReconnecting(false); };
    ev.onmessage = (m) => {
      try {
        const payload = JSON.parse(m.data) as { simTimeISO:string; speed:number; params:{ u:number; dir:number; q:number; half:number; stab:string; Hs:number } };
        setSimTime(payload.simTimeISO);
        setSpeed(payload.speed);
        lastTwinParamsRef.current = payload.params;
        lastMsgTsRef.current = Date.now();
        enqueuePlumeRender();
      } catch {/* ignore */}
    };
    ev.onerror = () => { /* let heartbeat watcher flag */ };
    return () => { ev.close(); };
  }, [mode, selectedSite]);

  // Heartbeat watcher for SSE (3s)
  useEffect(() => {
    const iv = setInterval(() => {
      if (mode !== 'twin' || !selectedSite) { setReconnecting(false); return; }
      if (!esRef.current) { setReconnecting(false); return; }
      const age = Date.now() - (lastMsgTsRef.current || 0);
      setReconnecting(age > 3000);
    }, 1000);
    return () => clearInterval(iv);
  }, [mode, selectedSite]);

  type PlumeArgs = { u:number; q:number; dir?:number; stab?:string; Hs?:number; half?:number };
  const enqueuePlumeRender = useMemo(() => {
    const fn = () => {
      if (inFlightRef.current) { skippedRef.current = true; return; }
      const twin = lastTwinParamsRef.current;
      const args: PlumeArgs = (mode === "twin" && twin)
        ? { u: twin.u, q: twin.q, dir: twin.dir, stab: twin.stab, Hs: twin.Hs, half: twin.half }
        : { u: windSpeed, q: emissionRate, stab: stability };
      inFlightRef.current = true;
      plumeMutation.mutate(args, {
        onSettled: () => {
          inFlightRef.current = false;
          if (skippedRef.current) { skippedRef.current = false; fn(); }
        }
      });
    };
    return fn;
  }, [mode, windSpeed, emissionRate, stability, plumeMutation]);

  const toggleMode = async () => {
    const next = mode === "twin" ? "simulate" : "twin";
    try {
      const { data } = await api.post("/twin/mode", { mode: next, speed });
      setMode(data.mode);
      setSpeed(data.speed);
      setSimTime(data.nowSimISO);
    } catch {/* ignore */}
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Vercel-esque backdrop glows + hairlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(900px_300px_at_85%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(900px_300px_at_15%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-10">
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70 ring-1 ring-inset ring-white/5">
            <ThermometerIcon className="h-3.5 w-3.5" />
            Mini-Climate
          </div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <ThermometerIcon className="h-6 w-6 opacity-80" />
            Local Plume & Micro-Warming
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <button onClick={toggleMode} className={`rounded-full px-3 py-1 border ${mode==='twin'?'border-green-400/40 bg-green-400/10':'border-white/10 bg-white/5'} hover:bg-white/10`}>
              Mode: {mode==='twin'? 'Digital Twin':'Simulate'}
            </button>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Speed {speed}×</div>
            {mode==='twin' && (
              <>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">Sim Time: {simTime ? simTime.replace('T',' ').replace('Z','Z') : '—'}</div>
                {selectedSite && reconnecting && (
                  <div className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1">Reconnecting…</div>
                )}
                {!selectedSite && (
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Select a site to start</div>
                )}
              </>
            )}
          </div>
          <p className="mt-2 text-sm text-white/70">
            Prototype plume dispersion and micro-ΔT analysis.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Controls Panel */}
          <div className="space-y-4">
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader>
                <CardTitle className="text-base text-white/90">
                  Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {mode==='twin' && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">
                    Digital Twin is controlling parameters. Switch to Simulate to edit.
                  </div>
                )}
                {/* Wind Speed */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-white/85">Wind Speed (m/s)</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 rounded-md border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                        onClick={() =>
                          bump(
                            setWindSpeed,
                            windSpeed,
                            wsStep,
                            wsMin,
                            wsMax,
                            -1
                          )
                        }
                      >
                        −
                      </Button>
                      <Input
                        disabled={mode==='twin'}
                        type="number"
                        step={wsStep}
                        min={wsMin}
                        max={wsMax}
                        value={windSpeed}
                        onChange={(e) => setWindSpeed(Number(e.target.value))}
                        onWheel={(e) => {
                          bump(
                            setWindSpeed,
                            windSpeed,
                            wsStep,
                            wsMin,
                            wsMax,
                            e.deltaY > 0 ? -1 : 1
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            bump(
                              setWindSpeed,
                              windSpeed,
                              wsStep,
                              wsMin,
                              wsMax,
                              1
                            );
                          }
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            bump(
                              setWindSpeed,
                              windSpeed,
                              wsStep,
                              wsMin,
                              wsMax,
                              -1
                            );
                          }
                        }}
                        className="h-8 w-24 rounded-md border-white/15 bg-white/[0.06] text-center font-mono text-sm text-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 rounded-md border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                        onClick={() =>
                          bump(setWindSpeed, windSpeed, wsStep, wsMin, wsMax, 1)
                        }
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <Slider
                    value={[windSpeed]}
                    min={wsMin}
                    max={wsMax}
                    step={wsStep}
                    onValueChange={([v]) => setWindSpeed(v)}
                    disabled={mode==='twin'}
                    className="relative py-2
                      [&_[data-orientation=horizontal]]:h-1.5
                      [&_[role=slider]]:size-4 [&_[role=slider]]:rounded-full [&_[role=slider]]:border [&_[role=slider]]:border-white/30 [&_[role=slider]]:bg-white
                      focus-within:[&_[role=slider]]:ring-2 focus-within:[&_[role=slider]]:ring-white/40
                      [&_.relative>div:first-child]:bg-white/10
                      [&_.relative>div:last-child]:bg-white/40"
                  />
                  <div className="mt-1 grid grid-cols-4 text-[10px] text-white/50">
                    <div>{wsMin}</div>
                    <div className="text-center">5</div>
                    <div className="text-center">10</div>
                    <div className="text-right">{wsMax}</div>
                  </div>
                </div>

                {/* Emission Rate */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-white/85">Emission Rate (arb.)</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 rounded-md border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                        onClick={() =>
                          bump(
                            setEmissionRate,
                            emissionRate,
                            erStep,
                            erMin,
                            erMax,
                            -1
                          )
                        }
                      >
                        −
                      </Button>
                      <Input
                        disabled={mode==='twin'}
                        type="number"
                        step={erStep}
                        min={erMin}
                        max={erMax}
                        value={emissionRate}
                        onChange={(e) =>
                          setEmissionRate(Number(e.target.value))
                        }
                        onWheel={(e) => {
                          bump(
                            setEmissionRate,
                            emissionRate,
                            erStep,
                            erMin,
                            erMax,
                            e.deltaY > 0 ? -1 : 1
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            bump(
                              setEmissionRate,
                              emissionRate,
                              erStep,
                              erMin,
                              erMax,
                              1
                            );
                          }
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            bump(
                              setEmissionRate,
                              emissionRate,
                              erStep,
                              erMin,
                              erMax,
                              -1
                            );
                          }
                        }}
                        className="h-8 w-24 rounded-md border-white/15 bg-white/[0.06] text-center font-mono text-sm text-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 rounded-md border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                        onClick={() =>
                          bump(
                            setEmissionRate,
                            emissionRate,
                            erStep,
                            erMin,
                            erMax,
                            1
                          )
                        }
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <Slider
                    value={[emissionRate]}
                    min={erMin}
                    max={erMax}
                    step={erStep}
                    onValueChange={([v]) => setEmissionRate(v)}
                    disabled={mode==='twin'}
                    className="relative py-2
                      [&_[data-orientation=horizontal]]:h-1.5
                      [&_[role=slider]]:size-4 [&_[role=slider]]:rounded-full [&_[role=slider]]:border [&_[role=slider]]:border-white/30 [&_[role=slider]]:bg-white
                      focus-within:[&_[role=slider]]:ring-2 focus-within:[&_[role=slider]]:ring-white/40
                      [&_.relative>div:first-child]:bg-white/10
                      [&_.relative>div:last-child]:bg-white/40"
                  />
                </div>

                {/* Presets */}
                <div className="flex flex-wrap gap-2">
                  {[1, 3, 5, 10].map((w) => (
                    <button
                      key={`w-${w}`}
                      onClick={() => setWindSpeed(w)}
                      type="button"
                      className={`rounded-full border px-3 py-1.5 text-xs ${windSpeed === w ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"}`}
                    >
                      {w} m/s
                    </button>
                  ))}
                  {[0.5, 1, 3, 5].map((q) => (
                    <button
                      key={`q-${q}`}
                      onClick={() => setEmissionRate(q)}
                      type="button"
                      className={`rounded-full border px-3 py-1.5 text-xs ${emissionRate === q ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"}`}
                    >
                      q {q}
                    </button>
                  ))}
                </div>

                {/* Stability (chips) */}
                <div>
                  <div className="mb-2 text-sm text-white/85">
                    Stability Class
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["A", "B", "C", "D", "E", "F"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => mode!=='twin' && setStability(s)}
                        disabled={mode==='twin'}
                        className={`rounded-full border px-3 py-1.5 text-xs ${stability === s ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"} ${mode==='twin'?'opacity-60 cursor-not-allowed':''}`}
                        aria-label={`Stability ${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rendering options */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 text-xs text-white/70">Palette</div>
                    <div className="flex gap-2">
                      {(["viridis", "gray"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPalette(p)}
                          className={`rounded-full border px-3 py-1.5 text-xs ${palette === p ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-white/70">Scale</div>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-white/80">
                        <input
                          type="checkbox"
                          checked={logScale}
                          onChange={(e) => setLogScale(e.target.checked)}
                          disabled={mode==='twin'}
                        />
                        Log
                      </label>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                      <span>Pixel Size</span>
                      <span className="font-mono">{cellSize}x</span>
                    </div>
                    <Slider
                      value={[cellSize]}
                      min={csMin}
                      max={csMax}
                      step={csStep}
                      onValueChange={([v]) => setCellSize(v)}
                      disabled={mode==='twin'}
                    />
                  </div>
                </div>

                {/* Generate */}
                <Button
                  onClick={handleGenerate}
                  disabled={plumeMutation.isPending || mode==='twin'}
                  className="w-full rounded-xl bg-white text-black hover:bg-white/90 disabled:opacity-60"
                >
                  {mode==='twin' ? "Twin Running" : plumeMutation.isPending ? "Generating..." : "Generate Plume"}
                </Button>

                {plumeMutation.isError && (
                  <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
                    Failed to generate plume. Check API connection.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Selected Site */}
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader>
                <CardTitle className="text-base text-white/90">
                  Selected Site
                </CardTitle>
              </CardHeader>
              <CardContent>
                <select
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white focus:ring-2 focus:ring-white/40"
                >
                  <option value="">Select a site...</option>
                  {sites?.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>
          </div>

          {/* Visualization Panel */}
          <div className="space-y-4">
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
              <CardHeader className="flex items-center justify-between">
                <CardTitle className="text-base text-white/90">
                  Plume Dispersion
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleDownload}
                    variant="outline"
                    className="h-8 rounded-lg border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    disabled={!plumeMutation.data}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    PNG
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!plumeMutation.data && !plumeMutation.isPending && (
                  <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-white/60">
                    Click “Generate Plume” to visualize dispersion
                  </div>
                )}

                {plumeMutation.isPending && (
                  <div className="flex h-64 items-center justify-center rounded-xl border border-white/10 text-sm text-white/70">
                    Generating plume...
                  </div>
                )}

                {plumeMutation.data && (
                  <div
                    ref={vizWrapRef}
                    onMouseMove={handleGlow}
                    className="relative space-y-3 rounded-xl border border-white/10 bg-black/60 p-4 ring-1 ring-inset ring-white/10"
                    style={{ position: "relative" }}
                  >
                    {/* Canvas at 1px per cell; upscale via CSS for crisp pixels */}
                    <div className="overflow-auto">
                      <canvas
                        ref={canvasRef}
                        className="mx-auto"
                        style={{
                          width: `calc(${plumeMutation.data.grid[0]?.length || 0}px * ${cellSize})`,
                          height: `calc(${plumeMutation.data.grid.length}px * ${cellSize})`,
                          imageRendering: "pixelated",
                        }}
                      />
                    </div>

                    {/* Cursor-follow glow layer */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-200 hover:opacity-100"
                      style={{
                        background:
                          "radial-gradient(220px 140px at var(--x, 50%) var(--y, 50%), rgba(255,255,255,0.08), transparent 70%)",
                      }}
                    />

                    {/* Scale + stats */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-white/60">Scale:</span>
                        <div className="flex h-4 w-36 items-center overflow-hidden rounded border border-white/15">
                          {palette === "viridis" ? (
                            <div
                              className="h-full w-full"
                              style={{
                                background:
                                  "linear-gradient(90deg, rgb(68,1,84), rgb(72,35,116), rgb(64,67,135), rgb(52,94,141), rgb(41,120,142), rgb(32,144,140), rgb(34,167,132), rgb(68,190,112), rgb(121,209,81), rgb(189,222,38), rgb(253,231,37))",
                              }}
                            />
                          ) : (
                            <div className="h-full w-full bg-gradient-to-r from-black to-white" />
                          )}
                        </div>
                        <span className="text-[10px] text-white/50 ml-1">
                          {logScale ? "log" : "linear"}
                        </span>
                      </div>
                      <div className="text-white/60">
                        Max:{" "}
                        <span className="font-mono text-white/85">
                          {maxValue.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-white/60">
                        Grid:{" "}
                        <span className="font-mono text-white/85">
                          {plumeMutation.data.grid.length}×
                          {plumeMutation.data.grid[0]?.length || 0}
                        </span>
                        <span className="ml-2">Cell:</span>{" "}
                        <span className="font-mono text-white/85">
                          {plumeMutation.data.cell} m
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Micro-ΔT */}
            {plumeMutation.data && (
              <Card className="rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur ring-1 ring-inset ring-white/5">
                <CardHeader>
                  <CardTitle className="text-base text-white/90">
                    Estimated Micro-ΔT
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-2xl font-bold">
                      {calculateMicroDeltaT()}
                    </div>
                    <p className="text-sm text-white/70">
                      Based on emission rate (
                      <span className="font-mono">{emissionRate}</span>) and
                      wind speed (<span className="font-mono">{windSpeed}</span>{" "}
                      m/s). Higher emissions and lower wind speeds yield greater
                      localized warming.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Bottom hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
