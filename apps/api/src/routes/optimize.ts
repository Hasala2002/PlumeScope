import { Router } from "express";
import { optimize as solve, defaultOptWeights, OptWeights } from "../services/optimizeService.js";

export const optimize = Router().post("/", (req, res) => {
  const budget = Number(req.query.budget ?? 500000);
  const w = (req.body?.weights ?? req.body ?? {}) as any;
  const weights: OptWeights = {
    wE: isFinite(Number(w.wE)) ? Number(w.wE) : defaultOptWeights.wE,
    wF: isFinite(Number(w.wF)) ? Number(w.wF) : defaultOptWeights.wF,
    wH: isFinite(Number(w.wH)) ? Number(w.wH) : defaultOptWeights.wH,
    wD: isFinite(Number(w.wD)) ? Number(w.wD) : defaultOptWeights.wD,
  };

  const result = solve(budget, weights);
  res.json({
    budget,
    weights,
    totalCost: result.totalCost,
    totalBenefit: result.totalBenefit,
    remaining: result.remaining,
    picked: result.picked,
    notes: result.notes,
  });
});
