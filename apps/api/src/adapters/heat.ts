import { cache, cacheKey, todayUTC } from "../util/cache.js";

export type AdapterOk<T> = { source: string; cached: boolean; value: T };
export type AdapterErr = { source: string; cached: false; value: null; error: string };
export type AdapterResult<T> = AdapterOk<T> | AdapterErr;

const SOURCE = "heat";

// Deterministic placeholder: combine sin/cos of coords to produce 0..1
function deterministicHeat(lat: number, lon: number): number {
  const s = Math.sin((lat + 90) * Math.PI / 180) * Math.cos((lon + 180) * Math.PI / 180);
  // normalize from [-1,1] -> [0,1]
  return Number(((s + 1) / 2).toFixed(3));
}

export async function getHeatIndex(lat: number, lon: number): Promise<AdapterResult<number>> {
  const date = todayUTC();
  const key = cacheKey("heat", lat, lon, date);
  const cached = cache.get(key) as number | undefined;
  if (cached !== undefined) return { source: SOURCE, cached: true, value: cached };

  try {
    const value = deterministicHeat(lat, lon);
    cache.set(key, value);
    return { source: SOURCE, cached: false, value };
  } catch (e: any) {
    const error = e?.message || "ERROR";
    return { source: SOURCE, cached: false, value: null, error };
  }
}
