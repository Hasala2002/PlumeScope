export const AUTO_THRESHOLD = {
  GEMINI_MIN_INTERVAL_S: 30,
  GEMINI_MAX_PER_SESSION: 10,
  JSD_THR: 0.08,
  AREA_DELTA_THR: 0.05,
  EMA_ALPHA: 0.3,
  HYSTERESIS_PCT: 0.05,
  HYSTERESIS_HOLD_TICKS: 3,
  MIN_AREA_KM2: 0.2,
  MAX_AREA_KM2: 50,
  MIN_PRECISION: 0.8,
} as const;

export function buildLogHist(vals: Float32Array, K = 128){
  let min = Infinity, max = -Infinity;
  for (const v of vals){ if (isFinite(v)){ if (v < min) min = v; if (v > max) max = v; } }
  if (!isFinite(min) || !isFinite(max) || min === max){ min = 0; max = min + 1e-6; }
  const bins = new Float32Array(K+1);
  const counts = new Uint32Array(K);
  for (let i=0;i<=K;i++) bins[i] = min + (i*(max-min))/K;
  for (const v of vals){
    if (!isFinite(v)) continue;
    const idx = Math.min(K-1, Math.max(0, Math.floor(((v-min)/(max-min))*K)));
    counts[idx]++;
  }
  return { bins: Array.from(bins), counts: Array.from(counts), log_space: true as const };
}

export function jsd(p:number[], q:number[]): number {
  const sum = (a:number[]) => a.reduce((s,x)=>s+x,0);
  const P = p.map(x => x / Math.max(1e-12, sum(p)));
  const Q = q.map(x => x / Math.max(1e-12, sum(q)));
  const M = P.map((pi,i)=> 0.5*(pi + (Q[i] ?? 0)));
  const KL = (A:number[], B:number[]) => A.reduce((s,ai,i)=> ai>0 && B[i]>0 ? s + ai*Math.log(ai/B[i]) : s, 0);
  return Math.sqrt(0.5*KL(P,M) + 0.5*KL(Q,M));
}

export function computeCmaxFromFrames(frames: { meta:{ n:number; maxC:number }; grid:number[][] }[]): Float32Array {
  if (!frames || frames.length === 0) return new Float32Array();
  // Use the newest frame's grid shape as reference; skip mismatched frames
  const n = frames[0]!.meta.n;
  const out = new Float32Array(n*n);
  for (let k=0;k<frames.length;k++){
    const f = frames[k];
    if (!f || f.meta.n !== n) continue; // skip different resolutions
    for (let j=0;j<n;j++){
      const row = f.grid[j];
      for (let i=0;i<n;i++){
        const idx = j*n + i;
        const v = row[i] ?? 0;
        if (v > out[idx]) out[idx] = v;
      }
    }
  }
  return out;
}
