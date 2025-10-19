import { Router } from "express";
import { getAll } from "../repo/sitesRepo.js";
import { defaultWeights, scoreAllEmissionsOnly, scoreFused, computeMaxes } from "../services/scoringService.js";
import { enrichSite } from "../services/enrichmentService.js";
import { Weights } from "../types.js";

function parseWeights(q: any): Weights {
  const toNum = (v: any, d: number) => (v === undefined ? d : Number(v));
  return {
    emissions: toNum(q.wE, defaultWeights.emissions),
    flood: toNum(q.wF, defaultWeights.flood),
    heat: toNum(q.wH, defaultWeights.heat),
    drought: toNum(q.wD, defaultWeights.drought),
    people_risk: toNum(q.wP, defaultWeights.people_risk), // Support legacy 'wP' param for people risk
  };
}

export const score = Router();

// Deterministic emissions-only ranking
score.get("/", (req, res) => {
  const sites = getAll();
  const weights = parseWeights(req.query);
  const scored = scoreAllEmissionsOnly(sites, weights);
  res.json(scored);
});

// Simple global rate limiter for /live
let recentCalls: number[] = [];
const MAX_CALLS_PER_MINUTE = 12;
function allowCall(): boolean {
  const now = Date.now();
  const oneMinAgo = now - 60_000;
  recentCalls = recentCalls.filter((t) => t > oneMinAgo);
  if (recentCalls.length >= MAX_CALLS_PER_MINUTE) return false;
  recentCalls.push(now);
  return true;
}

// Live fused scoring with hazard enrichment
score.get("/live", async (req, res) => {
  if (!allowCall()) return res.status(429).json({ error: "RATE_LIMITED" });
  const t0 = Date.now();
  const weights = parseWeights(req.query);
  const sites = getAll();
  const maxes = computeMaxes(sites);

  const results = await Promise.all(sites.map((s) => enrichSite(s)));

  let cacheHits = 0;
  const items = results
    .map((r) => {
      cacheHits += r.cacheHits;
      const fused = scoreFused(r.site, r.scores, maxes, weights);
      return {
        ...fused,
        HazardSnapshot: r.hazardSnapshot,
      };
    })
    .sort((a, b) => b.Risk - a.Risk);

  const meta = { cacheHits, duration_ms: Date.now() - t0 };
  res.json({ meta, items });
});
