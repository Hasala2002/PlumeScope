import { Router } from "express";
import { z } from "zod";
import { AUTO_THRESHOLD } from "../config.js";
import { chooseThresholdLocal } from "../autoThreshold/baseline.js";
import { chooseThresholdGemini } from "../autoThreshold/geminiClient.js";

const Body = z.object({
  histogram: z.object({ bins: z.array(z.number()), counts: z.array(z.number().nonnegative()), log_space: z.boolean() }),
  grid: z.object({ cell_m: z.number().positive(), cells: z.number().int().positive() }),
  constraints: z.object({ min_precision: z.number().min(0).max(1), min_area_km2: z.number().min(0), max_area_km2: z.number().min(0) }),
  priors: z.object({ wind_dir_deg_mean: z.number().min(0).max(360), stability_mode: z.enum(["A","B","C","D","E","F"]) }),
  sessionId: z.string().min(1),
});

type SessionInfo = { count:number; lastCallAt:number };
const sessions = new Map<string, SessionInfo>();

export const threshold = Router();

threshold.post("/auto/evaluate", async (req, res) => {
  const p = Body.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "bad-params", details: p.error.flatten() });
  const { histogram, grid, constraints, priors, sessionId } = p.data;
  // Ensure log_space true
  if (!histogram.log_space) return res.status(400).json({ error: "hist-must-be-log-space" });

  // Always compute local baseline
  const baseline = chooseThresholdLocal({ hist: histogram as any, grid, constraints, priors });

  // Rate limiting per session
  const now = Date.now();
  const s = sessions.get(sessionId) ?? { count: 0, lastCallAt: 0 };
  const nextAllowedAt = s.lastCallAt + AUTO_THRESHOLD.GEMINI_MIN_INTERVAL_S*1000;
  const tooSoon = now < nextAllowedAt;
  const overMax = s.count >= AUTO_THRESHOLD.GEMINI_MAX_PER_SESSION;

  if (tooSoon || overMax){
    return res.status(429).json({ error: "limit", baseline, meta: { usedGemini:false, callsUsed: s.count, nextAllowedAt } });
  }

  // Try Gemini with validation
  let usedGemini = false;
  let out = baseline;
  try {
    const payload = { histogram, grid, constraints, priors };
    const apiKey = process.env.GEMINI_API_KEY || "";
    const resp = await chooseThresholdGemini(payload, apiKey);
    // Feasibility check against constraints
    const feasible = (
      resp.precision_proxy >= constraints.min_precision &&
      resp.area_km2 >= constraints.min_area_km2 &&
      resp.area_km2 <= constraints.max_area_km2 &&
      resp.C_thr > 0
    );
    if (feasible) { out = { C_thr: resp.C_thr, percentile: resp.percentile, precision_proxy: resp.precision_proxy, area_km2: resp.area_km2, method: resp.method || "gemini" }; usedGemini = true; }
  } catch (e) {
    usedGemini = false; // fallback to baseline
  }

  // update session counters
  s.count += 1;
  s.lastCallAt = now;
  sessions.set(sessionId, s);

  return res.json({ ...out, meta: { usedGemini, callsUsed: s.count, nextAllowedAt: now + AUTO_THRESHOLD.GEMINI_MIN_INTERVAL_S*1000 } });
});
