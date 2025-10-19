import { Router } from "express";
import { z } from "zod";
import fetch from "node-fetch";

const bodySchema = z.object({
  // A single polygon or multipolygon in EPSG:4326
  geojson: z
    .object({
      type: z.enum(["Feature", "FeatureCollection", "Polygon", "MultiPolygon"]),
    })
    .passthrough(),
  year: z.number().min(2000).max(2020).default(2020), // WorldPop range
  dataset: z.enum(["wpgppop", "wpgpas"]).default("wpgppop"),
  area_m2: z.number().positive(), // send from client (your computed affected area)
  siteId: z.string().optional(), // Site ID for fallback density selection
});

// Site-specific fallback densities (people per km²)
const FALLBACK_DENSITIES: Record<string, { density: number; description: string }> = {
  "S1": { density: 50, description: "Houston area - urban" },
  "S2": { density: 15, description: "West TX - remote area" }, // Reduced for Site B
  "S3": { density: 40, description: "Central TX - suburban" },
  "default": { density: 40, description: "Texas average" }
};

// Density classification thresholds (people per km²)
const DENSITY_THRESHOLDS = {
  LOW: 25,      // Rural areas
  MEDIUM: 100,  // Suburban areas  
  HIGH: 500,    // Urban areas
  VERY_HIGH: 2000 // Dense urban/metropolitan areas
};

function classifyDensity(density: number): { classification: string; risk_multiplier: number } {
  if (density <= DENSITY_THRESHOLDS.LOW) {
    return { classification: "low", risk_multiplier: 1.0 };
  } else if (density <= DENSITY_THRESHOLDS.MEDIUM) {
    return { classification: "medium", risk_multiplier: 1.2 };
  } else if (density <= DENSITY_THRESHOLDS.HIGH) {
    return { classification: "high", risk_multiplier: 1.5 };
  } else {
    return { classification: "very_high", risk_multiplier: 2.0 };
  }
}

export const population = Router().post("/estimate", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "bad-params", details: parsed.error.flatten() });
  const { geojson, year, dataset, area_m2, siteId } = parsed.data;

  const base = "https://api.worldpop.org/v1/services/stats";

  try {
    // Prefer POST to avoid very long URLs and to match API docs
    const r = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset, year, geojson, runasync: false }),
    });
    const j: any = await r.json();

    // If job got queued (async)
    if (j?.status === "created" && j?.taskid) {
      return res.status(202).json({ queued: true, taskid: j.taskid });
    }

    // Extract total_population from common shapes
    const totalCandidate =
      j?.data?.total_population ??
      j?.output?.total_population ??
      j?.summary?.total_population ??
      j?.total_population;

    if (j?.error) {
      return res.status(502).json({ error: "worldpop-failed", details: j });
    }

    if (!Number.isFinite(totalCandidate)) {
      return res.status(502).json({ error: "worldpop-failed", details: j });
    }

    const total = Number(totalCandidate) || 0;
    const km2 = area_m2 / 1_000_000;
    const density_per_km2 = km2 > 0 ? total / km2 : 0;
    const densityInfo = classifyDensity(density_per_km2);

    res.json({
      source: "WorldPop",
      dataset,
      year,
      total_population: total,
      area_m2,
      area_km2: km2,
      density_per_km2,
      density_classification: densityInfo.classification,
      risk_multiplier: densityInfo.risk_multiplier,
      note: `Higher density areas have increased pollution impact due to concentration effects and physical layout`
    });
  } catch (e: any) {
    console.error("[population] WorldPop API failed:", e?.message);
    
    // Fallback: provide site-specific mock data based on area
    const fallbackInfo = FALLBACK_DENSITIES[siteId || "default"] || FALLBACK_DENSITIES["default"];
    const km2 = area_m2 / 1_000_000;
    const estimatedPopulation = Math.round(km2 * fallbackInfo.density);
    
    const densityInfo = classifyDensity(fallbackInfo.density);
    console.log(`[population] Using fallback estimate for ${siteId || 'unknown site'}: ${estimatedPopulation} people for ${km2.toFixed(3)} km² (density: ${fallbackInfo.density}/km² - ${fallbackInfo.description})`);
    
    res.json({
      source: "Fallback Estimate",
      dataset: "estimated",
      year,
      total_population: estimatedPopulation,
      area_m2,
      area_km2: km2,
      density_per_km2: fallbackInfo.density,
      density_classification: densityInfo.classification,
      risk_multiplier: densityInfo.risk_multiplier,
      note: `WorldPop API unavailable, using fallback estimate (${fallbackInfo.description}). Higher density areas have increased pollution impact.`
    });
  }
});

// Optional: poll task endpoint if queued
population.get("/task/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const r = await fetch(`https://api.worldpop.org/v1/tasks/${id}`);
    const j = await r.json();
    res.json(j);
  } catch (e: any) {
    res.status(502).json({ error: "worldpop-error", message: e?.message });
  }
});