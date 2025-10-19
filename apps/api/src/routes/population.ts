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
});

export const population = Router().post("/estimate", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "bad-params", details: parsed.error.flatten() });
  const { geojson, year, dataset, area_m2 } = parsed.data;

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

    res.json({
      source: "WorldPop",
      dataset,
      year,
      total_population: total,
      area_m2,
      density_per_km2,
    });
  } catch (e: any) {
    console.error("[population] WorldPop API failed:", e?.message);
    
    // Fallback: provide mock data based on area to keep the UI functional
    // Rough estimate: Texas population density is ~40 people/km²
    const km2 = area_m2 / 1_000_000;
    const estimatedPopulation = Math.round(km2 * 40); // 40 people per km²
    
    console.log(`[population] Using fallback estimate: ${estimatedPopulation} people for ${km2.toFixed(3)} km²`);
    
    res.json({
      source: "Fallback Estimate",
      dataset: "estimated",
      year,
      total_population: estimatedPopulation,
      area_m2,
      density_per_km2: 40, // Texas-like density
      note: "WorldPop API unavailable, using fallback estimate"
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