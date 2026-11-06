"use client";

import { useAuth } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/common/Toast";
import { ConfigError } from "@/components/layout/ConfigError";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function Providers({ children }: { children: ReactNode }) {
  // TanStack Query is used only for non-Convex HTTP data (geocoding, routing).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 5 * 60_000, refetchOnWindowFocus: false } },
      }),
  );
  if (!convex) {
    return <ConfigError missing={["NEXT_PUBLIC_CONVEX_URL"]} />;
  }
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </ConvexProviderWithClerk>
  );
}
