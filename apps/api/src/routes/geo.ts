import { Router } from "express";
import { getAll } from "../repo/sitesRepo.js";
import { scoreAllEmissionsOnly, defaultWeights } from "../services/scoringService.js";
import { Weights } from "../types.js";

export const geo = Router();

// Simple in-memory cache
let scoreCache: { data: any; timestamp: number; weights: string } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function parseWeights(q: any): Weights {
  const toNum = (v: any, d: number) => (v === undefined ? d : Number(v));
  return {
    emissions: toNum(q.wE, defaultWeights.emissions),
    flood: toNum(q.wF, defaultWeights.flood),
    heat: toNum(q.wH, defaultWeights.heat),
    drought: toNum(q.wD, defaultWeights.drought),
    proximity: toNum(q.wP, defaultWeights.proximity),
  };
}

function weightsKey(weights: Weights): string {
  return `${weights.emissions}_${weights.flood}_${weights.heat}_${weights.drought}_${weights.proximity}`;
}

geo.get("/sites", (_req, res) => {
  const sites = getAll();
  const fc = {
    type: "FeatureCollection",
    features: sites.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, CO2e_tpy: s.CO2e_tpy, CH4_tpy: s.CH4_tpy }
    }))
  };
  res.json(fc);
});

geo.get("/score", (req, res) => {
  const weights = parseWeights(req.query);
  const weightsKeyStr = weightsKey(weights);
  const now = Date.now();
  
  // Check cache
  if (scoreCache && 
      (now - scoreCache.timestamp) < CACHE_TTL && 
      scoreCache.weights === weightsKeyStr) {
    return res.json(scoreCache.data);
  }
  
  // Generate scored data
  const sites = getAll();
  const scored = scoreAllEmissionsOnly(sites, weights);
  
  const fc = {
    type: "FeatureCollection",
    features: scored.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        CO2e_tpy: s.CO2e_tpy,
        CH4_tpy: s.CH4_tpy,
        Risk: Number(s.Risk.toFixed(3)),
        EmissionsScore: Number(s.EmissionsScore.toFixed(3)),
        FloodScore: Number(s.FloodScore.toFixed(3)),
        HeatScore: Number(s.HeatScore.toFixed(3)),
        DroughtScore: Number(s.DroughtScore.toFixed(3))
      }
    }))
  };
  
  // Update cache
  scoreCache = {
    data: fc,
    timestamp: now,
    weights: weightsKeyStr
  };
  
  res.json(fc);
});
