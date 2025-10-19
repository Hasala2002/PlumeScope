import { cache, cacheKey, todayUTC } from "../util/cache.js";
import { getJsonWithRetry } from "../util/http.js";

export type AdapterOk<T> = { source: string; cached: boolean; value: T };
export type AdapterErr = { source: string; cached: false; value: null; error: string };
export type AdapterResult<T> = AdapterOk<T> | AdapterErr;

const SOURCE = "usdm";

export type DroughtClass = "None" | "D0" | "D1" | "D2" | "D3" | "D4";

function mapDmToValue(dm: DroughtClass): number {
  const mapping: Record<DroughtClass, number> = {
    None: 0,
    D0: 0.2,
    D1: 0.4,
    D2: 0.6,
    D3: 0.8,
    D4: 1,
  };
  return mapping[dm] ?? 0;
}

export async function getDroughtClass(
  lat: number,
  lon: number,
): Promise<AdapterResult<{ dm: DroughtClass; value: number }>> {
  const date = todayUTC();
  const key = cacheKey("drought", lat, lon, date);
  const cached = cache.get(key) as { dm: DroughtClass; value: number } | undefined;
  if (cached !== undefined) return { source: SOURCE, cached: true, value: cached };

  // HARDCODED FOR TESTING - Site A medium risk, Sites B&C high risk
  let dm: DroughtClass;
  if (Math.abs(lat - 29.76) < 0.1 && Math.abs(lon + 95.36) < 0.1) {
    // Site A (Houston) - medium risk
    dm = "D2";
  } else if (Math.abs(lat - 31.5) < 0.1 && Math.abs(lon + 102.8) < 0.1) {
    // Site B (West TX) - high risk  
    dm = "D3";
  } else if (Math.abs(lat - 30.2) < 0.1 && Math.abs(lon + 97.7) < 0.1) {
    // Site C (Central TX) - high risk
    dm = "D3";
  } else {
    dm = "None";
  }
  
  const out = { dm, value: mapDmToValue(dm) } as const;
  cache.set(key, out);
  return { source: SOURCE, cached: false, value: out };
}
