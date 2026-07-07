"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardConfig } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { loadLocalDashboard, saveLocalDashboard } from "@/lib/dashboard/persistence";

// Dashboards persist server-side via /api/dashboards, scoped per client.
// localStorage is kept as an optimistic/offline cache: if the network read
// fails we fall back to the last-saved local copy (or the default preset).

export function useDashboard(clientId: string | null) {
  return useQuery<DashboardConfig>({
    queryKey: ["dashboard", clientId],
    queryFn: async () => {
      if (!clientId) return buildDefaultDashboard();
      try {
        const res = await fetch(`/api/dashboards?clientId=${clientId}`);
        if (!res.ok) throw new Error("Failed to load dashboard");
        const config = (await res.json()) as DashboardConfig;
        saveLocalDashboard(clientId, config);
        return config;
      } catch {
        return loadLocalDashboard(clientId) ?? buildDefaultDashboard();
      }
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });
}

export function useSaveDashboard(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: DashboardConfig) => {
      if (!clientId) throw new Error("No client selected");
      // Optimistic local cache first so the UI survives a failed/slow request.
      saveLocalDashboard(clientId, config);
      const res = await fetch("/api/dashboards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, config }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save dashboard");
      }
      return (await res.json()) as DashboardConfig;
    },
    onSuccess: (config) => {
      queryClient.setQueryData(["dashboard", clientId], config);
    },
  });
}
