"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css"; // <-- Import Leaflet CSS

import {
  Search as SearchIcon,
  Download as DownloadIcon,
  Compass as DatabaseIcon,
} from "@geist-ui/icons";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// --- Type Definitions ---
interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  CO2e_tpy: number;
  CH4_tpy: number;
}

interface SiteScore {
  id: string;
  name: string;
  lat: number;
  lon: number;
  CO2e_tpy: number;
  CH4_tpy: number;
  EmissionsScore: number;
  FloodScore: number;
  HeatScore: number;
  DroughtScore: number;
  Risk: number;
}

type SortField = "name" | "lat" | "lon" | "CO2e_tpy" | "CH4_tpy";
type SortDirection = "asc" | "desc";

// --- API Fetching ---
async function fetchSites(): Promise<Site[]> {
  const response = await axios.get<Site[]>("http://localhost:3001/sites");
  return response.data;
}

async function fetchScores(): Promise<SiteScore[]> {
  const response = await axios.get<SiteScore[]>("http://localhost:3001/score");
  return response.data;
}

// --- Helper Components ---
const fmt = (n: number, digits = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  if (!active) return null;
  return dir === "asc" ? (
    <ChevronUp className="h-4 w-4" />
  ) : (
    <ChevronDown className="h-4 w-4" />
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-200/60 px-0.5 text-foreground dark:bg-yellow-400/30">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

function ScoreBar({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={`rounded-lg border border-white/10 bg-white/[0.04] p-3 ${
        className || ""
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-white/70">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(3)}</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-white/60 to-white/20"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// --- Main Page Component ---
export default function Page() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // --- Dynamically import map components ---
  // This prevents SSR issues with Leaflet
  const MapContainer = useMemo(
    () =>
      dynamic(() => import("react-leaflet").then((mod) => mod.MapContainer), {
        ssr: false,
      }),
    []
  );
  const TileLayer = useMemo(
    () =>
      dynamic(() => import("react-leaflet").then((mod) => mod.TileLayer), {
        ssr: false,
      }),
    []
  );
  const CircleMarker = useMemo(
    () =>
      dynamic(() => import("react-leaflet").then((mod) => mod.CircleMarker), {
        ssr: false,
      }),
    []
  );
  const Popup = useMemo(
    () =>
      dynamic(() => import("react-leaflet").then((mod) => mod.Popup), {
        ssr: false,
      }),
    []
  );

  // --- Data Fetching ---
  const {
    data: sites,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });

  const { data: scores } = useQuery({
    queryKey: ["scores"],
    queryFn: fetchScores,
    enabled: selectedSiteId !== null, // fetch details only when drawer opens
  });

  // --- Memos for Derived Data ---
  const filteredAndSortedSites = useMemo(() => {
    if (!sites) return [];
    const filtered = sites.filter((site) =>
      site.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    filtered.sort((a, b) => {
      if (sortField === "name") {
        return sortDirection === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      if (sortField === "lat") {
        return sortDirection === "asc" ? a.lat - b.lat : b.lat - a.lat;
      }
      if (sortField === "lon") {
        return sortDirection === "asc" ? a.lon - b.lon : b.lon - a.lon;
      }
      if (sortField === "CO2e_tpy") {
        return sortDirection === "asc"
          ? a.CO2e_tpy - b.CO2e_tpy
          : b.CO2e_tpy - a.CO2e_tpy;
      }
      if (sortField === "CH4_tpy") {
        return sortDirection === "asc"
          ? a.CH4_tpy - b.CH4_tpy
          : b.CH4_tpy - a.CH4_tpy;
      }
      return 0;
    });
    return filtered;
  }, [sites, searchQuery, sortField, sortDirection]);

  const selectedSiteScore = useMemo(() => {
    if (!selectedSiteId || !scores) return null;
    return scores.find((s) => s.id === selectedSiteId) || null;
  }, [selectedSiteId, scores]);

  const mapCenter: [number, number] = useMemo(() => {
    // Center map on US, or average of sites if available
    if (sites && sites.length > 0) {
      const avgLat =
        sites.reduce((acc, site) => acc + site.lat, 0) / sites.length;
      const avgLon =
        sites.reduce((acc, site) => acc + site.lon, 0) / sites.length;
      return [avgLat, avgLon];
    }
    return [40.0, -95.0]; // Default center (approx US)
  }, [sites]);

  // --- Event Handlers ---
  const handleSort = (field: SortField) => {
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return prevField;
      }
      setSortDirection("asc");
      return field;
    });
  };

  const downloadCSV = () => {
    if (!filteredAndSortedSites.length) return;
    const headers = ["Name", "Lat", "Lon", "CO2e_tpy", "CH4_tpy"];
    const rows = filteredAndSortedSites.map((site) => [
      site.name,
      site.lat.toString(),
      site.lon.toString(),
      site.CO2e_tpy.toString(),
      site.CH4_tpy.toString(),
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sites_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Close drawer on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setSelectedSiteId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Render ---
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background Effects */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(900px_300px_at_85%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(900px_300px_at_15%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-10">
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <DatabaseIcon className="h-6 w-6 opacity-80" />
            Sites
          </h1>
          <p className="text-sm text-white/70">
            Manage and view all monitoring locations
          </p>
        </div>

        {/* --- NEW: Split Layout (Map + Table) --- */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* --- Map Column --- */}
          <div className="lg:col-span-2">
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] text-white backdrop-blur ring-1 ring-inset ring-white/5">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="h-[500px] w-full animate-pulse rounded-2xl bg-white/10" />
                ) : (
                  <MapContainer
                    center={mapCenter}
                    zoom={4}
                    scrollWheelZoom={true}
                    className="h-[500px] w-full rounded-2xl"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    {filteredAndSortedSites.map((site) => (
                      <CircleMarker
                        key={site.id}
                        center={[site.lat, site.lon]}
                        radius={6}
                        pathOptions={{
                          color: "#f59e0b", // amber-500
                          fillColor: "#f59e0b",
                          fillOpacity: 0.7,
                          weight: 1.5,
                        }}
                        eventHandlers={{
                          click: () => {
                            setSelectedSiteId(site.id);
                          },
                        }}
                      >
                        <Popup>{site.name}</Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* --- Table Column --- */}
          <div className="lg:col-span-3">
            {/* Toolbar */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-md">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    type="text"
                    placeholder="Search by site name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="rounded-xl border-white/10 bg-white/[0.06] pl-9 text-white placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                  {searchQuery && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* (Placeholder) Sector filter */}
                <div className="hidden sm:block">
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/80">
                    All Sectors
                  </div>
                </div>
              </div>

              <Button
                onClick={downloadCSV}
                disabled={!filteredAndSortedSites.length}
                variant="outline"
                className="rounded-xl border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
              >
                <DownloadIcon className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
            </div>

            {/* Table */}
            <Card className="rounded-2xl border-white/10 bg-white/[0.04] text-white backdrop-blur ring-1 ring-inset ring-white/5">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="space-y-2 p-6">
                    <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-80 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-64 animate-pulse rounded bg-white/10" />
                  </div>
                ) : error ? (
                  <div className="flex items-center justify-center p-12 text-red-400">
                    Error loading sites. Please try again.
                  </div>
                ) : !filteredAndSortedSites.length ? (
                  <div className="flex items-center justify-center p-12 text-white/60">
                    {searchQuery
                      ? "No sites match your search."
                      : "No sites available."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/40 backdrop-blur">
                        <tr className="text-white/70">
                          {(
                            [
                              ["name", "Name"],
                              ["lat", "Lat"],
                              ["lon", "Lon"],
                              ["CO2e_tpy", "CO2e (tpy)"],
                              ["CH4_tpy", "CH4 (tpy)"],
                            ] as [SortField, string][]
                          ).map(([key, label]) => {
                            const active = sortField === key;
                            const ariaSort:
                              | "ascending"
                              | "descending"
                              | "none" = active
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none";
                            return (
                              <th
                                key={key}
                                scope="col"
                                aria-sort={ariaSort}
                                className="cursor-pointer px-4 py-3 text-left font-medium hover:bg-white/[0.04]"
                                onClick={() => handleSort(key)}
                              >
                                <div className="flex items-center gap-2">
                                  {label}
                                  <SortIcon
                                    active={active}
                                    dir={sortDirection}
                                  />
                                </div>
                              </th>
                            );
                          })}
                          <th className="px-4 py-3 text-left font-medium">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {filteredAndSortedSites.map((site) => (
                          <tr
                            key={site.id}
                            className="hover:bg-white/[0.03]"
                            onDoubleClick={() => setSelectedSiteId(site.id)}
                          >
                            <td className="px-4 py-3 font-medium">
                              {highlight(site.name, searchQuery)}
                            </td>
                            <td className="px-4 py-3 font-mono text-white/80">
                              {site.lat.toFixed(4)}
                            </td>
                            <td className="px-4 py-3 font-mono text-white/80">
                              {site.lon.toFixed(4)}
                            </td>
                            <td className="px-4 py-3 font-mono">
                              {fmt(site.CO2e_tpy, 2)}
                            </td>
                            <td className="px-4 py-3 font-mono">
                              {fmt(site.CH4_tpy, 2)}
                            </td>
                            <td className="px-4 py-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedSiteId(site.id)}
                                className="rounded-lg border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                              >
                                Score
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Score Drawer (No changes needed) */}
      {selectedSiteId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedSiteId(null);
          }}
        >
          <div className="h-full w-full max-w-md animate-in slide-in-from-right bg-black text-white shadow-xl">
            {/* glossy top edge */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
            <div className="flex h-full flex-col">
              <div className="relative border-b border-white/10 px-6 pb-14 pt-6">
                {/* subtle header beam */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[radial-gradient(40%_100%_at_50%_0%,rgba(255,255,255,0.15),transparent)]"
                />
                <div className="relative z-10 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Site Score Details</h2>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedSiteId(null)}
                    className="text-white/80 hover:bg-white/10"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {!selectedSiteScore ? (
                  <div className="space-y-3">
                    <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-56 animate-pulse rounded bg-white/10" />
                    <div className="h-24 w-full animate-pulse rounded bg-white/10" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="mb-1 text-lg font-semibold">
                        {selectedSiteScore.name}
                      </h3>
                      <p className="text-sm text-white/70">
                        {selectedSiteScore.lat.toFixed(4)},{" "}
                        {selectedSiteScore.lon.toFixed(4)}
                      </p>
                    </div>

                    {/* Metric bars */}
                    <div className="grid grid-cols-1 gap-3">
                      <ScoreBar
                        label="Emissions Score"
                        value={selectedSiteScore.EmissionsScore}
                      />
                      <ScoreBar
                        label="Flood Score"
                        value={selectedSiteScore.FloodScore}
                      />
                      <ScoreBar
                        label="Heat Score"
                        value={selectedSiteScore.HeatScore}
                      />
                      <ScoreBar
                        label="Drought Score"
                        value={selectedSiteScore.DroughtScore}
                      />
                    </div>

                    {/* Overall */}
                    <div className="rounded-xl border-2 border-white/20 bg-white/[0.05] p-4">
                      <div className="mb-1 text-sm text-white/80">
                        Overall Risk
                      </div>
                      <div className="text-3xl font-bold">
                        {selectedSiteScore.Risk.toFixed(3)}
                      </div>
                    </div>

                    {/* Raw values */}
                    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/70">CO2e (tpy):</span>
                        <span className="font-mono">
                          {fmt(selectedSiteScore.CO2e_tpy, 2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/70">CH4 (tpy):</span>
                        <span className="font-mono">
                          {fmt(selectedSiteScore.CH4_tpy, 2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* bottom hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
