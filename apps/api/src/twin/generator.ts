// Parameter generator using OU processes + diurnal + guardrails

export type TwinParams = { u:number; dir:number; q:number; half:number; stab:"A"|"B"|"C"|"D"|"E"|"F"; Hs:number };

const clamp = (x:number,min:number,max:number)=>Math.min(max,Math.max(min,x));
const angNorm = (a:number)=>((a%360)+360)%360;

function randn(){ // Box-Muller
  const u = 1 - Math.random(), v = 1 - Math.random();
  return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
}

function ouStep(x:number, mu:number, theta:number, sigma:number, dtHrs:number){
  // mean-reverting continuous-time OU
  const e = Math.exp(-theta*dtHrs);
  const mean = mu + (x - mu)*e;
  const variance = (sigma*sigma/(2*theta))*(1 - e*e);
  const shock = Math.sqrt(Math.max(0,variance)) * randn();
  return mean + shock;
}

export function nextParams(prev:TwinParams, simDate:Date, site:{Hs?:number}) : TwinParams {
  const hour = simDate.getUTCHours();
  // Diurnal factors
  const diurnal = 0.6 + 0.4*Math.cos((2*Math.PI*(hour-4))/24); // min at ~4am, max ~4pm
  const solarUp = (hour>=6 && hour<=18); // crude day/night

  // Wind speed OU around 5 m/s scaled by diurnal
  let u = ouStep(prev.u, 5*diurnal, 0.6, 1.4, 1);
  u = clamp(u, 1, 12);
  // Limit hourly jump
  u = clamp(u, prev.u-1.0, prev.u+1.0);

  // Wind direction: slow drift with noise
  const drift = ouStep(0, 0, 0.25, 20, 1); // degrees per hour effect
  let dir = angNorm(prev.dir + clamp(drift, -15, 15));

  // Emission q: base 1.0 with diurnal modulation
  let q = ouStep(prev.q, 1.0*diurnal, 0.8, 0.2, 1);
  q = clamp(q, 0.3, 2.5);
  q = clamp(q, prev.q*0.9, prev.q*1.1); // ±10%/h

  // Extent (half): weakly linked to u
  let half = clamp(15000 + (u-5)*1500, 10000, 30000);
  half = clamp(half, prev.half-2000, prev.half+2000); // ≤2 km/h change

  // Stability from Pasquill-ish rules
  const stabTableDay =   (u<2)? "A" : (u<3)?"B" : (u<5)?"C" : (u<6)?"D" : "D";
  const stabTableNight = (u<2)? "E" : (u<3)?"E" : (u<5)?"F" : (u<6)?"E" : "D";
  const targetStab = solarUp ? stabTableDay : stabTableNight;
  // Step at most one class toward target (full hysteresis policy handled by caller if needed)
  const stabOrder = ["A","B","C","D","E","F"] as const;
  const idxPrev = stabOrder.indexOf(prev.stab);
  const idxTarget = stabOrder.indexOf(targetStab as any);
  const idxNext = idxPrev + Math.sign(idxTarget - idxPrev);
  const stab = (idxNext===idxPrev) ? prev.stab : stabOrder[idxNext];

  const Hs = site.Hs ?? 10;

  // Guardrails & rounding (13.T6)
  u = Math.round(u*10)/10;           // 0.1 m/s
  dir = Math.round(angNorm(dir));    // 1°
  q = Math.round(q*100)/100;         // 0.01
  half = Math.round(half/100)*100;   // 100 m

  return { u, dir, q, half, stab, Hs };
}