"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { Toaster } from "sonner";
import { OptimizeJobProvider } from "@/providers/optimize-job";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <OptimizeJobProvider>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </OptimizeJobProvider>
    </QueryClientProvider>
  );
}
