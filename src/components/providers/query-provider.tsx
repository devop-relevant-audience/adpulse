"use client";

import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { logger } from "@/lib/log";

// Expected auth errors are handled elsewhere (session-expiry redirect,
// unprovisioned 403 state), so they must not be reported as incidents.
function isExpectedAuthError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

function reportQueryError(error: unknown, context: string): void {
  if (isExpectedAuthError(error)) return;
  // logger.error is the single Sentry forwarder (see src/lib/log.ts).
  logger.error(context, error);
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => reportQueryError(error, "React Query request failed"),
        }),
        mutationCache: new MutationCache({
          onError: (error) => reportQueryError(error, "React Query mutation failed"),
        }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
