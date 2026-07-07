"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardConfig } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { loadLocalDashboard, saveLocalDashboard } from "@/lib/dashboard/persistence";

// Stage 1: dashboards persist in localStorage. The query/mutation signatures are
// intentionally the shape they'll keep once stage 3 points them at
// /api/dashboards, so callers won't change.

export function useDashboard(clientId: string | null) {
  return useQuery<DashboardConfig>({
    queryKey: ["dashboard", clientId],
    queryFn: async () => {
      if (!clientId) return buildDefaultDashboard();
      return loadLocalDashboard(clientId) ?? buildDefaultDashboard();
    },
    enabled: !!clientId,
    staleTime: Infinity,
  });
}

export function useSaveDashboard(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: DashboardConfig) => {
      if (!clientId) throw new Error("No client selected");
      saveLocalDashboard(clientId, config);
      return config;
    },
    onSuccess: (config) => {
      queryClient.setQueryData(["dashboard", clientId], config);
    },
  });
}
