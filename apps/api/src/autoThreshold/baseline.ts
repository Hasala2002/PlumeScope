import { z } from "zod";

// Histogram type
export const HistSchema = z.object({
  bins: z.array(z.number()), // K+1 edges (log-space)
  counts: z.array(z.number().nonnegative()), // K counts
  log_space: z.literal(true),
});
export type Hist = z.infer<typeof HistSchema>;

export type ChooseLocalInput = {
  hist: Hist;
  grid: { cell_m: number; cells: number };
  constraints: { min_precision: number; min_area_km2: number; max_area_km2: number };
  priors: { wind_dir_deg_mean: number; stability_mode: "A"|"B"|"C"|"D"|"E"|"F" };
};

export type ChooseLocalOutput = {
  C_thr: number; // absolute (linear) threshold
  percentile?: number;
  precision_proxy: number; // 0..1
  area_km2: number;
  method: string; // e.g. "baseline:otsu" or "baseline:p99"
};

function clamp01(x:number){ return Math.max(0, Math.min(1, x)); }

function midsFromEdges(edges:number[]): number[] {
  const K = edges.length - 1;
  const mids = new Array<number>(K);
  for (let i=0;i<K;i++) mids[i] = 0.5*(edges[i] + edges[i+1]);
  return mids;
}

// Otsu threshold on scalar histogram (log-space values)
function otsuThresholdLog(hist: Hist): number {
  const { bins, counts } = hist;
  const K = counts.length;
  if (K === 0) return 0;
  const mids = midsFromEdges(bins);
  const N = counts.reduce((s,c)=>s+c,0);
  if (N <= 0) return mids[Math.floor(K/2)] ?? 0;

  // Cumulative sums
  const P1: number[] = new Array(K).fill(0);
  const M1: number[] = new Array(K).fill(0);
  let csum = 0;
  let msum = 0;
  for (let t=0;t<K;t++){
    csum += counts[t];
    msum += counts[t] * mids[t];
    P1[t] = csum / N;
    M1[t] = msum / Math.max(1e-12, csum);
  }
  const muT = msum / N;

  let bestVar = -1;
  let bestIdx = Math.floor(K/2);
  for (let t=0;t<K-1;t++){
    const w1 = P1[t];
    const w2 = 1 - w1;
    if (w1 <= 0 || w2 <= 0) continue;
    const mu1 = M1[t];
    const mu2 = (muT - w1*mu1) / Math.max(1e-12, w2);
    const between = w1 * w2 * (mu1 - mu2) * (mu1 - mu2);
    if (between > bestVar){ bestVar = between; bestIdx = t; }
  }
  // Return threshold between bestIdx and bestIdx+1 (use midpoint)
  return 0.5*(bins[bestIdx] + bins[bestIdx+1]);
}

function percentileLog(hist: Hist, pct: number): number {
  const { bins, counts } = hist;
  const K = counts.length;
  const N = counts.reduce((s,c)=>s+c,0);
  if (N <= 0 || K === 0) return 0;
  const target = clamp01(pct/100) * N;
  let acc = 0;
  for (let i=0;i<K;i++){
    const before = acc;
    acc += counts[i];
    if (acc >= target){
      // Linear interpolate within bin using midpoints as proxy
      const frac = (target - before)/Math.max(1, counts[i]);
      const lo = bins[i], hi = bins[i+1];
      return lo + frac * (hi - lo);
    }
  }
  return bins[K];
}

function sigmaY(stab: "A"|"B"|"C"|"D"|"E"|"F", x_m: number){
  const x = Math.max(0.001, x_m/1000);
  const table: Record<string, {ay:number, by:number}> = {
    A:{ ay:0.22, by:0.0001 },
    B:{ ay:0.16, by:0.0001 },
    C:{ ay:0.11, by:0.0001 },
    D:{ ay:0.08, by:0.0001 },
    E:{ ay:0.06, by:0.0001 },
    F:{ ay:0.04, by:0.0001 },
  };
  const {ay,by} = table[stab];
  const sigy_km = ay * x / Math.sqrt(1 + by * x);
  return Math.max(1, sigy_km * 1000); // meters
}

