import { cache, cacheKey, todayUTC } from "../util/cache.js";
import { getJsonWithRetry } from "../util/http.js";

export type AdapterOk<T> = { source: string; cached: boolean; value: T };
export type AdapterErr = { source: string; cached: false; value: null; error: string };
export type AdapterResult<T> = AdapterOk<T> | AdapterErr;

const SOURCE = "fema";

export async function getFloodFlag(lat: number, lon: number): Promise<AdapterResult<0 | 1>> {
  const date = todayUTC();
  const key = cacheKey("flood", lat, lon, date);
  const cached = cache.get(key) as 0 | 1 | undefined;
  if (cached !== undefined) return { source: SOURCE, cached: true, value: cached };

  const url =
    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/identify";
  const params = {
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: 4326,
    layers: "all:0",
    tolerance: 0,
    mapExtent: "-180,-90,180,90",
    imageDisplay: "256,256,96",
    f: "json",
  };

  try {
    const j: any = await getJsonWithRetry<any>(url, params, { retries: 3, backoffMs: 300 });
    const flag: 0 | 1 = j?.results && j.results.length ? 1 : 0;
    cache.set(key, flag);
    return { source: SOURCE, cached: false, value: flag };
  } catch (e: any) {
    const error = e?.code === "ECONNABORTED" ? "TIMEOUT" : e?.message || "ERROR";
    return { source: SOURCE, cached: false, value: null, error };
  }
}
