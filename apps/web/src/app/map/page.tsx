"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gridToDataURL, rotatedCorners, PlumeData } from "@/lib/plume-utils";
import { fnv1aHex } from "@/lib/utils";
import {
  api,
  Site,
  postPopulationEstimate,
  type PopulationEstimate,
  type PopulationQueued,
} from "@/lib/api";
import {
  makeOccGrid,
  applyFrameToOccGrid,
  calcArea,
  buildOverlayDataURL,
  meterOffsetsToLngLat,
  buildAffectedPolygon,
  polygonAreaMetersFromLngLat,
  hasBit,
  type Frame as AFrame,
} from "@/lib/affected-area";

type LV = { flood: boolean; drought: boolean; heat: boolean };
type Weights = {
  emissions: number;
  flood: number;
  heat: number;
  drought: number;
  proximity: number;
};

mapboxgl.accessToken =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  "pk.eyJ1IjoiZXhhbXBsZSIsImEiOiJjazl5c3YzZG8wMDIzM29ucHE5cDRuOTRmIn0.example";

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const resizeObs = useRef<ResizeObserver | null>(null);

  const [layerVisibility, setLayerVisibility] = useState<LV>({
    flood: false,
    drought: false,
    heat: false,
  });

  const [weights, setWeights] = useState<Weights>({
    emissions: 0.35,
    flood: 0.35,
    heat: 0.2,
    drought: 0.1,
    proximity: 0,
  });

  const [statusMsg, setStatusMsg] = useState("Loading map…");

  // Plume UI state
  const [plumeSite, setPlumeSite] = useState<{
    id: string;
    name?: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [windSpeed, setWindSpeed] = useState<number>(5);
  const [windDir, setWindDir] = useState<number>(270); // meteorological, blowing from
  const [emissionQ, setEmissionQ] = useState<number>(1);
  const [gridHalf, setGridHalf] = useState<number>(20000);
  const [logScale, setLogScale] = useState<boolean>(true);
  const [stab, setStab] = useState<"A" | "B" | "C" | "D" | "E" | "F">("D");
  const [stackHs, setStackHs] = useState<number>(10);
  const [scaleMode, setScaleMode] = useState<"auto" | "absolute">("absolute");
  const [scaleMax, setScaleMax] = useState<number | null>(null);
  const [plumeOpacity, setPlumeOpacity] = useState<number>(0.6);
  const [ghostPrev, setGhostPrev] = useState<boolean>(false);

  // Affected area (24h) UI state
  const [showAffected, setShowAffected] = useState<boolean>(false);
  const [affectedAgg, setAffectedAgg] = useState<"union" | "exposure">("union");
  const [thrMode, setThrMode] = useState<"relative" | "absolute">("relative");
  const [thrRelAlpha, setThrRelAlpha] = useState<number>(0.05);
  const [thrAbs, setThrAbs] = useState<number>(1);
  const [occRes, setOccRes] = useState<number>(50);
  const [areaInfo, setAreaInfo] = useState<null | {
    m2: number;
    ft2: number;
    mi2: number;
    cells: number;
  }>(null);
  const [affectedOpacity, setAffectedOpacity] = useState<number>(0.8);
  const [lastAffectedHalf, setLastAffectedHalf] = useState<number | null>(null);
  const [aqImpactPct, setAqImpactPct] = useState<number | null>(null);
  const [sectorAreaM2, setSectorAreaM2] = useState<number | null>(null);

  // Population estimate state
  const [popTotal, setPopTotal] = useState<number | null>(null);
  const [popDensity, setPopDensity] = useState<number | null>(null);
  const [popLoading, setPopLoading] = useState<boolean>(false);
  const [popQueuedId, setPopQueuedId] = useState<string | null>(null);
  const lastPopRef = useRef<null | {
    ts: number;
    key: string;
    area_m2: number;
  }>(null);

  // 24h ring buffer for plume frames
  const MAX_FRAMES = 24;
  const framesRef = useRef<AFrame[]>([]);
  const headRef = useRef<number>(0);

  const AFFECTED_SRC_ID = "affected-image";
  const AFFECTED_LAYER_ID = "affected-mask";

  // Legend scale from last render
  const [legendMin, setLegendMin] = useState<number | null>(null);
  const [legendMax, setLegendMax] = useState<number | null>(null);

  // Mode / Twin state
  const [mode, setMode] = useState<"simulate" | "twin">("simulate");
  const [simSpeed, setSimSpeed] = useState<number>(3600);
  const [simTimeISO, setSimTimeISO] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);
  const lastTwinParamsRef = useRef<null | {
    u: number;
    dir: number;
    q: number;
    half: number;
    stab: string;
    Hs: number;
  }>(null);
  const inFlightRef = useRef(false);
  const skippedRef = useRef(false);

  // Current plume metadata for probe
  const plumeMetaRef = useRef<null | {
    site: { lat: number; lon: number };
    half: number;
    bearing: number;
    n: number;
    grid: number[][];
  }>(null);

  // Debounce timer
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep last plume image and coords for ghosting
  const lastPlumeRef = useRef<null | {
    url: string;
    coordinates: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
  }>(null);
  // Extended type with updateImage (Mapbox GL JS v3)
  type ImageSourceWithUpdate = mapboxgl.ImageSource & {
    updateImage: (opts: {
      url: string;
      coordinates: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
    }) => void;
  };

  // ---------------------------
  // MAP INIT
  // ---------------------------
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const baseStyle = "mapbox://styles/mapbox/dark-v11";

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: baseStyle,
      center: [-99.9, 31.3],
      zoom: 6,
      minZoom: 5,
      maxZoom: 18,
      maxBounds: [
        [-106.6456, 25.8371],
        [-93.5083, 36.5007],
      ],
      pitchWithRotate: true,
      attributionControl: true,
      cooperativeGestures: true,
      failIfMajorPerformanceCaveat: false,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );

    const doResize = () => {
      try {
        map.current?.resize();
      } catch {
        /* no-op */
      }
    };
    resizeObs.current = new ResizeObserver(doResize);
    resizeObs.current.observe(mapContainer.current);
    requestAnimationFrame(doResize);

    map.current.on("load", () => {
      setStatusMsg("Base map loaded. Adding layers…");
      addMapLayers();
    });

    map.current.on("styledata", () => setStatusMsg("Map ready"));

    // Value probe
    map.current.on("mousemove", (e) => {
      if (!plumeMetaRef.current) return;
      const { site, half, bearing, n, grid } = plumeMetaRef.current;
      const idx = lngLatToGridIdx(
        site,
        half,
        bearing,
        n,
        e.lngLat.lng,
        e.lngLat.lat
      );
      if (!idx) {
        setProbe(null);
        return;
      }
      const { px, py, x, y } = idx;
      const val = grid?.[py]?.[px];
      if (val == null) {
        setProbe(null);
        return;
      }
      const km = Math.sqrt(x * x + y * y) / 1000;
      setProbe({
        x: e.point.x,
        y: e.point.y,
        val,
        km,
        downwindKm: Math.abs(x) / 1000,
      });
    });

    map.current.on("error", (e) => {
      const msg =
        (e?.error && e.error.message) ||
        (e as { message?: string })?.message ||
        "Unknown map error";
      setStatusMsg(`Map error: ${msg}`);
      console.error("Map error:", e);
    });

    function addMapLayers() {
      if (!map.current) return;

      const apiBase =
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

      // SITES
      map.current.addSource("sites", {
        type: "geojson",
        data: `${apiBase}/geo/score`,
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 14,
        attribution: "Sites © Your API",
      });

      map.current.addLayer({
        id: "site-clusters",
        type: "circle",
        source: "sites",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            16,
            25,
            22,
            100,
            28,
          ],
          "circle-color": "#4f46e5",
          "circle-opacity": 0.7,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.current.addLayer({
        id: "site-cluster-count",
        type: "symbol",
        source: "sites",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "white" },
      });

      map.current.addLayer({
        id: "site-points",
        type: "circle",
        source: "sites",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "Risk"],
            0,
            "#d1fae5",
            0.25,
            "#86efac",
            0.5,
            "#facc15",
            0.75,
            "#fb923c",
            1,
            "#ef4444",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.9,
        },
      });

      // FEMA
      map.current.addSource("fema", {
        type: "raster",
        tiles: [
          "https://hazards.fema.gov/arcgis/services/public/NFHLWMS/MapServer/WMSServer?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&FORMAT=image/png&TRANSPARENT=true&LAYERS=28&CRS=EPSG:3857&STYLES=&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
        ],
        tileSize: 256,
        attribution: "FEMA NFHL Flood Hazard Zones",
        minzoom: 7,
        maxzoom: 18,
      });

      map.current.addLayer(
        {
          id: "fema-layer",
          type: "raster",
          source: "fema",
          paint: { "raster-opacity": 0.55 },
          layout: { visibility: layerVisibility.flood ? "visible" : "none" },
        },
        "site-points"
      );

      // Drought
      map.current.addSource("usdm", {
        type: "raster",
        tiles: [
          "https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/US_Drought_Monitor/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "US Drought Monitor (NDMC/USDA/NOAA)",
        minzoom: 6,
        maxzoom: 18,
      });

      map.current.addLayer(
        {
          id: "usdm-layer",
          type: "raster",
          source: "usdm",
          paint: { "raster-opacity": 0.5 },
          layout: { visibility: layerVisibility.drought ? "visible" : "none" },
        },
        "site-points"
      );

      // HeatRisk
      map.current.addSource("heatrisk", {
        type: "raster",
        tiles: [
          "https://mapservices.weather.noaa.gov/experimental/rest/services/NWS_HeatRisk/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image",
        ],
        tileSize: 256,
        attribution: "NOAA/NWS HeatRisk (experimental)",
        minzoom: 6,
        maxzoom: 16,
      });

      map.current.addLayer(
        {
          id: "heatrisk-layer",
          type: "raster",
          source: "heatrisk",
          paint: { "raster-opacity": 0.5 },
          layout: { visibility: layerVisibility.heat ? "visible" : "none" },
        },
        "site-points"
      );

      // Clicks
      map.current.on("click", "site-points", (e) => {
        const f = e.features?.[0] as unknown as {
          properties?: Record<string, unknown>;
          geometry?: { coordinates: [number, number] };
        };
        if (!f) return;
        const p = (f.properties || {}) as Record<string, unknown>;
        const [lon, lat] = f.geometry?.coordinates ?? [undefined, undefined];
        if (lat != null && lon != null) {
          const site = {
            id: String(p.id ?? ""),
            name: String(p.name ?? "Site"),
            lat,
            lon,
          };
          setPlumeSite(site);
          map.current!.easeTo({
            center: [lon, lat],
            zoom: Math.max(8, map.current!.getZoom()),
          });
          scheduleGenerate();
        }
        new mapboxgl.Popup({ className: "custom-popup" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="background: #1a1a1a; color: #ffffff; padding: 12px; min-width: 200px; border-radius: 8px; font-family: 'Gilroy-Regular', sans-serif;">
              <h3 style="font-weight: bold; font-size: 14px; margin-bottom: 8px; color: #ffffff;">${p.name ?? "Site"}</h3>
              <div style="font-size: 12px;">
                <p style="color: #9ca3af; margin: 4px 0;">ID: ${p.id ?? "-"}</p>
                <div style="border-top: 1px solid #374151; padding-top: 4px; margin-top: 4px;">
                  <p style="color: #ffffff; margin: 2px 0;"><strong>Risk Score:</strong> ${p.Risk ? Number(p.Risk).toFixed(3) : "-"}</p>
                </div>
                <div style="border-top: 1px solid #374151; padding-top: 4px; margin-top: 4px;">
                  <p style="color: #d1d5db; margin: 2px 0;">Emissions: ${p.EmissionsScore ? Number(p.EmissionsScore).toFixed(3) : "-"}</p>
                  <p style="color: #d1d5db; margin: 2px 0;">Flood: ${p.FloodScore ? Number(p.FloodScore).toFixed(3) : "-"}</p>
                  <p style="color: #d1d5db; margin: 2px 0;">Heat: ${p.HeatScore ? Number(p.HeatScore).toFixed(3) : "-"}</p>
                  <p style="color: #d1d5db; margin: 2px 0;">Drought: ${p.DroughtScore ? Number(p.DroughtScore).toFixed(3) : "-"}</p>
                </div>
                <div style="border-top: 1px solid #374151; padding-top: 4px; margin-top: 4px;">
                  <p style="color: #d1d5db; margin: 2px 0;">CO2e: ${p.CO2e_tpy ? Number(p.CO2e_tpy).toLocaleString() : "-"} tpy</p>
                  <p style="color: #d1d5db; margin: 2px 0;">CH4: ${p.CH4_tpy ? Number(p.CH4_tpy).toLocaleString() : "-"} tpy</p>
                </div>
              </div>
            </div>`
          )
          .addTo(map.current!);
      });

      map.current.on("mouseenter", "site-points", () => {
        if (map.current?.getCanvas().style) {
          map.current.getCanvas().style.cursor = "pointer";
        }
      });
      map.current.on("mouseleave", "site-points", () => {
        if (map.current?.getCanvas().style) {
          map.current.getCanvas().style.cursor = "";
        }
      });

      map.current.on("click", "site-clusters", (e) => {
        const f = e.features?.[0] as unknown as {
          properties?: { cluster_id?: number };
          geometry?: { coordinates: [number, number] };
        };
        const clusterId = f?.properties?.cluster_id;
        if (clusterId == null) return;
        const src = map.current!.getSource("sites") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const coords = f!.geometry!.coordinates;
          map.current!.easeTo({ center: coords, zoom });
        });
      });

      setStatusMsg("Map ready");
    }

    return () => {
      try {
        resizeObs.current?.disconnect();
        map.current?.remove();
      } finally {
        resizeObs.current = null;
        map.current = null;
      }
    };
  }, []);

  // Fetch sites and twin initial state
  useEffect(() => {
    (async () => {
      try {
        const [{ data: siteData }, { data: twinState }] = await Promise.all([
          api.get<Site[]>("/sites"),
          api.get<{
            mode: "simulate" | "twin";
            speed: number;
            nowSimISO: string;
          }>("/twin/state"),
        ]);
        setSites(siteData);
        setMode(twinState.mode);
        setSimSpeed(twinState.speed);
        setSimTimeISO(twinState.nowSimISO);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Visibility toggles (robust to style/layer readiness)
  useEffect(() => {
    if (!map.current) return;

    const m = map.current;
    const setLayerVisible = (layerId: string, visible: boolean) => {
      const apply = () => {
        if (!m.getLayer(layerId)) {
          // Try again on next idle once layer exists
          m.once("idle", apply);
          return;
        }
        try {
          m.setLayoutProperty(
            layerId,
            "visibility",
            visible ? "visible" : "none"
          );
        } catch (err) {
          console.warn(`Error updating visibility for ${layerId}:`, err);
        }
      };
      apply();
    };

    setLayerVisible("fema-layer", !!layerVisibility.flood);
    setLayerVisible("usdm-layer", !!layerVisibility.drought);
    setLayerVisible("heatrisk-layer", !!layerVisibility.heat);
  }, [layerVisibility]);

  const toggleLayer = (key: keyof LV) => {
    // Single source of truth: update state; effect will sync map when ready
    setLayerVisibility((s) => ({ ...s, [key]: !s[key] }));
  };

  const updateMapData = (newWeights: Weights) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const apiBase =
      process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
    const params = new URLSearchParams({
      wE: newWeights.emissions.toString(),
      wF: newWeights.flood.toString(),
      wH: newWeights.heat.toString(),
      wD: newWeights.drought.toString(),
      wP: newWeights.proximity.toString(),
    });
    const source = map.current.getSource("sites") as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(`${apiBase}/geo/score?${params.toString()}`);
    }
  };

  const updateWeight = (key: keyof Weights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    setWeights(newWeights);
    updateMapData(newWeights);
  };

  // Ring buffer helpers for affected area
  function pushFrame(f: AFrame) {
    const frames = framesRef.current;
    if (frames.length < MAX_FRAMES) frames.push(f);
    else {
      frames[headRef.current] = f;
      headRef.current = (headRef.current + 1) % MAX_FRAMES;
    }
  }
  function iterFramesNewestFirst(): AFrame[] {
    const frames = framesRef.current;
    const L = frames.length;
    const arr: AFrame[] = [];
    for (let k = 0; k < L; k++) {
      const i = (headRef.current + L - 1 - k) % L; // wrap within current length
      arr.push(frames[i]);
    }
    return arr;
  }

  function removeAffectedOverlay() {
    if (!map.current) return;
    if (map.current.getLayer(AFFECTED_LAYER_ID)) {
      try {
        map.current.removeLayer(AFFECTED_LAYER_ID);
      } catch {}
    }
    if (map.current.getSource(AFFECTED_SRC_ID)) {
      try {
        map.current.removeSource(AFFECTED_SRC_ID);
      } catch {}
    }
  }

  function updateAffectedOverlay(url: string, half: number) {
    if (!map.current || !plumeSite) return;
    const topLeft = meterOffsetsToLngLat(plumeSite, -half, half);
    const topRight = meterOffsetsToLngLat(plumeSite, half, half);
    const bottomRight = meterOffsetsToLngLat(plumeSite, half, -half);
    const bottomLeft = meterOffsetsToLngLat(plumeSite, -half, -half);
    const coords = [topLeft, topRight, bottomRight, bottomLeft] as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    const srcBase = map.current.getSource(AFFECTED_SRC_ID) as
      | mapboxgl.ImageSource
      | undefined;
    const src = srcBase as unknown as ImageSourceWithUpdate | undefined;
    if (src && typeof src.updateImage === "function") {
      try {
        src.updateImage({ url, coordinates: coords });
        map.current.setPaintProperty(
          AFFECTED_LAYER_ID,
          "raster-opacity",
          affectedOpacity
        );
      } catch {}
    } else {
      if (map.current.getLayer(AFFECTED_LAYER_ID))
        map.current.removeLayer(AFFECTED_LAYER_ID);
      if (map.current.getSource(AFFECTED_SRC_ID))
        map.current.removeSource(AFFECTED_SRC_ID);
      map.current.addSource(AFFECTED_SRC_ID, {
        type: "image",
        url,
        coordinates: coords,
      });
      map.current.addLayer(
        {
          id: AFFECTED_LAYER_ID,
          type: "raster",
          source: AFFECTED_SRC_ID,
          paint: { "raster-opacity": affectedOpacity },
        },
        "site-points"
      );
    }
  }

  async function recomputeAffected() {
    if (!showAffected || !plumeSite) return;
    const frames = iterFramesNewestFirst();
    if (frames.length === 0) {
      console.log("[recomputeAffected] No frames in buffer");
      removeAffectedOverlay();
      setAreaInfo(null);
      setPopTotal(null);
      setPopDensity(null);
      lastPopRef.current = null; // Clear cache when no frames
      return;
    }
    const maxHalf = Math.max(...frames.map((f) => f.meta.half));
    const occ = makeOccGrid(occRes, maxHalf);

    console.log(
      `[recomputeAffected] Processing ${frames.length} frames, maxHalf: ${maxHalf}m, occRes: ${occRes}m, thrMode: ${thrMode}`
    );

    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      const Cthr = thrMode === "relative" ? thrRelAlpha : thrAbs;
      const effectiveThreshold =
        thrMode === "relative" ? thrRelAlpha * f.meta.maxC : thrAbs;

      console.log(
        `[recomputeAffected] Frame ${i}: maxC=${f.meta.maxC}, Cthr=${Cthr}, effectiveThreshold=${effectiveThreshold}, grid=${f.grid.length}x${f.grid[0]?.length}`
      );

      applyFrameToOccGrid(occ, f, Cthr, thrMode, affectedAgg === "exposure");
    }
    const a = calcArea(occ);
    console.log(
      `[recomputeAffected] Calculated area: ${a.m2} m² (${a.cells} cells)`
    );
    // Keep cell-based area available, but prefer polygon-based for display
    setAreaInfo(a);
    const url = buildOverlayDataURL(occ, affectedAgg);
    updateAffectedOverlay(url, occ.half);
    setLastAffectedHalf(occ.half);

    // Compute AQ impact percentage using newest frame over affected area
    try {
      const newest = frames[0];
      if (newest) {
        const denom =
          scaleMode === "absolute" && (scaleMax ?? 0) > 0
            ? Math.max(scaleMax as number, newest.meta.maxC)
            : newest.meta.maxC;
        const thrC =
          thrMode === "relative" ? thrRelAlpha * newest.meta.maxC : thrAbs;
        const { n, cell, half, dir } = newest.meta;
        const theta = (dir * Math.PI) / 180;
        const cos = Math.cos(theta),
          sin = Math.sin(theta);
        const toOcc = (x: number, y: number) => {
          const xe = x * cos - y * sin;
          const yn = x * sin + y * cos;
          if (Math.abs(xe) > occ.half || Math.abs(yn) > occ.half) return -1;
          const cx = Math.round((xe + occ.half) / occ.res);
          const cy = Math.round((occ.half - yn) / occ.res);
          if (cx < 0 || cy < 0 || cx >= occ.dim || cy >= occ.dim) return -1;
          return cy * occ.dim + cx;
        };
        let sum = 0,
          count = 0;
        for (let j = 0; j < n; j++) {
          const row = newest.grid[j];
          for (let i = 0; i < n; i++) {
            const C = row[i];
            if (C < thrC || denom <= 0) continue;
            const x = -half + i * cell;
            const y = half - j * cell;
            const idx = toOcc(x, y);
            if (idx >= 0 && hasBit(occ.unionBits, idx)) {
              sum += C / denom;
              count++;
            }
          }
        }
        const avg = count > 0 ? Math.min(1, Math.max(0, sum / count)) : 0;
        setAqImpactPct(Math.round(avg * 100));
      } else {
        setAqImpactPct(null);
      }
    } catch {
      setAqImpactPct(null);
    }

    // Build polygon and maybe call population API (throttled)
    let feature = buildAffectedPolygon(occ, {
      lat: plumeSite.lat,
      lon: plumeSite.lon,
    });
    let finalArea = a; // Track the final area to use for API calls

    // If no polygon was generated, try with progressively lower thresholds
    if (!feature && frames.length > 0) {
      console.warn(
        "[pop] buildAffectedPolygon returned null, trying fallback thresholds"
      );

      const fallbackThresholds =
        thrMode === "relative"
          ? [thrRelAlpha * 0.5, thrRelAlpha * 0.25, thrRelAlpha * 0.1, 0.001] // Try progressively lower relative thresholds
          : [thrAbs * 0.5, thrAbs * 0.25, thrAbs * 0.1, 0.001]; // Try progressively lower absolute thresholds

      for (const fallbackThr of fallbackThresholds) {
        console.log(
          `[pop] Trying fallback threshold: ${fallbackThr} (${thrMode})`
        );

        // Create new occupancy grid with fallback threshold
        const fallbackOcc = makeOccGrid(occRes, maxHalf);
        for (let i = frames.length - 1; i >= 0; i--) {
          const f = frames[i];
          applyFrameToOccGrid(
            fallbackOcc,
            f,
            fallbackThr,
            thrMode,
            affectedAgg === "exposure"
          );
        }

        const fallbackArea = calcArea(fallbackOcc);
        console.log(
          `[pop] Fallback threshold ${fallbackThr} resulted in ${fallbackArea.cells} cells`
        );

        if (fallbackArea.cells > 0) {
          feature = buildAffectedPolygon(fallbackOcc, {
            lat: plumeSite.lat,
            lon: plumeSite.lon,
          });
          if (feature) {
            console.log(`[pop] Success with fallback threshold ${fallbackThr}`);
            // Update the area info with the fallback result
            finalArea = fallbackArea; // Use fallback area for API call
            setAreaInfo(fallbackArea);
            const fallbackUrl = buildOverlayDataURL(fallbackOcc, affectedAgg);
            updateAffectedOverlay(fallbackUrl, fallbackOcc.half);
            setLastAffectedHalf(fallbackOcc.half);
            break;
          }
        }
      }
    }

    if (!feature) {
      console.warn(
        "[pop] buildAffectedPolygon returned null even with fallback thresholds"
      );
      setPopTotal(null);
      setPopDensity(null);
      lastPopRef.current = null; // Clear cache when no polygon available
      return;
    }

    // Use polygon-based geodesic area for display to avoid grid/threshold artifacts
    try {
      const ring = feature.geometry.coordinates[0] as [number, number][];
      const m2poly = polygonAreaMetersFromLngLat(ring, {
        lat: plumeSite.lat,
        lon: plumeSite.lon,
      });
      setAreaInfo({
        m2: m2poly,
        ft2: m2poly * 10.7639,
        mi2: m2poly / 2_589_988.11,
        cells: a.cells,
      });

      // Sector-area estimate over 24h using arc span and max radius from ring
      const Rloc = 6378137; // meters
      const cosLat = Math.cos((plumeSite.lat * Math.PI) / 180);
      const toMeters = (lng: number, lat: number) => {
        const dx = (lng - plumeSite.lon) * (Math.PI / 180) * Rloc * cosLat;
        const dy = (lat - plumeSite.lat) * (Math.PI / 180) * Rloc;
        return { x: dx, y: dy };
      };
      let rMax = 0;
      const ringAngles: number[] = [];
      for (const [lng, lat] of ring) {
        const { x, y } = toMeters(lng, lat);
        const r = Math.hypot(x, y);
        if (r > rMax) rMax = r;
        // angle from site to ring point
        const ang = Math.atan2(y, x);
        ringAngles.push((ang + 2 * Math.PI) % (2 * Math.PI));
      }
      // Angle span from frames (circular)
      const angles = Array.from(
        new Set(
          iterFramesNewestFirst()
            .map((f) => (typeof f?.meta?.dir === "number" ? f.meta.dir : null))
            .filter((v): v is number => v != null)
            .map((deg) => ((deg % 360) + 360) % 360)
        )
      )
        .map((deg) => (deg * Math.PI) / 180)
        .sort((a, b) => a - b);

      const spanFromAngles = (arr: number[]) => {
        if (arr.length < 2) return 0;
        let maxGap = 0;
        for (let i = 0; i < arr.length - 1; i++)
          maxGap = Math.max(maxGap, arr[i + 1] - arr[i]);
        maxGap = Math.max(maxGap, 2 * Math.PI - (arr[arr.length - 1] - arr[0]));
        return 2 * Math.PI - maxGap; // covered arc
      };

      const thetaFrames = spanFromAngles(angles);
      const thetaRing = spanFromAngles(ringAngles.sort((a, b) => a - b));
      let theta = Math.max(thetaFrames, thetaRing);
      // ignore tiny spans/noisy degenerate arcs
      if (!isFinite(theta) || theta < (5 * Math.PI) / 180) theta = 0; // <5° -> treat as 0

      const sectorM2 = theta > 0 && rMax > 0 ? 0.5 * theta * rMax * rMax : NaN;
      setSectorAreaM2(Number.isFinite(sectorM2) ? sectorM2 : null);
    } catch {}
    const coordsStr = JSON.stringify(feature.geometry.coordinates);
    const key = fnv1aHex(coordsStr);
    const last = lastPopRef.current;
    const now = Date.now();
    const shouldCall =
      !last ||
      now - last.ts > 5_000 || // Reduced from 10s to 5s
      Math.abs(finalArea.m2 - last.area_m2) / Math.max(1, last.area_m2) >
        0.01 || // Reduced threshold from 5% to 1%
      key !== last.key;

    console.log(
      `[pop] shouldCall=${shouldCall}, last=${!!last}, timeDiff=${last ? now - last.ts : "N/A"}, area_ratio=${last ? Math.abs(finalArea.m2 - last.area_m2) / Math.max(1, last.area_m2) : "N/A"}, key_match=${last ? key === last.key : "N/A"}`
    );
    if (!shouldCall) return;

    try {
      console.log(
        "[pop] calling postPopulationEstimate with polygon",
        feature.geometry.coordinates[0].length,
        "verts, area",
        finalArea.m2
      );
      setPopLoading(true);
      setPopQueuedId(null);
      const res = await postPopulationEstimate({
        geojson: feature,
        area_m2: finalArea.m2,
        year: 2020,
        siteId: plumeSite?.id,
      });
      console.log("[pop] API response:", res);
      if ("queued" in res.data) {
        const taskid = (res.data as PopulationQueued).taskid;
        setPopQueuedId(taskid);
        // Poll up to ~30s
        const start = Date.now();
        const poll = async () => {
          try {
            type WorldPopTask = {
              status: string;
              data?: { total_population?: number };
            };
            const { data } = await api.get<WorldPopTask>(
              `/population/task/${taskid}`
            );
            if (
              data?.status === "finished" &&
              typeof data?.data?.total_population === "number"
            ) {
              const total = data.data.total_population;
              console.log(
                `[pop] Polling finished - population: ${total}, area: ${finalArea.m2} m²`
              );
              const density =
                finalArea.m2 > 0 ? total / (finalArea.m2 / 1_000_000) : 0;
              console.log(`[pop] Calculated density: ${density} ppl/km²`);
              setPopTotal(total);
              setPopDensity(density);
              lastPopRef.current = {
                ts: Date.now(),
                key,
                area_m2: finalArea.m2,
              };
              setPopQueuedId(null);
              setPopLoading(false);
              return;
            } else {
              console.log(`[pop] Polling status: ${data?.status}, data:`, data);
            }
          } catch {}
          if (Date.now() - start < 30_000) setTimeout(poll, 3000);
          else {
            setPopQueuedId(null);
            setPopLoading(false);
          }
        };
        poll();
      } else {
        const d = res.data as PopulationEstimate;
        console.log("[pop] Immediate response data:", d);
        console.log(
          `[pop] Setting population: ${d.total_population}, area: ${finalArea.m2} m²`
        );
        setPopTotal(d.total_population);
        const density =
          finalArea.m2 > 0
            ? d.total_population / (finalArea.m2 / 1_000_000)
            : 0;
        console.log(`[pop] Calculated density: ${density} ppl/km²`);
        setPopDensity(density);
        lastPopRef.current = { ts: Date.now(), key, area_m2: finalArea.m2 };
        setPopLoading(false);
      }
    } catch (error) {
      console.error("[pop] API call failed:", error);
      setPopLoading(false);
    }
  }

  // Helper: compute min/max for legend
  const computeMinMax = (
    grid: number[][],
    log: boolean,
    mode: "auto" | "absolute",
    fixedMax: number | null
  ) => {
    const flat = grid.flat();
    let min = Math.min(...flat),
      max = Math.max(...flat);
    if (mode === "absolute" && fixedMax != null) {
      min = log ? 1e-9 : 0;
      max = Math.max(fixedMax, log ? 1e-9 : 0);
    } else {
      if (log) {
        min = Math.max(min, 1e-9);
        max = Math.max(max, 1e-9);
      }
    }
    return { min, max };
  };

  // Generate plume (debounced trigger uses this)
  const generatePlume = useCallback(async () => {
    if (!map.current || !plumeSite) return;
    if (inFlightRef.current) {
      skippedRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      setStatusMsg("Generating plume...");
      const params = new URLSearchParams({
        u: String(windSpeed),
        q: String(emissionQ),
        half: String(gridHalf),
        stab: stab,
        Hs: String(stackHs),
      });
      const { data } = await api.get<PlumeData>(`/plume?${params.toString()}`);

      let fixedMax = scaleMax;
      if (scaleMode === "absolute") {
        fixedMax = Math.max(fixedMax ?? 0, data.meta.maxC);
        setScaleMax(fixedMax);
      }
      const png = gridToDataURL(data.grid, {
        log: logScale,
        alphaMin: 0.05,
        alphaMax: 0.9,
        mode: scaleMode,
        fixedMax: scaleMode === "absolute" ? fixedMax! : null,
        displayScale: 2,
      });
      const bearing = windDir;
      const corners = rotatedCorners(
        { lat: plumeSite.lat, lon: plumeSite.lon },
        data.half,
        bearing
      );

      const mm = computeMinMax(
        data.grid,
        logScale,
        scaleMode,
        fixedMax ?? null
      );
      setLegendMin(mm.min);
      setLegendMax(mm.max);

      // Ghost previous
      if (ghostPrev && lastPlumeRef.current) {
        const prevSrc = map.current.getSource("plume-prev-image") as
          | mapboxgl.ImageSource
          | undefined;
        const prevSrcWithUpdate = prevSrc as unknown as
          | ImageSourceWithUpdate
          | undefined;
        if (
          prevSrcWithUpdate &&
          typeof prevSrcWithUpdate.updateImage === "function"
        ) {
          prevSrcWithUpdate.updateImage({
            url: lastPlumeRef.current.url,
            coordinates: lastPlumeRef.current.coordinates,
          });
        } else {
          map.current.addSource("plume-prev-image", {
            type: "image",
            url: lastPlumeRef.current.url,
            coordinates: lastPlumeRef.current.coordinates,
          });
          map.current.addLayer(
            {
              id: "plume-prev",
              type: "raster",
              source: "plume-prev-image",
              paint: { "raster-opacity": 0.25 },
            },
            "site-points"
          );
        }
      } else if (!ghostPrev) {
        if (map.current.getLayer("plume-prev"))
          map.current.removeLayer("plume-prev");
        if (map.current.getSource("plume-prev-image"))
          map.current.removeSource("plume-prev-image");
      }

      // Main plume
      const srcId = "plume-image";
      const layerId = "plume";
      const srcBase = map.current.getSource(srcId) as
        | mapboxgl.ImageSource
        | undefined;
      const src = srcBase as unknown as ImageSourceWithUpdate | undefined;
      if (src && typeof src.updateImage === "function") {
        src.updateImage({ url: png, coordinates: corners });
      } else {
        if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
        if (map.current.getSource(srcId)) map.current.removeSource(srcId);
        map.current.addSource(srcId, {
          type: "image",
          url: png,
          coordinates: corners,
        });
        map.current.addLayer(
          {
            id: layerId,
            type: "raster",
            source: srcId,
            paint: { "raster-opacity": plumeOpacity },
          },
          "site-points"
        );
      }

      plumeMetaRef.current = {
        site: { lat: plumeSite.lat, lon: plumeSite.lon },
        half: data.half,
        bearing,
        n: data.n,
        grid: data.grid,
      };
      lastPlumeRef.current = { url: png, coordinates: corners };

      const frame: AFrame = {
        meta: {
          dir: data.meta?.dir ?? windDir,
          half: data.half,
          n: data.n,
          cell: data.cell,
          maxC: data.meta.maxC,
          simISO: simTimeISO,
        },
        grid: data.grid,
      };
      pushFrame(frame);
      if (showAffected) recomputeAffected();

      if (map.current.getLayer(layerId)) {
        try {
          map.current.setPaintProperty(layerId, "raster-opacity", plumeOpacity);
        } catch {}
      }

      setStatusMsg("Plume rendered");
      setTimeout(() => setStatusMsg("Map ready"), 1200);
    } catch (error) {
      console.error("Plume generation failed:", error);
      setStatusMsg("Plume generation failed");
      setTimeout(() => setStatusMsg("Map ready"), 2000);
    } finally {
      inFlightRef.current = false;
      if (skippedRef.current) {
        skippedRef.current = false;
        generatePlume();
      }
    }
  }, [
    plumeSite,
    windSpeed,
    emissionQ,
    gridHalf,
    stab,
    stackHs,
    windDir,
    logScale,
    scaleMode,
    scaleMax,
    plumeOpacity,
    ghostPrev,
  ]);

  const scheduleGenerate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      generatePlume();
    }, 150);
  }, [generatePlume]);

  // Update opacity on slider change
  useEffect(() => {
    if (!map.current) return;
    if (map.current.getLayer("plume")) {
      try {
        map.current.setPaintProperty("plume", "raster-opacity", plumeOpacity);
      } catch {}
    }
  }, [plumeOpacity]);

  // Debounce auto-generate (simulate only)
  useEffect(() => {
    if (!plumeSite || mode !== "simulate") return;
    scheduleGenerate();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    plumeSite,
    windSpeed,
    windDir,
    emissionQ,
    gridHalf,
    stab,
    stackHs,
    logScale,
    scaleMode,
    scheduleGenerate,
    mode,
  ]);

  // Recompute affected overlay on control changes
  useEffect(() => {
    if (!showAffected) {
      removeAffectedOverlay();
      return;
    }
    recomputeAffected();
  }, [
    showAffected,
    affectedAgg,
    thrMode,
    thrRelAlpha,
    thrAbs,
    occRes,
    plumeSite,
  ]);

  // Apply affected opacity tweaks
  useEffect(() => {
    if (!map.current) return;
    if (map.current.getLayer(AFFECTED_LAYER_ID)) {
      try {
        map.current.setPaintProperty(
          AFFECTED_LAYER_ID,
          "raster-opacity",
          affectedOpacity
        );
      } catch {}
    }
  }, [affectedOpacity]);

  // Clear ring buffer on site change
  useEffect(() => {
    framesRef.current = [];
    headRef.current = 0;
    setAreaInfo(null);
    removeAffectedOverlay();
  }, [plumeSite?.id]);

  // Probe tooltip state
  const [probe, setProbe] = useState<null | {
    x: number;
    y: number;
    val: number;
    km: number;
    downwindKm: number;
  }>(null);

  // Indexing math for probe (client)
  const R = 6378137; // m
  const lngLatToGridIdx = (
    site: { lat: number; lon: number },
    half: number,
    bearing: number,
    n: number,
    lng: number,
    lat: number
  ) => {
    const dy = (lat - site.lat) * (Math.PI / 180) * R;
    const dx =
      (lng - site.lon) *
      (Math.PI / 180) *
      R *
      Math.cos((site.lat * Math.PI) / 180);
    const th = (bearing * Math.PI) / 180,
      cos = Math.cos(th),
      sin = Math.sin(th);
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    if (Math.abs(x) > half || Math.abs(y) > half) return null;
    const px = Math.round(((x + half) / (2 * half)) * (n - 1));
    const py = Math.round(((-y + half) / (2 * half)) * (n - 1));
    return { px, py, x, y };
  };

  // Fetch hazard scores for selected site (from /score/live)
  const [siteScores, setSiteScores] = useState<null | {
    id: string;
    EmissionsScore: number;
    FloodScore: number;
    HeatScore: number;
    DroughtScore: number;
    Risk?: number;
  }>(null);
  useEffect(() => {
    if (!plumeSite?.id) {
      setSiteScores(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<{
          items: Array<{
            id: string;
            EmissionsScore: number;
            FloodScore: number;
            HeatScore: number;
            DroughtScore: number;
            Risk?: number;
          }>;
        }>("/score/live");
        if (cancelled) return;
        const s = data.items.find(
          (it) => String(it.id) === String(plumeSite.id)
        );
        setSiteScores(s ?? null);
      } catch {
        if (!cancelled) setSiteScores(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plumeSite?.id]);

  // Derived People Risk
  const coverageFrac = useMemo(() => {
    if (!areaInfo || !lastAffectedHalf || lastAffectedHalf <= 0) return 0;
    const bboxArea = 4 * lastAffectedHalf * lastAffectedHalf; // m^2 of square extent
    return Math.max(0, Math.min(1, areaInfo.m2 / Math.max(1, bboxArea)));
  }, [areaInfo, lastAffectedHalf]);

  const hazardComposite = useMemo(() => {
    const e = siteScores?.EmissionsScore ?? 0.5;
    const f = siteScores?.FloodScore ?? 0.5;
    const h = siteScores?.HeatScore ?? 0.5;
    const d = siteScores?.DroughtScore ?? 0.5;
    const wE = weights.emissions;
    const wF = weights.flood;
    const wH = weights.heat;
    const wD = weights.drought;
    const sum = wE + wF + wH + wD || 1;
    return (wE * e + wF * f + wH * h + wD * d) / sum;
  }, [siteScores, weights]);

  const densityNorm = useMemo(() => {
    if (popDensity == null) return 0;
    return Math.max(0, Math.min(1, popDensity / 5000)); // 5k ppl/km² cap
  }, [popDensity]);

  const exposureFactor = useMemo(() => Math.sqrt(coverageFrac), [coverageFrac]);

  const peopleRisk = useMemo(() => {
    const ef = 0.4 + 0.6 * exposureFactor; // 0.4..1.0
    const df = 0.4 + 0.6 * densityNorm; // 0.4..1.0
    const r = hazardComposite * ef * df;
    return Math.max(0, Math.min(1, r));
  }, [hazardComposite, exposureFactor, densityNorm]);

  const peopleRiskLabel = useMemo(() => {
    const r = peopleRisk;
    if (r < 0.2) return "Low";
    if (r < 0.4) return "Moderate";
    if (r < 0.7) return "High";
    return "Critical";
  }, [peopleRisk]);

  // SSE for twin mode
  useEffect(() => {
    if (mode !== "twin" || !plumeSite) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const url = `${api.defaults.baseURL}/twin/stream?siteId=${encodeURIComponent(plumeSite.id)}`;
    const ev = new EventSource(url);
    esRef.current = ev;
    ev.onmessage = (m) => {
      try {
        const payload = JSON.parse(m.data) as {
          simTimeISO: string;
          speed: number;
          params: {
            u: number;
            dir: number;
            q: number;
            half: number;
            stab: string;
            Hs: number;
          };
        };
        setSimTimeISO(payload.simTimeISO);
        setSimSpeed(payload.speed);
        const p = payload.params;
        lastTwinParamsRef.current = p;
        setWindSpeed(p.u);
        setWindDir(p.dir);
        setEmissionQ(p.q);
        setGridHalf(p.half);
        setStab(p.stab as "A" | "B" | "C" | "D" | "E" | "F");
        setStackHs(p.Hs);
        scheduleGenerate();
      } catch {}
    };
    return () => {
      ev.close();
    };
  }, [mode, plumeSite, scheduleGenerate]);

  const toggleMode = async () => {
    const next = mode === "twin" ? "simulate" : "twin";
    try {
      const { data } = await api.post("/twin/mode", {
        mode: next,
        speed: simSpeed,
      });
      setMode(data.mode);
      setSimSpeed(data.speed);
      setSimTimeISO(data.nowSimISO);
    } catch {}
  };

  // ---------------------------
  // RESPONSIVE CONTROL PANELS
  // ---------------------------
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<
    "layers" | "plume" | "affected" | "weights"
  >("plume");

  // Reusable sections (so desktop & mobile use same JSX)
  const LayersPanel = () => (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-3">Risk Coloring</h3>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: "#d1fae5" }}
            />
            <span>Low Risk (0.0)</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: "#facc15" }}
            />
            <span>Medium (0.5)</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: "#ef4444" }}
            />
            <span>High Risk (1.0)</span>
          </div>
          <div className="pt-1 text-[10px] text-white/60">
            Site clusters shown in blue
          </div>
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-3">Hazard Overlays</h3>
        <div className="space-y-3 text-xs">
          {/* <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500/60" />
              <span>FEMA Flood Zones</span>
            </div>
            <Checkbox
              checked={layerVisibility.flood}
              onCheckedChange={() => toggleLayer("flood")}
              className="h-4 w-4"
            />
          </div> */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-500/50" />
              <span>Drought Monitor</span>
            </div>
            <Checkbox
              checked={layerVisibility.drought}
              onCheckedChange={() => toggleLayer("drought")}
              className="h-4 w-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500/50" />
              <span>Heat Risk (NOAA)</span>
            </div>
            <Checkbox
              checked={layerVisibility.heat}
              onCheckedChange={() => toggleLayer("heat")}
              className="h-4 w-4"
            />
          </div>
        </div>
      </div>
    </div>
  );

  // Helper component for a single statistic
  const StatBlock: React.FC<{
    label: React.ReactNode;
    value?: React.ReactNode;
    subtext?: React.ReactNode;
    loading?: boolean;
    children?: React.ReactNode;
  }> = ({ label, value, subtext, loading = false, children }) => (
    <div className="space-y-0.5">
      {/* Label (e.g., "Area") */}
      <label className="text-xs uppercase tracking-wider text-white/70">
        {label}
      </label>

      {/* Value (e.g., "1,234 mi²") */}
      {loading ? (
        <div className="text-xl font-semibold">…</div>
      ) : (
        <div className="text-xl font-semibold">{value ?? "—"}</div>
      )}

      {/* Subtext (e.g., "ppl/km²" or the refresh button) */}
      <div className="text-[11px] text-white/50 h-4">{subtext}</div>
      {children}
    </div>
  );

  // Display-scaled area and population/density (scale area by 100x per UI request)
  const displayAreaM2 = useMemo(
    () => (areaInfo ? areaInfo.m2 * 100 : null),
    [areaInfo]
  );
  const baseDensityKm2 = useMemo(() => {
    if (popDensity != null) return popDensity;
    if (popTotal != null && areaInfo) {
      const km2 = areaInfo.m2 / 1_000_000;
      return km2 > 0 ? popTotal / km2 : null;
    }
    return null;
  }, [popDensity, popTotal, areaInfo]);
  const displayPop = useMemo(() => {
    if (baseDensityKm2 != null && displayAreaM2 != null) {
      const km2 = displayAreaM2 / 1_000_000;
      return Math.round(baseDensityKm2 * km2);
    }
    if (popTotal != null) return popTotal;
    return null;
  }, [baseDensityKm2, displayAreaM2, popTotal]);
  const displayDensityMi2 = useMemo(() => {
    if (baseDensityKm2 != null) return baseDensityKm2 * 2.58998811; // ppl/mi^2
    return null;
  }, [baseDensityKm2]);

  const AffectedPanel = () => (
    <div className="space-y-4">
      {" "}
      {/* Increased spacing between sections */}
      {/* Section 1: Master Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-sm flex items-center gap-2 font-medium">
          <Checkbox
            checked={showAffected}
            onCheckedChange={() => setShowAffected((v) => !v)}
            className="h-4 w-4"
          />{" "}
          Show Affected Area (24h)
        </label>
      </div>
      {/* Section 2: Hero Stats Block (Now the most prominent part) */}
      {areaInfo && (
        <div className="grid grid-cols-3 gap-4 py-3 px-2 rounded-md bg-white/5">
          <StatBlock
            label="Area"
            value={`${(areaInfo.mi2 * 100).toFixed(2)} mi²`}
            subtext={`Base: ${areaInfo.mi2.toFixed(2)} mi²`}
          />
          <StatBlock
            label="People (24h)"
            value={displayPop != null ? displayPop.toLocaleString() : null}
            subtext="Scaled from base WorldPop"
            loading={popLoading}
          />
          <StatBlock
            label="Pop. Density (ppl/mi²)"
            value={
              displayDensityMi2 != null
                ? Math.round(displayDensityMi2).toLocaleString()
                : null
            }
            subtext="Scaled from base"
            loading={popLoading}
          >
            {/* Refresh button now neatly placed within its stat block */}
            {popTotal == null && popDensity == null && !popLoading && (
              <button
                onClick={() => {
                  lastPopRef.current = null;
                  recomputeAffected();
                }}
                className="mt-1 text-[10px] bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors"
                title="Force refresh population data"
              >
                Refresh
              </button>
            )}
          </StatBlock>
        </div>
      )}
      {/* People Risk summary */}
      {areaInfo && (
        <div className="rounded-md bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/70">Harm Index</div>
            <div
              className={`text-xs font-medium ${
                peopleRisk < 0.2
                  ? "text-emerald-300"
                  : peopleRisk < 0.4
                    ? "text-yellow-300"
                    : peopleRisk < 0.7
                      ? "text-orange-300"
                      : "text-red-300"
              }`}
            >
              {peopleRiskLabel}
            </div>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${
                peopleRisk < 0.2
                  ? "bg-emerald-400/80"
                  : peopleRisk < 0.4
                    ? "bg-yellow-400/80"
                    : peopleRisk < 0.7
                      ? "bg-orange-400/80"
                      : "bg-red-500/80"
              }`}
              style={{ width: `${Math.round((peopleRisk || 0) * 100)}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] text-white/60">
            <div>
              <div>Hazard</div>
              <div className="font-mono text-white/85">
                {hazardComposite.toFixed(2)}
              </div>
            </div>
            <div>
              <div>Exposure</div>
              <div className="font-mono text-white/85">
                {coverageFrac > 0 ? exposureFactor.toFixed(2) : "—"}
              </div>
            </div>
            <div>
              <div>Density</div>
              <div className="font-mono text-white/85">
                {popDensity != null ? densityNorm.toFixed(2) : "—"}
              </div>
            </div>
            <div>
              <div>AQ Impact</div>
              <div className="font-mono text-white/85">
                {aqImpactPct != null ? `${aqImpactPct}%` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Section 3: Configuration Controls */}
      <div className="space-y-3 pt-3 border-t border-white/15">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs">Aggregation</label>
            <Select
              value={affectedAgg}
              onValueChange={(v: string) =>
                setAffectedAgg(v as "union" | "exposure")
              }
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="union">Union (any exceed)</SelectItem>
                <SelectItem value="exposure">Exposure (hours ≥ thr)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs">Resolution (m)</label>
            <Select
              value={String(occRes)}
              onValueChange={(v: string) => setOccRes(Number(v))}
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs">Threshold mode</label>
            <Select
              value={thrMode}
              onValueChange={(v: string) =>
                setThrMode(v as "relative" | "absolute")
              }
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relative">
                  Relative (% of frame max)
                </SelectItem>
                <SelectItem value="absolute">Absolute</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {thrMode === "relative" ? (
            <div className="space-y-1">
              <label className="text-xs">
                Relative α ({Math.round(thrRelAlpha * 100)}%)
              </label>
              <Slider
                value={[thrRelAlpha]}
                min={0.01}
                max={0.2}
                step={0.01}
                onValueChange={([v]) => setThrRelAlpha(v)}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs">Absolute C_thr</label>
              <Input
                type="number"
                value={thrAbs}
                onChange={(e) => setThrAbs(Number(e.target.value) || 0)}
                className="h-8 bg-white/10 border-white/20"
              />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs">Affected opacity</label>
          <Slider
            value={[affectedOpacity]}
            min={0.1}
            max={1}
            step={0.05}
            onValueChange={([v]) => setAffectedOpacity(v)}
          />
        </div>

        {affectedAgg === "exposure" && (
          <div className="space-y-1 pt-2">
            <div className="text-[11px] text-white/70">
              Exposure legend (hours ≥ threshold)
            </div>
            <svg viewBox="0 0 100 8" className="w-full h-2 rounded">
              <defs>
                <linearGradient
                  id="alpha-grad"
                  x1="0%"
                  x2="100%"
                  y1="0%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="0"
                width="100"
                height="8"
                fill="url(#alpha-grad)"
                rx="1"
              />
            </svg>
            <div className="flex justify-between text-[10px] text-white/60">
              {[0, 4, 8, 12, 16, 20, 24].map((v) => (
                <span key={v}>{v}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
  const WeightsPanel = () => (
    <div className="space-y-4">
      <h3 className="font-semibold">Risk Weights</h3>
      {(
        [
          ["emissions", "Emissions"] as const,
          ["flood", "Flood"] as const,
          ["heat", "Heat"] as const,
          ["drought", "Drought"] as const,
        ] as const
      ).map(([k, label]) => (
        <div key={k}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs">{label}</label>
            <span className="text-xs font-mono">{weights[k].toFixed(2)}</span>
          </div>
          <Slider
            value={[weights[k]]}
            onValueChange={([value]) => updateWeight(k, value)}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>
      ))}
      <div className="pt-2 border-t border-white/20">
        <div className="text-xs text-white/70">
          Total:{" "}
          {(
            weights.emissions +
            weights.flood +
            weights.heat +
            weights.drought +
            weights.proximity
          ).toFixed(2)}
        </div>
        <button
          onClick={() => {
            const newWeights = {
              emissions: 0.35,
              flood: 0.35,
              heat: 0.2,
              drought: 0.1,
              proximity: 0,
            };
            setWeights(newWeights);
            updateMapData(newWeights);
          }}
          className="mt-2 text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition-colors"
        >
          Reset Defaults
        </button>
      </div>
    </div>
  );

  const PlumePanel = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Plume Controls</h3>
        <button
          onClick={toggleMode}
          className={`rounded-full px-2 py-0.5 border text-xs ${
            mode === "twin"
              ? "border-green-400/40 bg-green-400/10"
              : "border-white/10 bg-white/5"
          }`}
        >
          {mode === "twin" ? "Digital Twin" : "Simulate"}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/70">
        <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
          Speed {simSpeed}×
        </div>
        {mode === "twin" && (
          <div className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono">
            {simTimeISO ? simTimeISO.replace("T", " ").replace("Z", "Z") : "—"}
          </div>
        )}
      </div>
      <div className="text-xs text-white/70">
        {plumeSite
          ? `Site: ${plumeSite.name} (${plumeSite.lat.toFixed(4)}, ${plumeSite.lon.toFixed(4)})`
          : "Choose a site:"}
      </div>
      {/* Site select */}
      <div className="space-y-1">
        <Select
          value={plumeSite?.id ?? ""}
          onValueChange={(id) => {
            const s = sites?.find((x) => String(x.id) === String(id));
            if (s) {
              setPlumeSite({
                id: String(s.id),
                name: s.name,
                lat: s.lat,
                lon: s.lon,
              });
              if (map.current)
                map.current.easeTo({
                  center: [s.lon, s.lat],
                  zoom: Math.max(8, map.current.getZoom()),
                });
              scheduleGenerate();
            }
          }}
        >
          <SelectTrigger className="h-8 bg-white/10 border-white/20">
            <SelectValue placeholder="Select site" />
          </SelectTrigger>
          <SelectContent>
            {(sites ?? []).map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid: inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs">Wind speed (m/s)</label>
          <Input
            disabled={mode === "twin"}
            type="number"
            value={windSpeed}
            onChange={(e) => setWindSpeed(Number(e.target.value))}
            className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs flex items-center justify-between">
            Wind dir (°)
            <span
              className="ml-2 inline-block h-4 w-4"
              style={{ transform: `rotate(${windDir}deg)` }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 opacity-80">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <path d="M12 3 L14 9 L12 7 L10 9 Z" fill="currentColor" />
              </svg>
            </span>
          </label>
          <Input
            disabled={mode === "twin"}
            type="number"
            value={windDir}
            onChange={(e) =>
              setWindDir(Math.max(0, Math.min(359, Number(e.target.value))))
            }
            className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs">Emission q</label>
          <Input
            disabled={mode === "twin"}
            type="number"
            value={emissionQ}
            onChange={(e) => setEmissionQ(Number(e.target.value))}
            className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs">Extent (km)</label>
          <Input
            disabled={mode === "twin"}
            type="number"
            value={Math.round(gridHalf / 1000)}
            onChange={(e) =>
              setGridHalf(Math.max(1000, Number(e.target.value) * 1000))
            }
            className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs">Stability</label>
          <Select
            value={stab}
            onValueChange={(v: string) =>
              setStab(v as "A" | "B" | "C" | "D" | "E" | "F")
            }
          >
            <SelectTrigger className="h-8 bg-white/10 border-white/20">
              <SelectValue placeholder="D" />
            </SelectTrigger>
            <SelectContent>
              {["A", "B", "C", "D", "E", "F"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">Stack Hs (m)</label>
          <Input
            disabled={mode === "twin"}
            type="number"
            value={stackHs}
            onChange={(e) => setStackHs(Number(e.target.value))}
            className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          disabled={mode === "twin"}
          checked={logScale}
          onCheckedChange={() => setLogScale((v) => !v)}
          className="h-4 w-4"
        />
        <span className="text-xs">Log color scale</span>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="space-y-1">
          <label className="text-xs">Scale mode</label>
          <Select
            value={scaleMode}
            onValueChange={(v: string) =>
              setScaleMode(v as "auto" | "absolute")
            }
          >
            <SelectTrigger className="h-8 bg-white/10 border-white/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="absolute">Absolute</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">Scale max</label>
          <div className="flex items-center gap-2">
            <Input
              disabled={mode === "twin"}
              type="number"
              value={scaleMax ?? 0}
              onChange={(e) => setScaleMax(Number(e.target.value) || null)}
              className="h-8 bg-white/10 border-white/20 disabled:opacity-60"
            />
            <Button
              disabled={mode === "twin"}
              variant="outline"
              className="h-8"
              onClick={() => setScaleMax(null)}
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs">Opacity</label>
          <Slider
            value={[plumeOpacity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([v]) => setPlumeOpacity(v)}
          />
        </div>
        <div className="space-y-1 flex items-end">
          <label className="text-xs flex items-center gap-2">
            <Checkbox
              checked={ghostPrev}
              onCheckedChange={() => setGhostPrev((v) => !v)}
              className="h-4 w-4"
            />{" "}
            Ghost previous
          </label>
        </div>
      </div>

      {/* Legend */}
      <div className="pt-2">
        <div className="flex items-center justify-between text-[11px] text-white/70">
          <span>
            {legendMin != null
              ? logScale
                ? legendMin.toExponential(1)
                : legendMin.toPrecision(2)
              : "min"}
          </span>
          <span>Legend {logScale ? "(log)" : "(linear)"}</span>
          <span>
            {legendMax != null
              ? logScale
                ? legendMax.toExponential(1)
                : legendMax.toPrecision(2)
              : "max"}
          </span>
        </div>
        <svg viewBox="0 0 100 8" className="w-full h-2 rounded">
          <defs>
            <linearGradient id="viridis-grad" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor="#440154" />
              <stop offset="10%" stopColor="#472f7d" />
              <stop offset="20%" stopColor="#3b518b" />
              <stop offset="35%" stopColor="#2c718e" />
              <stop offset="50%" stopColor="#21918c" />
              <stop offset="65%" stopColor="#35b779" />
              <stop offset="80%" stopColor="#90d743" />
              <stop offset="100%" stopColor="#fde725" />
            </linearGradient>
          </defs>
          <rect
            x="0"
            y="0"
            width="100"
            height="8"
            fill="url(#viridis-grad)"
            rx="1"
          />
        </svg>
      </div>

      <Button
        onClick={() => generatePlume()}
        disabled={!plumeSite || mode === "twin"}
        className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60"
      >
        {mode === "twin" ? "Twin Running" : "Generate"}
      </Button>
    </div>
  );

  // ---------------------------
  // RENDER
  // ---------------------------
  return (
    <div className="relative w-full h-[calc(100dvh-var(--header-h))]">
      {/* Map canvas */}
      <div
        ref={mapContainer}
        className="absolute inset-0"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Status chip (moved to bottom-right to avoid overlap) */}
      <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 bg-black/80 text-white text-xs px-2 py-1 rounded z-20">
        {statusMsg}
      </div>

      {/* DESKTOP/LAPTOP FLOATING PANELS */}
      {/* Layers (top-left) */}
      <div
        className="
          hidden md:block
          absolute top-4 left-4 z-20
          bg-black/90 backdrop-blur text-white p-4 rounded-lg text-sm
          w-[min(90vw,320px)] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain
        "
      >
        <LayersPanel />
      </div>

      {/* Plume (top-right) */}
      <div
        className="
          hidden md:block
          absolute top-4 right-4 z-20
          bg-black/90 backdrop-blur text-white p-4 rounded-lg text-sm
          w-[min(92vw,420px)] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain
        "
      >
        <PlumePanel />
      </div>

      {/* Weights (bottom-left) */}
      <div
        className="
          hidden md:block
          absolute left-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]
          z-20
          bg-black/90 backdrop-blur text-white p-4 rounded-lg text-sm
          w-[min(92vw,380px)] max-h-[40vh] overflow-y-auto overscroll-contain
        "
      >
        <WeightsPanel />
      </div>
      {/* Affected (bottom-right) */}
      <div
        className="
     hidden md:block
     absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2
     z-20
     bg-black/90 backdrop-blur text-white p-4 rounded-lg text-sm
     w-[min(92vw,420px)] max-h-[40vh] overflow-y-auto overscroll-contain
   "
      >
        <AffectedPanel />
      </div>
      {showAffected && areaInfo && (
        <div
          className="
      absolute left-1/2 -translate-x-1/2
      bottom-[calc(1rem+env(safe-area-inset-bottom))]
      z-50 bg-black/80 text-white text-xs px-2 py-1 rounded
    "
          title="Affected area over last 24h"
        >
          {Math.round(areaInfo.ft2).toLocaleString()} ft² ·{" "}
          {areaInfo.mi2.toFixed(2)} mi²
        </div>
      )}

      {/* MOBILE: Controls FAB + Slide-in Drawer */}
      <button
        className="
          md:hidden
          fixed z-30 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]
          rounded-full px-4 py-2 text-sm
          bg-white/10 text-white backdrop-blur border border-white/20
          hover:bg-white/20 transition
        "
        onClick={() => setMobileOpen(true)}
        aria-label="Open controls"
      >
        Controls
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div
            className="
              absolute right-0 top-0 h-full w-[85vw] max-w-sm
              bg-zinc-900 text-white p-3
              shadow-2xl border-l border-white/10
              flex flex-col
            "
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">Controls</div>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10"
                aria-label="Close controls"
              >
                Close
              </button>
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-4 gap-1 text-xs mb-2">
              {(["layers", "plume", "affected", "weights"] as const).map(
                (tab) => (
                  <button
                    key={tab}
                    onClick={() => setMobileTab(tab)}
                    className={`px-2 py-1 rounded border ${
                      mobileTab === tab
                        ? "bg-white/15 border-white/30"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                )
              )}
            </div>

            {/* Panel content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
              {mobileTab === "layers" && <LayersPanel />}
              {mobileTab === "plume" && <PlumePanel />}
              {mobileTab === "affected" && <AffectedPanel />}
              {mobileTab === "weights" && <WeightsPanel />}
            </div>

            {/* Quick actions (optional) */}
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => generatePlume()}
                disabled={!plumeSite || mode === "twin"}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 h-9"
              >
                {mode === "twin" ? "Twin Running" : "Generate"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Probe tooltip */}
      {probe && (
        <div
          className="pointer-events-none absolute z-30 text-xs bg-black/80 text-white px-2 py-1 rounded"
          style={{ left: probe.x + 10, top: probe.y + 10 }}
        >
          C ≈ {probe.val.toExponential(2)} at {probe.downwindKm.toFixed(1)} km
          downwind
        </div>
      )}
    </div>
  );
}
