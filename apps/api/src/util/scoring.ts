export function norm(x: number, max: number): number {
  return max > 0 ? Math.min(1, x / max) : 0;
}
export function simpleRisk(sites: any[]) {
  const maxCO2 = Math.max(...sites.map((s) => s.CO2e_tpy));
  const maxCH4 = Math.max(...sites.map((s) => s.CH4_tpy));
  return sites
    .map((s) => {
      const EmissionsScore =
        0.5 * norm(s.CO2e_tpy, maxCO2) + 0.5 * norm(s.CH4_tpy, maxCH4);
      const FloodScore = 0.4; // placeholder until hazard lookups wired
      const HeatScore = 0.5;
      const DroughtScore = 0.3;
      const PeopleRiskScore = 0.2; // placeholder for simple risk - would need population data integration
      const Risk =
        0.35 * EmissionsScore +
        0.25 * FloodScore +
        0.2 * HeatScore +
        0.1 * DroughtScore +
        0.1 * PeopleRiskScore;
      return {
        ...s,
        EmissionsScore,
        FloodScore,
        HeatScore,
        DroughtScore,
        PeopleRiskScore,
        Risk,
      };
    })
    .sort((a, b) => b.Risk - a.Risk);
}
