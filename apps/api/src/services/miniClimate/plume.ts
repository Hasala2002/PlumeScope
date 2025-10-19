import { z } from "zod";

export type Stability = "A" | "B" | "C" | "D" | "E" | "F";

export const paramsSchema = z.object({
  u: z.number().positive().max(50).default(5), // wind speed m/s
  dir: z.number().min(0).max(360).default(280), // degrees toward which wind blows
  stab: z.enum(["A", "B", "C", "D", "E", "F"]).default("D"),
  q: z.number().positive().max(1e6).default(1), // emission rate (arb.)
  Hs: z.number().nonnegative().max(300).default(0), // source height (m)
  n: z.number().int().min(11).max(201).default(81), // grid size (odd preferred)
  half: z.number().int().min(1000).max(100000).default(20000), // half-size (m)
});

export function sigmas(x: number, stab: Stability): { sy: number; sz: number } {
  const X = Math.max(1, x);
  switch (stab) {
    case "A":
      return { sy: 0.22 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.20 * X };
    case "B":
      return { sy: 0.16 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.12 * X };
    case "C":
      return { sy: 0.11 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.08 * X * (1 + 0.0002 * X) ** -0.5 };
    case "D":
      return { sy: 0.08 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.06 * X * (1 + 0.0015 * X) ** -0.5 };
    case "E":
      return { sy: 0.06 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.03 * X * (1 + 0.0003 * X) ** -1 };
    case "F":
      return { sy: 0.04 * X * (1 + 0.0001 * X) ** -0.5, sz: 0.016 * X * (1 + 0.0003 * X) ** -1 };
  }
}

export function gaussianPlumeGrid(p: z.infer<typeof paramsSchema>) {
  const { u, dir, stab, q, Hs, n, half } = p;
  const cell = (half * 2) / (n - 1);
  const theta = (dir * Math.PI) / 180; // radians
  const cosT = Math.cos(theta), sinT = Math.sin(theta);

  const grid: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const x0 = -half + i * cell;
      const y0 = -half + j * cell;
      // rotate so x' is downwind axis
      const x = x0 * Math.cos(theta) + y0 * Math.sin(theta);
      const y = -x0 * Math.sin(theta) + y0 * Math.cos(theta);

      if (x <= 0) {
        row.push(0);
        continue;
      }
      const { sy, sz } = sigmas(x, stab);
      const termY = Math.exp(-(y * y) / (2 * sy * sy));
      const termZ = Math.exp(-(Hs * Hs) / (2 * sz * sz)); // ground reflection approx: double
      const C = (q / (2 * Math.PI * u * sy * sz)) * termY * (2 * termZ);
      row.push(C);
    }
    grid.push(row);
  }
  return { n, half, cell, grid, meta: { u, dir, stab, q, Hs } };
}
