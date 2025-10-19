import fs from "fs";
import { z } from "zod";

export type Delta = { emissions: number; flood: number; heat: number; drought: number };
export type Mitigation = {
  id: string;
  label: string;
  cost: number; // dollars
  expectedDelta: Delta; // 0..1 fractional reduction potential
};

const MitigationSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    cost: z.number().positive(),
    expectedDelta: z.object({
      emissions: z.number().min(0).max(1),
      flood: z.number().min(0).max(1),
      heat: z.number().min(0).max(1),
      drought: z.number().min(0).max(1),
    }),
  })
  .strict();

const CatalogSchema = z.array(MitigationSchema);

let CATALOG: Mitigation[] | null = null;

function loadCatalog(): Mitigation[] {
  if (CATALOG) return CATALOG;
  const raw = fs.readFileSync(new URL("../../data/mitigations.json", import.meta.url), "utf8");
  const json = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const parsed = CatalogSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid mitigations catalog: " + parsed.error.message);
  }
  CATALOG = parsed.data;
  return CATALOG;
}

export type OptWeights = { wE: number; wF: number; wH: number; wD: number };
export const defaultOptWeights: OptWeights = { wE: 0.35, wF: 0.35, wH: 0.2, wD: 0.1 };

function benefitOf(m: Mitigation, w: OptWeights): number {
  const d = m.expectedDelta;
  return w.wE * d.emissions + w.wF * d.flood + w.wH * d.heat + w.wD * d.drought;
}

export type OptimizeResult = {
  picked: Array<Mitigation & { benefit: number; ratio: number }>;
  totalCost: number;
  totalBenefit: number;
  remaining: number;
  notes: string[];
};

// 0/1 knapsack using sparse DP by cost (scaled to $1,000 units for tractability)
export function optimize(budgetDollars: number, weights: OptWeights = defaultOptWeights): OptimizeResult {
  const items = loadCatalog().map((m) => ({ ...m, benefit: benefitOf(m, weights) }));
  const scale = 1000; // $1k units
  const B = Math.max(0, Math.floor(budgetDollars / scale));
  type Cell = { benefit: number; take?: number }; // take = index of item taken leading here
  const dp: Cell[] = Array(B + 1).fill(null).map(() => ({ benefit: 0 }));
  const from: number[][] = Array(items.length).fill(null).map(() => Array(B + 1).fill(0));

  items.forEach((it, idx) => {
    const w = Math.floor(it.cost / scale);
    for (let b = B; b >= w; b--) {
      const cand = dp[b - w].benefit + it.benefit;
      if (cand > dp[b].benefit) {
        dp[b] = { benefit: cand, take: idx };
        from[idx][b] = 1;
      }
    }
  });

  // Reconstruct picks
  const pickedIdxs: number[] = [];
  let b = B;
  for (let i = items.length - 1; i >= 0; i--) {
    const w = Math.floor(items[i].cost / scale);
    if (b >= w && from[i][b] === 1) {
      pickedIdxs.push(i);
      b -= w;
    }
  }

  pickedIdxs.reverse();
  const picked = pickedIdxs.map((i) => ({ ...items[i], ratio: items[i].benefit / items[i].cost }));
  const totalCost = picked.reduce((s, it) => s + it.cost, 0);
  const totalBenefit = picked.reduce((s, it) => s + it.benefit, 0);
  const remaining = Math.max(0, budgetDollars - totalCost);

  // Notes
  const notes: string[] = [];
  notes.push(`Weights => E:${weights.wE.toFixed(2)} F:${weights.wF.toFixed(2)} H:${weights.wH.toFixed(2)} D:${weights.wD.toFixed(2)}`);
  if (remaining > 0) notes.push(`Unused budget: $${remaining.toLocaleString()}`);
  const topByRatio = [...items].sort((a, b2) => b2.benefit / b2.cost - a.benefit / a.cost).slice(0, 3);
  notes.push(`Top benefit-per-$ items: ${topByRatio.map((x) => `${x.id}(${(x.benefit / x.cost).toFixed(6)})`).join(", ")}`);

  // Mention excluded items if budget limited
  const excluded = items.filter((_, i) => !pickedIdxs.includes(i));
  if (excluded.length) {
    const mostMissed = excluded.sort((a, b2) => b2.benefit - a.benefit)[0];
    notes.push(`Best not chosen due to budget/combination: ${mostMissed.id} (benefit ${(mostMissed.benefit).toFixed(3)})`);
  }

  return { picked, totalCost, totalBenefit, remaining, notes };
}
