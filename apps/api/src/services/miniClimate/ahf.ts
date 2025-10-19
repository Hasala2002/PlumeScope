export function co2ToMWh(co2_tpy: number, EF_tCO2_per_MWh = 0.4): number {
  // Convert annual CO2 (t/year) to electricity generation MWh/year using emissions factor (tCO2 per MWh)
  if (EF_tCO2_per_MWh <= 0) return 0;
  return co2_tpy / EF_tCO2_per_MWh;
}

export function mwhToWatts(mwh_per_year: number): number {
  // Average power in Watts over the year given MWh/year
  // 1 MWh = 1e6 Wh, 1 year = 8760 h
  return (mwh_per_year * 1_000_000) / 8760;
}

export function ahfWm2(totalWatts: number, areaKm2: number): number {
  const area_m2 = Math.max(1, areaKm2) * 1_000_000; // guard against zero area
  return totalWatts / area_m2;
}

export function deltaT(ahf_wm2: number, H_m: number = 300, tau_h: number = 1): number {
  // Screening estimate: dT = (Q * tau) / (rho * cp * H)
  // Q in W/m2, tau in hours, H in meters
  const rho = 1.2; // kg/m3
  const cp = 1005; // J/(kg·K)
  const tau_s = Math.max(0, tau_h) * 3600; // seconds
  const heatCapacity = rho * cp * Math.max(1, H_m); // J/m2/K
  const dT = (ahf_wm2 * tau_s) / heatCapacity; // K
  return dT; // °C ~ K
}
