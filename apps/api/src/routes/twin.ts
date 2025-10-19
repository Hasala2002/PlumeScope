import { Router } from "express";
import { z } from "zod";
import { getState, getSpeed, nowSim, pause, resume, setMode, setSpeed } from "../twin/timebase.js";
import { nextParams, TwinParams } from "../twin/generator.js";
import { getById } from "../repo/sitesRepo.js";

export const twin = Router();

// State endpoints

twin.get("/state", (req, res) => {
  res.json(getState());
});

twin.post("/mode", (req, res) => {
  const schema = z.object({ mode: z.enum(["simulate","twin"]), speed: z.number().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "bad-params", details: p.error.flatten() });
  setMode(p.data.mode);
  if (typeof p.data.speed === "number") setSpeed(p.data.speed);
  res.json(getState());
});

// SSE stream: 1 Hz real-time; each event = 1 simulated hour at 3600x

twin.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let alive = true;
  req.on("close", () => { alive = false; });

  // Site stack height if available
  const siteId = String(req.query.siteId ?? "");
  // In this prototype, use default stack height; extend with repo data later
  const siteMeta = { Hs: 10 } as { Hs?: number };

  // Initial params
  let prev: TwinParams = { u:5, dir:270, q:1, half:20000, stab:"D", Hs: siteMeta.Hs ?? 10 };

  // Stability hysteresis persistence
  let targetSameCount = 0;
  let lastTarget: TwinParams["stab"] = prev.stab;

  const stabOrder = ["A","B","C","D","E","F"] as const;
  const idx = (s: TwinParams["stab"]) => stabOrder.indexOf(s);

  const tick = () => {
    if (!alive) return;
    const simMs = nowSim();
    const simDate = new Date(simMs);

    // Propose next
    const proposed = nextParams(prev, simDate, siteMeta);

    // Hysteresis guardrails (13.T6):
    const target = proposed.stab;
    if (target === lastTarget) {
      targetSameCount++;
    } else {
      lastTarget = target;
      targetSameCount = 1;
    }
    let next = { ...proposed };
    const diff = Math.abs(idx(target) - idx(prev.stab));
    if (diff >= 2 || targetSameCount >= 3) {
      // allow as proposed (already stepwise)
    } else {
      // hold previous stability
      next.stab = prev.stab;
    }

    prev = next;
    const payload = { simTimeISO: simDate.toISOString(), speed: getSpeed(), params: next };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const iv = setInterval(() => {
    if (!alive) { clearInterval(iv); return; }
    tick();
  }, 1000);
});