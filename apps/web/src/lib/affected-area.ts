// Affected area (24h footprint) utilities

export type FrameMeta = { dir:number; half:number; n:number; cell:number; maxC:number; simISO:string };
export type Frame = { meta: FrameMeta; grid: number[][] };

export type OccGrid = {
  res: number;      // meters per cell (g)
  half: number;     // meters; grid spans [-half,+half]^2
  dim: number;      // cells per side
  unionBits: Uint8Array; // 1 bit per cell
  hoursAbove: Uint8Array; // 0..24 hours per cell
};

export function makeOccGrid(g:number, maxHalf:number): OccGrid {
  const half = Math.ceil(maxHalf/g)*g; // snap to res
  const dim = Math.floor((2*half)/g) + 1;
  const nCells = dim*dim;
  return {
    res: g,
    half,
    dim,
    unionBits: new Uint8Array(Math.ceil(nCells/8)),
    hoursAbove: new Uint8Array(nCells),
  };
}

export function setBit(bits:Uint8Array, idx:number){ bits[idx>>3] |= (1<<(idx&7)); }
export function hasBit(bits:Uint8Array, idx:number){ return (bits[idx>>3] & (1<<(idx&7)))!==0; }

export function applyFrameToOccGrid(
  occ:OccGrid,
  frame:Frame,
  Cthr:number,
  mode:"relative"|"absolute",
  accumulateExposure:boolean
){
  const { n, cell, half, dir, maxC } = {
    n: frame.meta.n, cell: frame.meta.cell, half: frame.meta.half,
    dir: frame.meta.dir*(Math.PI/180), maxC: frame.meta.maxC
  };
  const cos = Math.cos(dir), sin = Math.sin(dir);
  const toENU = (x:number,y:number)=>({ // rotate plume -> ENU
    xe:  x*cos - y*sin,
    yn:  x*sin + y*cos
  });
  const dim = occ.dim, g = occ.res, H = occ.half;

  const thr = (mode==="relative") ? (Cthr*maxC) : Cthr;

  for (let j=0;j<n;j++){
    const row = frame.grid[j];
    for (let i=0;i<n;i++){
      const C = row[i];
      if (C < thr) continue;

      // plume cell center in plume coords
      const x = -half + i*cell;
      const y =  half - j*cell;

      // map to ENU & then to occ index
      const {xe, yn} = toENU(x,y);
      if (Math.abs(xe)>H || Math.abs(yn)>H) continue;
      const cx = Math.round((xe + H)/g);
      const cy = Math.round((H - yn)/g); // top row = small y
      const idx = cy*dim + cx;

      setBit(occ.unionBits, idx);
      if (accumulateExposure) occ.hoursAbove[idx] = Math.min(24, occ.hoursAbove[idx] + 1); // +1 hour
    }
  }
}

export function calcArea(occ:OccGrid){
  const nCells = occ.dim*occ.dim;
  let count=0;
  for (let idx=0; idx<nCells; idx++){
    if (hasBit(occ.unionBits, idx)) count++;
  }
  const m2 = count * occ.res * occ.res;
  const ft2 = m2 * 10.7639;
  const mi2 = m2 / 2_589_988.11;
  return { m2, ft2, mi2, cells: count };
}

