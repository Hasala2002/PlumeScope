import { z } from "zod";

// Domain types
export type Site = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  CO2e_tpy: number;
  CH4_tpy: number;
};

export type ScoredSite = Site & {
  EmissionsScore: number;
  FloodScore: number;
  HeatScore: number;
  DroughtScore: number;
  Risk: number;
};

export type HazardSnapshot = {
  flood: 0 | 1; // FEMA floodplain intersection
  dm: "None" | "D0" | "D1" | "D2" | "D3" | "D4"; // US Drought Monitor
  heatIndex: number; // placeholder 0..1
  ts: number; // epoch ms
};

export type Weights = {
  emissions: number;
  flood: number;
  heat: number;
  drought: number;
  proximity: number;
};

export type Maxes = {
  maxCO2: number;
  maxCH4: number;
};

export type Mitigation = {
  id: string;
  label: string;
  cost: number;
  benefit: number; // 0..1 reduction potential
};

// Zod schemas
export const SiteSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    lat: z.number().gte(-90).lte(90),
    lon: z.number().gte(-180).lte(180),
    CO2e_tpy: z.number().nonnegative(),
    CH4_tpy: z.number().nonnegative(),
  })
  .strict();

export const SitesArraySchema = z.array(SiteSchema);
