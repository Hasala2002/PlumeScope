# PlumeScope

Risk- and plume-aware monitoring and planning for site-level emissions. This monorepo contains:
- apps/api: TypeScript Express API for scoring, hazard enrichment, plume simulation, population estimation, optimization, auto-thresholding, and a simple digital twin stream.
- apps/web: Next.js 15 web app for interactive map, analytics, optimization, and mini-climate exploration.

## Quick start

Prereqs
- Node.js 20+ and npm
- Optional: Mapbox token (for base map) and Gemini API key (for AI-assisted thresholding/insights)

Setup
```bash
# install
npm i

# environment (copy and edit as needed)
cp apps/web/.env.example apps/web/.env.local
# apps/web/.env.local
# NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
# NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=... (optional, falls back to example token)
# NEXT_PUBLIC_GEMINI_API_KEY=... (optional)

# apps/api/.env (create if using Gemini auto-threshold)
# GEMINI_API_KEY=...

# run both services
echo "Starting web (3000) and API (3001)" 
npm run dev
```

Build/Start
```bash
npm run build
npm run start
```

## Architecture
- API (apps/api)
  - Express routes under src/routes
  - Services for scoring, optimization, hazard enrichment, mini-climate (AHF + plume), auto-threshold, digital twin
  - External adapters with caching and retry (FEMA flood, US Drought Monitor, placeholder heat)
- Web (apps/web)
  - Next.js App Router UI (Map, Sites, Analytics, Optimize, Mini-Climate)
  - Mapbox GL visualization, plume heatmaps, affected-area overlays, population estimate workflow
  - React Query data layer, Tailwind UI, optional Gemini features

## Core features
- Map with scored sites
  - Risk-colored points (weights adjustable) and hazard raster overlays (FEMA flood, USDM, NOAA HeatRisk)
  - Site details popups; live plume rendering with wind, stability, stack height, and extent controls
- 24h affected area
  - Build union/exposure overlays from a ring buffer of plume frames; compute area and an affected polygon
  - Estimate exposed population via WorldPop and display density metrics
- Analytics
  - Live fused scoring, KPIs, distributions, scatterplots; inline Gemini Q&A widget
- Optimize
  - Budget allocation across mitigation items via 0/1 knapsack; AI-generated strategy report fallback
- Mini-Climate
  - Anthropogenic heat flux (AHF) and Gaussian plume playground; twin mode streams simulated conditions
- Admin
  - API health, config visibility, dataset previews

## Data and scoring
- Sites dataset: apps/api/data/sites.json (validated via zod); fields: id, name, lat, lon, CO2e_tpy, CH4_tpy
- Emissions scoring: EmissionsScore = 0.5·norm(CO2e_tpy) + 0.5·norm(CH4_tpy), norm(x)=x/max across sites
- Hazard scoring (fused/live):
  - Flood: 0/1 from FEMA NFHL identify endpoint (point-in-floodplain)
  - Drought: class None,D0..D4 mapped to 0.0..1.0 via USDM ArcGIS service
  - Heat: deterministic placeholder 0..1 (lat/lon signal); replace with a real index when available
- Overall risk: Risk = wE·Emissions + wF·Flood + wH·Heat + wD·Drought + wP·Proximity (proximity placeholder=0)

## Plume simulation (Gaussian)
- Endpoint: GET /plume?u&dir&stab&q&Hs&n&half
- Formula (ground-level centerline with reflection):
  C(x,y,0) = (q / (2π u σy σz)) · exp(−y²/(2σy²)) · 2·exp(−Hs²/(2σz²))
- Dispersion (Pasquill–Gifford-like) by stability class A–F; σy,σz increase with downwind distance and depend on class
- Grid output: n×n, span [−half,+half] meters, with meta {u,dir,stab,q,Hs,maxC,minC}
- Web renders heatmap (Viridis), supports log/linear scale, absolute/auto scaling, opacity, and value probe

## 24h affected area math
- Frames: up to 24 plume grids buffered hourly (twin simulate default is 3600x, i.e., 1 sim hour per real second via SSE)
- Thresholding: relative (alpha·maxC) or absolute (C_thr), per-frame
- Occupancy: unionBits bitset and hoursAbove counter grid at chosen resolution
- Area: cells × res² → m², ft², mi²; polygon boundary from occupied cell centers, convex hull with CCW enforcement and cap on vertices
- Overlay: union (fixed alpha) or exposure (alpha ∝ hours/24) rendered to a mask image source

## Anthropogenic heat flux (AHF) and micro-warming
- CO2→MWh: MWh/year = CO2e_tpy / EF (default EF=0.4 tCO2/MWh)
- MWh→W: W = (MWh/year × 1e6 Wh/MWh) / 8760 h
- AHF: W/m² = total W / (area_km² × 1e6)
- Micro ΔT screening: ΔT = (Q · τ) / (ρ · cp · H), with ρ=1.2 kg/m³, cp=1005 J/(kg·K), τ in seconds, H in meters

