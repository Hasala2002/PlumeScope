"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Copy, Check, Loader2, Activity, Server } from "lucide-react";
import {
  Shield as ShieldIcon,
  Link as LinkIcon,
  Settings as SettingsIcon,
  Compass as DatabaseIcon,
  Clock as ClockIcon,
} from "@geist-ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface HealthResponse {
  status: string;
  timestamp: string;
}

interface HealthData {
  status: "ok" | "error";
  latency: number;
  timestamp: string;
}

interface Site {
  id: string;
  name: string;
}

interface ScoreData {
  id: string;
  name: string;
}

type LogEntry = {
  timestamp: string;
  action: string;
};

async function fetchHealth(): Promise<HealthData> {
  const startTime = Date.now();
  try {
    const response = await axios.get<HealthResponse>(
      `http://localhost:3001/health`
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

async function fetchSitesCount(): Promise<number> {
  const { data } = await axios.get<Site[]>(`http://localhost:3001/sites`);
  return data.length;
}

async function fetchScoreCount(): Promise<number> {
  const { data } = await axios.get<ScoreData[]>(`http://localhost:3001/score`);
  return data.length;
}

export default function Page() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const isDefaultBase = apiBaseUrl.includes("localhost");

  const addLog = (action: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      action,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 10));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiBaseUrl);
      setCopied(true);
      addLog("Copied API Base URL to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addLog("Failed to copy API Base URL");
    }
  };

  const healthMutation = useMutation({
    mutationFn: fetchHealth,
    onSuccess: (data) =>
      addLog(`Health check: ${data.status} (${data.latency}ms)`),
    onError: () => addLog("Health check failed"),
  });

  const sitesMutation = useMutation({
    mutationFn: fetchSitesCount,
    onSuccess: (count) => addLog(`Fetched sites count: ${count}`),
    onError: () => addLog("Failed to fetch sites count"),
  });

  const scoreMutation = useMutation({
    mutationFn: fetchScoreCount,
    onSuccess: (count) => addLog(`Fetched score count: ${count}`),
    onError: () => addLog("Failed to fetch score count"),
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Subtle Vercel-esque glows + hairlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(600px_200px_at_50%_-100px,rgba(255,255,255,0.10),transparent),radial-gradient(900px_300px_at_85%_10%,rgba(255,255,255,0.06),transparent),radial-gradient(900px_300px_at_15%_10%,rgba(255,255,255,0.06),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <div className="relative mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70 ring-1 ring-inset ring-white/5">
            <Server className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">
            Admin Dashboard
          </h1>
          <p className="text-sm text-white/70">
            Environment and service checks
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* API Base URL */}
          <Card className="rounded-2xl border-white/10 bg-white/[0.05] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white/90">
                <LinkIcon className="h-4 w-4 opacity-80" />
                API Base URL
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm font-mono text-white/90">
                  {apiBaseUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  aria-label="Copy API base URL"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="mt-2 text-xs text-white/60">
                Status:{" "}
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    isDefaultBase
                      ? "border border-white/15 bg-white/[0.05] text-white/80"
                      : "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  }`}
                >
                  {isDefaultBase ? "Local default" : "Custom"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card className="rounded-2xl border-white/10 bg-white/[0.05] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white/90">
                <SettingsIcon className="h-4 w-4 opacity-80" />
                Environment Variables
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-white/70">
                Check and manage environment variables in the{" "}
                <span className="font-medium text-white/90">Vars</span> section
                of the in-chat sidebar.
              </p>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/70">
                Ensure all required API keys and configuration variables are set
                for proper application functionality.
              </div>
            </CardContent>
          </Card>

          {/* Health Check */}
          <Card className="rounded-2xl border-white/10 bg-white/[0.05] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base text-white/90">
                  <Activity className="h-4 w-4 opacity-80" />
                  Health Check
                </CardTitle>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/70">
                  <Activity className="h-3 w-3" />
                  on demand
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => healthMutation.mutate()}
                disabled={healthMutation.isPending}
                className="mb-3 w-full rounded-xl bg-white text-black hover:bg-white/90"
              >
                {healthMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  "Ping /health"
                )}
              </Button>

              {!healthMutation.isPending &&
                !healthMutation.data &&
                !healthMutation.isError && (
                  <p className="text-xs text-white/60">
                    Press the button to run a health check.
                  </p>
                )}

              {healthMutation.data && (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/60">Status:</span>
                    <span
                      className={
                        healthMutation.data.status === "ok"
                          ? "font-medium text-emerald-400"
                          : "font-medium text-red-400"
                      }
                    >
                      {healthMutation.data.status === "ok" ? "OK" : "Error"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Latency:</span>
                    <span className="font-mono">
                      {healthMutation.data.latency}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/60">Last Check:</span>
                    <span className="font-mono text-xs">
                      {new Date(
                        healthMutation.data.timestamp
                      ).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              )}

              {healthMutation.isError && (
                <div className="mt-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
                  Failed to reach health endpoint
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Preview */}
          <Card className="rounded-2xl border-white/10 bg-white/[0.05] backdrop-blur ring-1 ring-inset ring-white/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-white/90">
                <DatabaseIcon className="h-4 w-4 opacity-80" />
                Data Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Button
                    onClick={() => sitesMutation.mutate()}
                    disabled={sitesMutation.isPending}
                    className="w-full rounded-xl border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    variant="outline"
                    size="sm"
                  >
                    {sitesMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Fetch /sites Count"
                    )}
                  </Button>
                  {sitesMutation.data !== undefined && (
                    <p className="mt-1 text-sm text-white/70">
                      Sites:{" "}
                      <span className="font-mono font-medium text-white/90">
                        {sitesMutation.data}
                      </span>
                    </p>
                  )}
                  {sitesMutation.isError && (
                    <p className="mt-1 text-xs text-red-300">Failed to fetch</p>
                  )}
                </div>

                <div>
                  <Button
                    onClick={() => scoreMutation.mutate()}
                    disabled={scoreMutation.isPending}
                    className="w-full rounded-xl border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    variant="outline"
                    size="sm"
                  >
                    {scoreMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Fetch /score Count"
                    )}
                  </Button>
                  {scoreMutation.data !== undefined && (
                    <p className="mt-1 text-sm text-white/70">
                      Scores:{" "}
                      <span className="font-mono font-medium text-white/90">
                        {scoreMutation.data}
                      </span>
                    </p>
                  )}
                  {scoreMutation.isError && (
                    <p className="mt-1 text-xs text-red-300">Failed to fetch</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Log */}
        <Card className="mt-6 rounded-2xl border-white/10 bg-white/[0.05] backdrop-blur ring-1 ring-inset ring-white/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white/90">
              <ClockIcon className="h-4 w-4 opacity-80" />
              Recent Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-white/60">No actions logged yet</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {logs.map((log, i) => (
                  <div
                    key={`${log.timestamp}-${i}`}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="text-white/50">[{log.timestamp}]</span>
                    <span className="font-mono text-white/90">
                      {log.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom hairline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  );
}
