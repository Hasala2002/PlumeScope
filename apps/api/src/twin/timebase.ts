// Virtual timebase with adjustable speed and pause/resume

let speed = 3600; // sim seconds per real second (default 3600x)
let t0Real = Date.now();
let t0Sim = Date.now();
let lastNonZeroSpeed = speed;
let mode: "simulate" | "twin" = "simulate";

export function nowSim(): number {
  const now = Date.now();
  const dtReal = now - t0Real; // ms
  const dtSim = dtReal * speed; // sim-ms when speed is simSec/realSec
  return Math.round(t0Sim + dtSim);
}

export function setSpeed(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  // keep continuity
  const curSim = nowSim();
  t0Real = Date.now();
  t0Sim = curSim;
  if (s > 0) lastNonZeroSpeed = s;
  speed = s;
}

export function getSpeed() { return speed; }

export function pause() { setSpeed(0); }

export function resume() { setSpeed(lastNonZeroSpeed || 1); }

export function getMode() { return mode; }

export function setMode(m: "simulate" | "twin") { mode = m; }

export function getState() {
  return {
    mode,
    speed,
    nowSimISO: new Date(nowSim()).toISOString(),
  };
}