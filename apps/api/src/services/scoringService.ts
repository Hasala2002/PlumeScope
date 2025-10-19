import { Site, ScoredSite, Weights, Maxes } from "../types.js";

export function norm(x: number, max: number): number {
  return max > 0 ? Math.min(1, x / max) : 0;
}

export const defaultWeights: Weights = {
  emissions: 0.7,
  flood: 0,
  heat: 0,
  drought: 0,
  proximity: 0.3,
};

export function computeMaxes(sites: Site[]): Maxes {
  const maxCO2 = sites.length ? Math.max(...sites.map((s) => s.CO2e_tpy)) : 0;
  const maxCH4 = sites.length ? Math.max(...sites.map((s) => s.CH4_tpy)) : 0;
  return { maxCO2, maxCH4 };
}

export function scoreEmissionsOnly(
  site: Site,
  maxes: Maxes,
  weights: Weights,
): ScoredSite {
  const EmissionsScore = 0.5 * norm(site.CO2e_tpy, maxes.maxCO2) + 0.5 * norm(site.CH4_tpy, maxes.maxCH4);
  const FloodScore = 0;
  const HeatScore = 0;
  const DroughtScore = 0;
  const proximityScore = 0; // placeholder until implemented

  const Risk =
    weights.emissions * EmissionsScore +
    weights.flood * FloodScore +
    weights.heat * HeatScore +
    weights.drought * DroughtScore +
    weights.proximity * proximityScore;

  return {
    ...site,
    EmissionsScore,
    FloodScore,
    HeatScore,
    DroughtScore,
    Risk,
  };
}

export function scoreAllEmissionsOnly(
  sites: Site[],
  weights: Weights = defaultWeights,
): ScoredSite[] {
  const maxes = computeMaxes(sites);
  return sites
    .map((s) => scoreEmissionsOnly(s, maxes, weights))
    .sort((a, b) => b.Risk - a.Risk);
}

export type HazardScores = { flood: number; drought: number; heat: number };

export function toHazardScores(input: {
  floodFlag: 0 | 1;
  droughtClass: "None" | "D0" | "D1" | "D2" | "D3" | "D4";
  heatIndex: number; // 0..1
}): HazardScores {
  const flood = input.floodFlag; // already 0/1
  const droughtMap: Record<"None" | "D0" | "D1" | "D2" | "D3" | "D4", number> = {
    None: 0,
    D0: 0.2,
    D1: 0.4,
    D2: 0.6,
    D3: 0.8,
    D4: 1,
  };
  const drought = droughtMap[input.droughtClass] ?? 0;
  const heat = Math.max(0, Math.min(1, input.heatIndex));
  return { flood, drought, heat };
}

export function scoreFused(
  site: Site,
  hazard: HazardScores,
  maxes: Maxes,
  weights: Weights,
): ScoredSite {
  const EmissionsScore = 0.5 * norm(site.CO2e_tpy, maxes.maxCO2) + 0.5 * norm(site.CH4_tpy, maxes.maxCH4);
  const FloodScore = hazard.flood;
  const HeatScore = hazard.heat;
  const DroughtScore = hazard.drought;
  const proximityScore = 0; // placeholder until implemented

  const Risk =
    weights.emissions * EmissionsScore +
    weights.flood * FloodScore +
    weights.heat * HeatScore +
    weights.drought * DroughtScore +
    weights.proximity * proximityScore;

  return {
    ...site,
    EmissionsScore,
    FloodScore,
    HeatScore,
    DroughtScore,
    Risk,
  };
}