export function buildOverlayDataURL(occ:OccGrid, mode:"union"|"exposure"): string {
  const n = occ.dim;
  const base = document.createElement('canvas');
  base.width = n; base.height = n;
  const ctx = base.getContext('2d')!;
  const img = ctx.createImageData(n, n);

  const nCells = n*n;
  if (mode === 'union'){
    for (let idx=0; idx<nCells; idx++){
      const on = hasBit(occ.unionBits, idx);
      const offA = 0; const onA = Math.round(255*0.35);
      const a = on ? onA : offA;
      const px = idx*4;
      img.data[px+0] = 255; // white mask
      img.data[px+1] = 255;
      img.data[px+2] = 255;
      img.data[px+3] = a;
    }
  } else {
    for (let idx=0; idx<nCells; idx++){
      const h = occ.hoursAbove[idx]; // 0..24
      const a = Math.round((h/24) * 255);
      const px = idx*4;
      img.data[px+0] = 255;
      img.data[px+1] = 255;
      img.data[px+2] = 255;
      img.data[px+3] = a; // alpha encodes exposure
    }
  }
  ctx.putImageData(img, 0, 0);

  // upscale x2 for smoother
  const scale = 2;
  const cnv = document.createElement('canvas');
  cnv.width = n*scale; cnv.height = n*scale;
  const c2 = cnv.getContext('2d')!;
  c2.imageSmoothingEnabled = true;
  (c2 as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  c2.drawImage(base, 0, 0, cnv.width, cnv.height);
  return cnv.toDataURL('image/png');
}

const R = 6378137; // m
export function meterOffsetsToLngLat(site: { lat:number; lon:number }, dx:number, dy:number): [number, number] {
  const dLat = (dy / R) * (180 / Math.PI);
  const dLng = (dx / (R * Math.cos(site.lat * Math.PI / 180))) * (180 / Math.PI);
  return [site.lon + dLng, site.lat + dLat];
}

// Build a simple polygon representing the affected union footprint by
// extracting boundary cell centers and computing a convex hull in ENU meters.
export function buildAffectedPolygon(
  occ: OccGrid,
  site: { lat: number; lon: number }
): { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Polygon"; coordinates: number[][][] } } | null {
  const { dim, res: g, half: H } = occ;
  
  // Count total occupied cells for debugging
  const nCells = dim * dim;
  let totalOccupied = 0;
  for (let idx = 0; idx < nCells; idx++) {
    if (hasBit(occ.unionBits, idx)) totalOccupied++;
  }
  
  const boundary: { x: number; y: number }[] = [];
  function occAt(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= dim || cy >= dim) return false;
    return hasBit(occ.unionBits, cy * dim + cx);
  }
  for (let cy = 0; cy < dim; cy++) {
    for (let cx = 0; cx < dim; cx++) {
      const on = occAt(cx, cy);
      if (!on) continue;
      // 4-neighborhood boundary check
      if (!occAt(cx - 1, cy) || !occAt(cx + 1, cy) || !occAt(cx, cy - 1) || !occAt(cx, cy + 1)) {
        const x = -H + cx * g;
        const y = H - cy * g;
        boundary.push({ x, y });
      }
    }
  }
  
  if (typeof console !== "undefined") {
    console.log(
      `[buildAffectedPolygon] total occupied: ${totalOccupied}/${nCells} cells (${((totalOccupied/nCells)*100).toFixed(1)}%), boundary: ${boundary.length}, occ.dim: ${dim}, res: ${g}m, half: ${H}m`
    );
  }
  
  // If we have occupied cells but no boundary (e.g., all interior cells), create a simple fallback
  if (boundary.length < 3 && totalOccupied > 0) {
    if (typeof console !== "undefined") {
      console.warn(`[buildAffectedPolygon] boundary.length (${boundary.length}) < 3 but ${totalOccupied} occupied cells found. Creating fallback boundary.`);
    }
    
    // Find all occupied cells and use them as boundary
    for (let cy = 0; cy < dim; cy++) {
      for (let cx = 0; cx < dim; cx++) {
        if (occAt(cx, cy)) {
          const x = -H + cx * g;
          const y = H - cy * g;
          boundary.push({ x, y });
        }
      }
    }
  }
  
  if (boundary.length < 3) {
    if (typeof console !== "undefined") {
      console.warn(`[buildAffectedPolygon] Still no valid boundary after fallback (${boundary.length} points, ${totalOccupied} occupied cells), returning null`);
    }
    return null;
  }

  // Deduplicate coarse
  const seen = new Set<string>();
  const pts = boundary.filter((p) => {
    const k = `${Math.round(p.x)}:${Math.round(p.y)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Monotone chain convex hull
  type P = { x: number; y: number };
  const ptsTyped: P[] = pts as P[];
  ptsTyped.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of ptsTyped) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = ptsTyped.length - 1; i >= 0; i--) {
    const p = ptsTyped[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) return null;

  // Convert to lon/lat ring
  let ring = hull.map((p) => meterOffsetsToLngLat(site, p.x, p.y));
  // Ensure CCW per RFC 7946
  const areaSigned = polygonRingArea(ring);
  if (areaSigned < 0) ring = ring.reverse();
  // Close ring
  if (ring.length === 0 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring = [...ring, ring[0]];
  }

  // Optionally cap vertices to ~1000 by uniform sampling (simple fallback)
  const MAX_VERTS = 1000;
  if (ring.length > MAX_VERTS) {
    const step = Math.ceil(ring.length / MAX_VERTS);
    const sampled: typeof ring = [];
    for (let i = 0; i < ring.length; i += step) sampled.push(ring[i]);
    if (
      sampled.length === 0 ||
      sampled[sampled.length - 1][0] !== sampled[0][0] ||
      sampled[sampled.length - 1][1] !== sampled[0][1]
    )
      sampled.push(sampled[0]);
    ring = sampled;
  }

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function polygonRingArea(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    area += (xj - xi) * (yj + yi);
  }
  // Negative area means clockwise in this shoelace variant, reverse sign for CCW check
  return -area;
}
