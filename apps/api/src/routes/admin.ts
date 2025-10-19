import { Router } from "express";
import { publicConfig } from "../config.js";

export const admin = Router();

admin.get("/config", (_req, res) => {
  const cfg = publicConfig();
  res.json({
    AUTO_THRESHOLD: cfg.AUTO_THRESHOLD,
    secrets: { hasGeminiApiKey: cfg.hasGeminiApiKey },
    ts: Date.now(),
  });
});
