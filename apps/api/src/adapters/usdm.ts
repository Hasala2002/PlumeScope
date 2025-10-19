import { cache, cacheKey, todayUTC } from "../util/cache.js";
import { getJsonWithRetry } from "../util/http.js";

export type AdapterOk<T> = { source: string; cached: boolean; value: T };
export type AdapterErr = { source: string; cached: false; value: null; error: string };
export type AdapterResult<T> = AdapterOk<T> | AdapterErr;

const SOURCE = "usdm";

export type DroughtClass = "None" | "D0" | "D1" | "D2" | "D3" | "D4";

export async function getDroughtClass(
  lat: number,
  lon: number,
): Promise<AdapterResult<{ dm: DroughtClass; value: number }>> {
  const date = todayUTC();
  const key = cacheKey("drought", lat, lon, date);
  const cached = cache.get(key) as { dm: DroughtClass; value: number } | undefined;
  if (cached !== undefined) return { source: SOURCE, cached: true, value: cached };

  const url =
    "https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/US_Drought_Monitor/MapServer/0/query";
  const params = {
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "DM",
    returnGeometry: false,
    f: "json",
  };

  try {
    const j: any = await getJsonWithRetry<any>(url, params, { retries: 3, backoffMs: 300 });
    const dm: DroughtClass = j?.features?.[0]?.attributes?.DM ?? "None";
    const mapping: Record<DroughtClass, number> = {
      None: 0,
      D0: 0.2,
      D1: 0.4,
      D2: 0.6,
      D3: 0.8,
      D4: 1,
    };
    const value = mapping[dm];
    const out = { dm, value } as const;
    cache.set(key, out);
    return { source: SOURCE, cached: false, value: out };
  } catch (e: any) {
    const error = e?.code === "ECONNABORTED" ? "TIMEOUT" : e?.message || "ERROR";
    return { source: SOURCE, cached: false, value: null, error };
  }
}
