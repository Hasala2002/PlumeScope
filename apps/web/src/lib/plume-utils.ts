// Plume rendering utilities for converting numeric grids to colored PNGs and positioning on maps

// 1) Color helpers ------------------------------------------------------------
type RGBA = [number, number, number, number]; // 0..255

const VIRIDIS: RGBA[] = [
  [68, 1, 84, 255], [72, 35, 116, 255], [64, 67, 135, 255], [52, 94, 141, 255],
  [41, 120, 142, 255], [32, 144, 140, 255], [34, 168, 132, 255], [68, 191, 112, 255],
  [121, 209, 81, 255], [189, 223, 38, 255], [253, 231, 36, 255]
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function sampleViridis(t: number): RGBA {
  t = Math.max(0, Math.min(1, t));
  const x = t * (VIRIDIS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= VIRIDIS.length - 1) return VIRIDIS[VIRIDIS.length - 1];
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f), 255] as RGBA;
}

// 2) Grid -> canvas (with alpha + scaling) -----------------------------------
export function gridToDataURL(grid: number[][], opts: {
  log?: boolean;
  alphaMin?: number;
  alphaMax?: number;
  mode?: 'auto' | 'absolute';
  fixedMax?: number | null;
  displayScale?: number;
} = { log: false, alphaMin: 0.05, alphaMax: 0.9, mode: 'auto', fixedMax: null, displayScale: 2 }): string {
  const n = grid.length;
  const flat = grid.flat();
  let min = Math.min(...flat), max = Math.max(...flat);

  const mode = opts.mode ?? 'auto';
  const fixedMax = opts.fixedMax ?? null;

  if (mode === 'absolute' && fixedMax != null) {
    min = opts.log ? 1e-9 : 0;
    max = Math.max(fixedMax, opts.log ? 1e-9 : 0);
  } else {
    if (opts.log) {
      min = Math.max(min, 1e-9);
      max = Math.max(max, 1e-9);
    }
  }

  // Render into a 1x scale canvas, then upscale for display
  const base = document.createElement('canvas');
  base.width = n;
  base.height = n;
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(n, n);

  const minV = opts.log ? Math.log(min) : min;
  const maxV = opts.log ? Math.log(max) : max;
  const denom = (maxV - minV) || 1;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = grid[y][x];
      if (opts.log) v = Math.log(v + 1e-9);
      const tRaw = (v - minV) / denom;
      const t = Math.max(0, Math.min(1, tRaw));
      const rgba = sampleViridis(t);
      const a = (opts.alphaMin! + (opts.alphaMax! - opts.alphaMin!) * t);
      const idx = (y * n + x) * 4;
      img.data[idx + 0] = rgba[0];
      img.data[idx + 1] = rgba[1];
      img.data[idx + 2] = rgba[2];
      img.data[idx + 3] = Math.round(255 * a);
    }
  }
  bctx.putImageData(img, 0, 0);

  const scale = Math.max(1, Math.floor(opts.displayScale ?? 2));
  if (scale === 1) {
    return base.toDataURL('image/png');
  }

  const cnv = document.createElement('canvas');
  cnv.width = n * scale;
  cnv.height = n * scale;
  const ctx = cnv.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  ctx.drawImage(base, 0, 0, cnv.width, cnv.height);
  return cnv.toDataURL('image/png');
}

// 3) Compute rotated corners (meters -> lat/lon) ------------------------------
const R = 6378137; // Earth radius (m)

function meterOffsetsToLngLat(site: { lat: number, lon: number }, dx: number, dy: number): [number, number] {
  const dLat = (dy / R) * (180 / Math.PI);
  const dLng = (dx / (R * Math.cos(site.lat * Math.PI / 180))) * (180 / Math.PI);
  return [site.lon + dLng, site.lat + dLat];
}

export function rotatedCorners(site: { lat: number, lon: number }, half: number, bearingDeg: number): [[number, number], [number, number], [number, number], [number, number]] {
  const th = bearingDeg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  
  // Image space corners (x,y) around center, +x downwind
  const pts = [
    [-half, half],  // top-left  (image coords)
    [half, half],   // top-right
    [half, -half],  // bottom-right
    [-half, -half], // bottom-left
  ].map(([x, y]) => {
    // Rotate by bearing
    const xr = x * cos - y * sin;
    const yr = x * sin + y * cos;
    return meterOffsetsToLngLat(site, xr, yr);
  });
  
  return pts as [[number, number], [number, number], [number, number], [number, number]];
}

// 4) Plume API data interface
export interface PlumeData {
  cell: number;
  half: number;
  n: number;
  grid: number[][];
  meta: {
    u: number;
    dir: number;
    stab: "A"|"B"|"C"|"D"|"E"|"F";
    q: number;
    Hs: number;
    maxC: number;
    minC: number;
  };
}

export interface PlumeParams {
  site_id: string;
  u?: number;     // wind speed m/s
  dir?: number;   // wind direction degrees
  stab?: string;  // stability class
  q?: number;     // emission rate
  n?: number;     // grid size
  half?: number;  // half-width in meters
}