function tailCountAbove(hist: Hist, logTau:number): number{
  const { bins, counts } = hist;
  const K = counts.length;
  let idx = 0;
  while (idx < K && bins[idx+1] < logTau) idx++;
  // Include this bin and all higher
  let total = 0;
  for (let i=idx;i<K;i++) total += counts[i];
  return total;
}

export function precisionProxy(
  tau_linear:number,
  input: { hist: Hist; grid: { cell_m:number, cells:number }; priors: { stability_mode: "A"|"B"|"C"|"D"|"E"|"F" } }
): number {
  // Convert tau to log-space for counting from histogram
  const logTau = Math.log1p(Math.max(0, tau_linear));
  const nAbove = tailCountAbove(input.hist, logTau);
  const m2 = nAbove * input.grid.cell_m * input.grid.cell_m;
  const area_km2 = m2 / 1_000_000;

  // Corridor width at 5 km: ~±1.96σy; corridor length ~10 km
  const sigy = sigmaY(input.priors.stability_mode, 5000);
  const width = 2 * 1.96 * sigy; // meters
  const length = 10_000; // meters
  const corridor_km2 = (width * length) / 1_000_000;

  const ratio = area_km2 / Math.max(1e-6, corridor_km2);
  // Map ratio -> precision [0,1]; smaller area vs corridor => higher precision
  const prec = 1 / (1 + ratio); // ratio=0 =>1, ratio=1 =>0.5, ratio=3 =>0.25
  return clamp01(prec);
}

export function chooseThresholdLocal(input: ChooseLocalInput): ChooseLocalOutput {
  const { hist, grid, constraints, priors } = input;
  HistSchema.parse(hist);

  // Build candidate set: Otsu + percentile ladder
  const pcts = [99.5, 99, 98, 97, 95];
  const candidates: { tauLog:number; label:string; percentile?:number }[] = [];

  const otsuLog = otsuThresholdLog(hist);
  candidates.push({ tauLog: otsuLog, label: "baseline:otsu" });
  for (const p of pcts){
    candidates.push({ tauLog: percentileLog(hist, p), label: `baseline:p${p}`, percentile: p });
  }

  // Sort by increasing linear tau (prefer smallest that passes)
  candidates.sort((a,b)=> Math.expm1(a.tauLog) - Math.expm1(b.tauLog));

  let bestPassing: { out:ChooseLocalOutput; score:number } | null = null;
  let bestPrec: { out:ChooseLocalOutput; score:number } | null = null;

  for (const c of candidates){
    const C_thr = Math.expm1(Math.max(0, c.tauLog));
    const nAbove = tailCountAbove(hist, c.tauLog);
    const area_km2 = (nAbove * grid.cell_m * grid.cell_m) / 1_000_000;
    const prec = precisionProxy(C_thr, { hist, grid, priors });

    const out: ChooseLocalOutput = {
      C_thr,
      percentile: c.percentile,
      precision_proxy: prec,
      area_km2,
      method: c.label,
    };

    // Track best precision overall (tie-break by smaller area)
    const precScore = prec - 1e-6 * area_km2;
    if (!bestPrec || precScore > bestPrec.score) bestPrec = { out, score: precScore };

    const passes = (
      prec >= constraints.min_precision &&
      area_km2 >= constraints.min_area_km2 &&
      area_km2 <= constraints.max_area_km2
    );
    if (passes){
      // Smallest tau first due to sorting; pick first passing and stop
      if (!bestPassing) bestPassing = { out, score: C_thr };
    }
  }

  if (bestPassing) return bestPassing.out;
  // Fallback: take max precision
  return (bestPrec ? bestPrec.out : {
    C_thr: Math.expm1(otsuLog),
    precision_proxy: 0,
    area_km2: 0,
    method: "baseline:default",
  });
}
