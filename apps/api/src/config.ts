export const AUTO_THRESHOLD = {
  GEMINI_MIN_INTERVAL_S: 30,
  GEMINI_MAX_PER_SESSION: 10,
  JSD_THR: 0.08,
  AREA_DELTA_THR: 0.05,
  EMA_ALPHA: 0.3,
  HYSTERESIS_PCT: 0.05,
  HYSTERESIS_HOLD_TICKS: 3,
  MIN_AREA_KM2: 0.2,
  MAX_AREA_KM2: 50,
  MIN_PRECISION: 0.8,
} as const;

export function publicConfig() {
  return {
    AUTO_THRESHOLD,
    hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
  } as const;
}
