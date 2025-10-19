import { Site, HazardSnapshot } from "../types.js";
import { getFloodFlag } from "../adapters/fema.js";
import { getDroughtClass } from "../adapters/usdm.js";
import { getHeatIndex } from "../adapters/heat.js";
import { toHazardScores } from "./scoringService.js";

export type Enrichment = {
  site: Site;
  hazardSnapshot: HazardSnapshot;
  scores: { flood: number; drought: number; heat: number };
  cacheHits: number;
};

export async function enrichSite(site: Site): Promise<Enrichment> {
  const [flood, drought, heat] = await Promise.all([
    getFloodFlag(site.lat, site.lon),
    getDroughtClass(site.lat, site.lon),
    getHeatIndex(site.lat, site.lon),
  ]);

  const floodFlag = ("value" in flood && flood.value !== null ? flood.value : 0) as 0 | 1;
  const droughtClass = ("value" in drought && drought.value !== null ? drought.value.dm : "None") as HazardSnapshot["dm"];
  const heatIndex = ("value" in heat && heat.value !== null ? heat.value : 0) as number;

  const hazardSnapshot: HazardSnapshot = {
    flood: floodFlag,
    dm: droughtClass,
    heatIndex,
    ts: Date.now(),
  };

  const scores = toHazardScores({ floodFlag, droughtClass, heatIndex });
  const cacheHits = Number((flood as any).cached) + Number((drought as any).cached) + Number((heat as any).cached);

  return { site, hazardSnapshot, scores, cacheHits };
}
