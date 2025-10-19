import { Router } from "express";
import { z } from "zod";
import { getById } from "../repo/sitesRepo.js";
import { co2ToMWh, mwhToWatts, ahfWm2, deltaT } from "../services/miniClimate/ahf.js";
import { paramsSchema, gaussianPlumeGrid } from "../services/miniClimate/plume.js";

export const miniClimate = Router();

// AHF endpoint
miniClimate.get("/ahf/:id", (req, res) => {
  const site = getById(req.params.id);
  if (!site) return res.status(404).json({ error: "NOT_FOUND" });

  const q = req.query as any;
  const areaKm2 = Number(q.areaKm2 ?? 2);
  const H = Number(q.H ?? 300);
  const tau_h = Number(q.tau_h ?? q.tau ?? 1);
  if (!isFinite(areaKm2) || areaKm2 <= 0) return res.status(400).json({ error: "areaKm2>0" });

  const mwh = co2ToMWh(site.CO2e_tpy);
  const watts = mwhToWatts(mwh);
  const ahf = ahfWm2(watts, areaKm2);
  const dT = deltaT(ahf, H, tau_h);

  return res.json({ ahf_wm2: ahf, deltaT_c: dT });
});

// Plume endpoint
miniClimate.get("/plume/:id", (req, res) => {
  const site = getById(req.params.id);
  if (!site) return res.status(404).json({ error: "NOT_FOUND" });

  const parsed = paramsSchema.safeParse({
    u: req.query.u ? Number(req.query.u) : undefined,
    dir: req.query.dir ? Number(req.query.dir) : undefined,
    stab: req.query.stab ? String(req.query.stab).toUpperCase() : undefined,
    q: req.query.q ? Number(req.query.q) : undefined,
    Hs: req.query.Hs ? Number(req.query.Hs) : undefined,
    n: req.query.n ? Number(req.query.n) : undefined,
    half: req.query.half ? Number(req.query.half) : undefined,
  });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const grid = gaussianPlumeGrid(parsed.data);
  return res.json(grid);
});
