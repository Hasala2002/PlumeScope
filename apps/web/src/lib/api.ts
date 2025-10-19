import axios from "axios";
const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
export const api = axios.create({ baseURL, timeout: 15000 });
export type Site = { id:string; name:string; lat:number; lon:number; CO2e_tpy:number; CH4_tpy:number; };

export type PopulationEstimate = {
  source: string;
  dataset: string;
  year: number;
  total_population: number;
  area_m2: number;
  density_per_km2: number;
};

export type PopulationQueued = { queued: true; taskid: string };

export async function postPopulationEstimate(body: {
  geojson: unknown;
  area_m2: number;
  year?: number;
  dataset?: "wpgppop" | "wpgpas";
  siteId?: string;
}): Promise<{ data: PopulationEstimate | PopulationQueued; status: number }> {
  const res = await api.post<PopulationEstimate | PopulationQueued>(
    "/population/estimate",
    { year: 2020, dataset: "wpgppop", ...body },
    { validateStatus: (s) => s >= 200 && s < 300 }
  );
  return { data: res.data, status: res.status };
}
