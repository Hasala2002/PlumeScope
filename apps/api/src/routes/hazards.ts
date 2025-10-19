import { Router } from "express";
import { getFloodFlag } from "../adapters/fema.js";
import { getDroughtClass } from "../adapters/usdm.js";
import { getHeatIndex } from "../adapters/heat.js";

export const hazards = Router();

// FEMA Flood (identify)
hazards.get("/flood", async (req, res) => {
  const { lat, lon } = req.query as any;
  if (lat === undefined || lon === undefined) return res.status(400).json({ error: "lat/lon required" });
  const la = Number(lat), lo = Number(lon);
  const r = await getFloodFlag(la, lo);
  if ("error" in r) return res.json({ source: r.source, value: null, cached: false, error: r.error });
  return res.json({ flood: r.value, source: r.source, cached: r.cached });
});

// US Drought Monitor — returns {dm, value}
hazards.get("/drought", async (req, res) => {
  const { lat, lon } = req.query as any;
  if (lat === undefined || lon === undefined) return res.status(400).json({ error: "lat/lon required" });
  const la = Number(lat), lo = Number(lon);
  const r = await getDroughtClass(la, lo);
  if ("error" in r) return res.json({ source: r.source, value: null, cached: false, error: r.error });
  return res.json({ dm: r.value.dm, value: r.value.value, source: r.source, cached: r.cached });
});

// Heat index (placeholder)
hazards.get("/heat", async (req, res) => {
  const { lat, lon } = req.query as any;
  if (lat === undefined || lon === undefined) return res.status(400).json({ error: "lat/lon required" });
  const la = Number(lat), lo = Number(lon);
  const r = await getHeatIndex(la, lo);
  if ("error" in r) return res.json({ source: r.source, value: null, cached: false, error: r.error });
  return res.json({ heatIndex: r.value, source: r.source, cached: r.cached });
});
