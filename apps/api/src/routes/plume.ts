import { Router } from "express";
import { z } from "zod";

const schema = z.object({
  u: z.coerce.number().min(0.5).max(20).default(5),      // m/s
  dir: z.coerce.number().min(0).max(360).default(270),   // deg
  stab: z.enum(["A","B","C","D","E","F"]).default("D"),
  q: z.coerce.number().min(0.001).max(1000).default(1),  // emission rate (arb.)
  Hs: z.coerce.number().min(0).max(100).default(10),     // stack height (m)
  n: z.coerce.number().int().min(41).max(161).default(101),
  half: z.coerce.number().min(5000).max(30000).default(20000) // m
});

function sigma(stab: "A"|"B"|"C"|"D"|"E"|"F", x_m: number) {
  // x in km for PG parameterization
  const x = Math.max(0.001, x_m / 1000);
  // Very lightweight PG-ish curves
  // σy: more spread for unstable (A) than stable (F)
  // σz: grows slower under stable conditions
  const table: Record<string, {ay:number, by:number, az:number, bz:number}> = {
    A:{ ay:0.22, by:0.0001, az:0.20, bz:0.0001 },
    B:{ ay:0.16, by:0.0001, az:0.12, bz:0.0001 },
    C:{ ay:0.11, by:0.0001, az:0.08, bz:0.0001 },
    D:{ ay:0.08, by:0.0001, az:0.06, bz:0.0001 },
    E:{ ay:0.06, by:0.0001, az:0.03, bz:0.0001 },
    F:{ ay:0.04, by:0.0001, az:0.016,bz:0.0001 },
  };
  const {ay,by,az,bz} = table[stab];
  // Common simple forms used in screening calcs:
  const sigy = ay * x / Math.sqrt(1 + by * x);
  const sigz = az * x / Math.sqrt(1 + bz * x);
  return {
    sigy: Math.max(1, sigy * 1000), // back to meters; min 1m
    sigz: Math.max(1, sigz * 1000),
  };
}

export const plume = Router().get("/", (req, res) => {
  const p = schema.safeParse(req.query);
  if (!p.success) return res.status(400).json({ error: "bad-params", details: p.error.flatten() });
  const { u, dir, stab, q, Hs, n, half } = p.data;

  const size = n, span = half * 2;
  const cell = span / (size - 1);

  let maxC = 0, minC = Number.POSITIVE_INFINITY;
  const grid: number[][] = Array.from({length: size}, () => Array<number>(size).fill(0));

  for (let i=0;i<size;i++){
    for (let j=0;j<size;j++){
      // local coordinates: +x is downwind axis, +y is crosswind (per 13.1.b we rotate on client)
      const x = -half + i * cell;     // meters
      const y =  half - j * cell;     // meters (row 0 at top)
      if (x <= 0) { grid[j][i] = 0; continue; } // ignore upwind half

      const { sigy, sigz } = sigma(stab, x);
      // Gaussian plume at ground (z=0) with image reflection
      const center = Math.exp(-(y*y) / (2*sigy*sigy));
      const vertical = Math.exp(-(Hs*Hs) / (2*sigz*sigz));  // z=0: Hs above ground
      const C = (q / (2 * Math.PI * u * sigy * sigz)) * center * (2 * vertical);

      grid[j][i] = C;
      if (C > maxC) maxC = C;
      if (C < minC) minC = C;
    }
  }

  if (!isFinite(minC)) minC = 0;

  res.json({
    n: size, cell, half, grid,
    meta: { u, dir, stab, q, Hs, maxC, minC }
  });
});
