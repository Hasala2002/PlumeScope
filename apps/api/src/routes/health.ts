import { Router } from "express";
export const health = Router().get("/", (_req, res) =>
  res.json({ ok: true, service: "api", ts: Date.now() }),
);
