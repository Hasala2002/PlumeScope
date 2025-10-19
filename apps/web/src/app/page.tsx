"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Map, Table, BarChart2, Sliders, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";

interface HealthResponse {
  status: string;
  timestamp: string;
}
interface HealthData {
  status: "ok" | "error";
  latency: number;
  timestamp: string;
}

async function fetchHealth(): Promise<HealthData> {
  const startTime = Date.now();
  try {
    const response = await axios.get<HealthResponse>(
      "http://localhost:3001/health"
    );
    const latency = Date.now() - startTime;
    return {
      status: "ok",
      latency,
      timestamp: response.data.timestamp || new Date().toISOString(),
    };
  } catch {
    const latency = Date.now() - startTime;
    return {
      status: "error",
      latency,
      timestamp: new Date().toISOString(),
    };
  }
}

export default function Page() {
  const { data: health, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 30000,
  });

  const navTiles = [
    { href: "/map", icon: Map, label: "Map", description: "View spatial data" },
    {
      href: "/sites",
      icon: Table,
      label: "Sites",
      description: "Manage locations",
    },
    {
      href: "/analytics",
      icon: BarChart2,
      label: "Analytics",
      description: "Data insights",
    },
    {
      href: "/optimize",
      icon: Sliders,
      label: "Optimize",
      description: "Tune parameters",
    },
  ];

  const statusText =
    health?.status === "ok"
      ? "Operational"
      : health?.status === "error"
        ? "Error"
        : "—";
  const statusDot =
    health?.status === "ok"
      ? "bg-emerald-500"
      : health?.status === "error"
        ? "bg-red-500"
        : "bg-zinc-400";

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Vercel-style subtle radial glows + top beam */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(800px_300px_at_80%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(800px_300px_at_20%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-6xl px-4 py-14 md:py-20">
        {/* Hero */}
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-white/70 ring-1 ring-inset ring-white/5">
            {/* <span className="h-1.5 w-1.5 rounded-full bg-white/60" /> */}
            <span>PlumeScope</span>
            {/* <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase">
              Beta
            </span> */}
          </div>
          <Image
            src="/logotr.png"
            alt="PlumeScope Logo"
            className="h-25 w-auto m-auto mt-2"
            width={25}
            height={25}
          />
          <h1 className="mb-3 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            Monitor site-level emissions in real time
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-white/70 md:text-base">
            A minimal, focused dashboard for mapping, analytics, and
            optimization.
          </p>
        </div>

        {/* Tiles */}
        <div className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {navTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur ring-1 ring-inset ring-white/5 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06] hover:ring-white/10"
              >
                {/* glossy edge */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
                />
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 ring-1 ring-inset ring-white/5">
                      <Icon className="h-5 w-5 text-white/80" />
                    </span>
                    <h2 className="text-lg font-medium">{tile.label}</h2>
                  </div>
                  <ArrowRight className="h-4 w-4 translate-x-0 opacity-60 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100" />
                </div>
                <p className="text-sm text-white/60">{tile.description}</p>

                {/* hover glow */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-20 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(240px 120px at var(--x,80%) var(--y,20%), rgba(255,255,255,0.08), transparent 70%)",
                  }}
                />
              </Link>
            );
          })}
        </div>

        {/* System Status */}
        <Card className="mx-auto max-w-md border-white/10 bg-white/[0.04] text-white backdrop-blur ring-1 ring-inset ring-white/5">
          <CardHeader>
            <CardTitle className="text-base text-white/90">
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Status</span>
                  <span className="inline-flex items-center gap-2 font-medium">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
                    {statusText}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Latency</span>
                  <span className="font-mono">{health?.latency ?? "—"}ms</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Last Check</span>
                  <span className="font-mono text-xs">
                    {health?.timestamp
                      ? new Date(health.timestamp).toLocaleTimeString()
                      : "—"}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* bottom divider */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