## Auto-thresholding (affected polygon)
- Input: log-space histogram {bins (K+1 edges), counts (K), log_space:true}, grid {cell_m, cells}, constraints {min_precision, min/max_area_km2}, priors {wind_dir_deg_mean, stability_mode}
- Baseline candidates: Otsu in log-space and high percentiles (99.5, 99, 98, 97, 95)
- Precision proxy: compares selected area to a corridor sized by σy(5 km); penalizes large, diffuse areas → [0,1]
- Selection: pick smallest τ meeting precision and area constraints; else max-precision fallback
- Gemini assist: POST /threshold/auto/evaluate fuses baseline with Gemini suggestion (if GEMINI_API_KEY), rate-limited by session (min interval, max calls)
- Tunables (apps/api/src/config.ts and apps/web/src/lib/autoThreshold.ts): MIN/MAX_AREA_KM2, MIN_PRECISION, JSD_THR, AREA_DELTA_THR, EMA_ALPHA, HYSTERESIS_* etc.

## Optimization (budget → mitigations)
- Catalog: apps/api/data/mitigations.json with items {id,label,cost,expectedDelta:{emissions,flood,heat,drought}}
- Benefit: wE·ΔE + wF·ΔF + wH·ΔH + wD·ΔD (weights default {0.35,0.35,0.2,0.1})
- Solver: 0/1 knapsack via DP by cost (scaled to $1k units)
- API: POST /optimize?budget=500000 with optional JSON body {weights}
- Notes include top benefit-per-$ items and unused budget

## Population estimation
- API: POST /population/estimate with { geojson, area_m2, year?, dataset? }
- Primary: WorldPop stats service (wpgppop 2020), POSTed geojson, synchronous path preferred
- Fallback: on external failure, returns estimate using 40 people/km² (Texas-like) to keep UI functional

## Digital twin
- Timebase: adjustable speed (sim seconds per real second), pause/resume; state at /twin/state
- Stream: /twin/stream Server-Sent Events at 1 Hz real-time; each event encodes params for plume (u,dir,q,half,stab,Hs) and simulated time
- Generator: OU processes + diurnal cycle + stability guardrails/hysteresis; small hourly step limits ensure continuity
- Mode control: POST /twin/mode { mode:"simulate"|"twin", speed? }

## API endpoints (selected)
- GET /health → { ok, service, ts }
- GET /sites → sites array (or {items,nextCursor} with pagination)
- GET /sites/:id → site by id
- GET /sites/:id/score → emissions + live hazards for a site
- GET /score → deterministic emissions-only ranking (weights via wE,wF,wH,wD,wP)
- GET /score/live → live fused scoring with hazard enrichment (rate-limited)
- GET /geo/sites → GeoJSON points
- GET /geo/score → GeoJSON scored points (weights via query)
- GET /hazards/flood?lat&lon → 0/1 floodplain flag
- GET /hazards/drought?lat&lon → {dm,value}
- GET /hazards/heat?lat&lon → {heatIndex}
- GET /plume?u&dir&stab&q&Hs&n&half → grid plume
- GET /mini-climate/ahf/:id?areaKm2&H&tau_h → {ahf_wm2, deltaT_c}
- GET /mini-climate/plume/:id?... → grid plume using shared params
- POST /population/estimate → WorldPop totals/density (or fallback)
- POST /optimize?budget → knapsack result (picked, totals, notes)
- GET /twin/state; POST /twin/mode; GET /twin/stream
- POST /threshold/auto/evaluate → baseline+Gemini threshold under constraints

## Web app routes
- /: Landing with status and navigation
- /map: Interactive map with layers, plumes, affected area, weights, population estimate
- /sites: Table + leaflet map, CSV export, per-site scoring drawer
- /analytics: KPIs, charts, Gemini Q&A
- /optimize: Budget optimizer + Gemini strategy report
- /mini-climate: AHF and plume sandbox; twin mode
- /admin: Health, config, dataset previews

## Configuration
- apps/web
  - NEXT_PUBLIC_API_BASE_URL (default http://localhost:3001)
  - NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN (optional; defaults to example key)
  - NEXT_PUBLIC_GEMINI_API_KEY (optional)
- apps/api
  - PORT (default 3001)
  - GEMINI_API_KEY (optional; enables Gemini path for /threshold/auto/evaluate)

## Tech stack
- API: Node.js, Express 5, TypeScript, Zod, Axios
- Web: Next.js 15 (App Router), React 19, React Query, Tailwind CSS 4
- Maps: mapbox-gl v3 (with optional Mapbox token), custom canvas overlays
- AI: Google Generative AI (Gemini) for markdown insights and JSON planning/thresholding
- Utilities: server-side caching, HTTP retry with backoff, SSE

## Notes and limitations
- Heat adapter is a deterministic placeholder; swap with a real index when available
- Proximity is currently a placeholder (0) in risk; add a distance-to-population metric to enable
- External services (FEMA/USDM/WorldPop) may rate-limit or be unavailable; API includes caching, retries, and graceful fallbacks

## Repository layout
```
plumescope/
  apps/
    api/
      src/
        adapters/       # FEMA/USDM/heat
        autoThreshold/  # baseline + gemini client
        repo/           # sitesRepo (JSON validation)
        routes/         # express routes
        services/       # scoring, optimize, enrichment, miniClimate
        twin/           # timebase + generator
        util/           # cache, http
      data/             # sites.json, mitigations.json, samples
    web/
      public/
      src/
        app/            # pages: map, sites, analytics, optimize, mini-climate, admin
        lib/            # plume-utils, affected-area, api, gemini
        components/ui/  # UI primitives
```

## License
Internal prototype (no license specified). Add a LICENSE file if open-sourcing.
