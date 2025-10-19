import { Router } from "express";
import { getAll, getById } from "../repo/sitesRepo.js";
import { enrichSite } from "../services/enrichmentService.js";
import { computeMaxes, scoreEmissionsOnly } from "../services/scoringService.js";

export const sites = Router();

// Pagination: limit & cursor (cursor = last item's id)
sites.get("/", (req, res) => {
  const all = getAll();
  const hasPaging = req.query.limit !== undefined || req.query.cursor !== undefined;
  if (!hasPaging) {
    return res.json(all);
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
  const cursor = (req.query.cursor as string | undefined) ?? undefined;
  let start = 0;
  if (cursor) {
    const idx = all.findIndex((s) => s.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const items = all.slice(start, start + limit);
  const nextCursor = items.length === limit ? items[items.length - 1].id : null;
  res.json({ items, nextCursor });
});

// Raw site by id
sites.get("/:id", (req, res) => {
  const s = getById(req.params.id);
  if (!s) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(s);
});

// Per-site score (emissions + hazards on-demand)
sites.get("/:id/score", async (req, res) => {
  const all = getAll();
  const site = all.find((s) => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: "NOT_FOUND" });

  const maxes = computeMaxes(all);
  const emissionsOnly = scoreEmissionsOnly(site, maxes, { emissions: 1, flood: 0, heat: 0, drought: 0, people_risk: 0 });

  const enr = await enrichSite(site);

  return res.json({
    site,
    EmissionsScore: emissionsOnly.EmissionsScore,
    FloodScore: enr.scores.flood,
    HeatScore: enr.scores.heat,
    DroughtScore: enr.scores.drought,
    HazardSnapshot: enr.hazardSnapshot,
    meta: { cacheHits: enr.cacheHits },
  });
});
