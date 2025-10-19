"use client";
import { useOptimizeJob } from "@/providers/optimize-job";
import { useRouter } from "next/navigation";
import { Loader } from "@geist-ui/icons";

export function NavProgressIndicator() {
  const { status } = useOptimizeJob();
  const router = useRouter();

  if (status !== "running") {
    return null;
  }

  return (
    <button
      onClick={() => router.push("/optimize")}
      className="flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-sm text-blue-300 transition hover:bg-blue-500/20 hover:border-blue-400/50"
      title="Optimization in progress - click to view"
    >
      <Loader className="h-3 w-3 animate-spin" />
      <span className="hidden sm:inline">Generating...</span>
    </button>
  );
}