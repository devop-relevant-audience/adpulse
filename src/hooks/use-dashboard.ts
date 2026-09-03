"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardConfig, DashboardSummary, DashboardVisibility } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { clearLocalDashboard, loadLocalDashboard, saveLocalDashboard } from "@/lib/dashboard/persistence";

// Dashboard views persist server-side via /api/dashboards, scoped per client.
// localStorage is kept as an optimistic/offline cache: if the network read
// fails we fall back to the last-saved local copy (or the default preset).

async function jsonOrThrow(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  }
  return res.json();
}

/** The client's views for the switcher. Client users only get published ones. */
export function useDashboards(clientId: string | null) {
  return useQuery<DashboardSummary[]>({
    queryKey: ["dashboards", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboards?clientId=${clientId}&action=list`);
      return jsonOrThrow(res, "Failed to load dashboard views") as Promise<DashboardSummary[]>;
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });
}

/**
 * One view's full config; without a `viewId` the client's default view.
 * Resolves to `null` when a specific view is gone or not visible to this user —
 * the caller clears its selection and refetches the default rather than showing
 * a fabricated preset whose Save would insert a duplicate row.
 */
export function useDashboard(clientId: string | null, viewId?: string | null) {
  return useQuery<DashboardConfig | null>({
    queryKey: ["dashboard", clientId, viewId ?? null],
    queryFn: async () => {
      if (!clientId) return buildDefaultDashboard();
      const offline = () => loadLocalDashboard(clientId, viewId) ?? buildDefaultDashboard();
      try {
        const query = viewId ? `clientId=${clientId}&id=${viewId}` : `clientId=${clientId}`;
        const res = await fetch(`/api/dashboards?${query}`);
        // An HTTP error on a specific view is an answer, not an outage.
        if (!res.ok) return viewId ? null : offline();
        const config = (await res.json()) as DashboardConfig;
        saveLocalDashboard(clientId, config, viewId);
        return config;
      } catch {
        // Network-level failure only: fall back to the last-saved local copy.
        return offline();
      }
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });
}

export function useSaveDashboard(clientId: string | null, viewId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: DashboardConfig) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/dashboards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, config }),
      });
      return jsonOrThrow(res, "Failed to save dashboard") as Promise<DashboardConfig>;
    },
    onSuccess: (config, sent) => {
      queryClient.setQueryData(["dashboard", clientId, viewId ?? null], config);
      // Cache what the SERVER stored, never the draft: the draft carries the
      // transient `syncToLibrary` flag and the inline config of linked widgets,
      // and a rejected payload must never become the "last saved" copy.
      if (clientId) saveLocalDashboard(clientId, config, viewId);
      // A first save of the preset creates a row, so the list changes too.
      queryClient.invalidateQueries({ queryKey: ["dashboards", clientId] });
      // An "update everywhere" rewrote a library row, which changes what every
      // other view renders.
      if (sent.widgets.some((w) => w.syncToLibrary)) {
        queryClient.invalidateQueries({ queryKey: ["saved-widgets"] });
        queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
}

export function useCreateDashboard(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      duplicateFromId?: string;
      fromTemplateId?: string;
      /** Start from the master template. Mutually exclusive with the two above. */
      fromMaster?: true;
    }) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...input }),
      });
      return jsonOrThrow(res, "Failed to create view") as Promise<DashboardConfig>;
    },
    onSuccess: (created) => {
      // Seed both caches before the invalidation refetch lands: the switcher
      // selects the new view immediately, and the dashboard's stale-selection
      // fallback would bounce off a view list that doesn't contain it yet.
      const createdId = created.id;
      if (createdId) {
        queryClient.setQueryData(["dashboard", clientId, createdId], created);
        queryClient.setQueryData<DashboardSummary[]>(["dashboards", clientId], (list) =>
          list && !list.some((v) => v.id === createdId)
            ? [
                ...list,
                {
                  id: createdId,
                  name: created.name,
                  visibility: created.visibility,
                  isDefault: created.isDefault ?? false,
                  updatedAt: new Date().toISOString(),
                },
              ]
            : list
        );
      }
      queryClient.invalidateQueries({ queryKey: ["dashboards", clientId] });
      // A duplicate/template stamp copies linked widgets, so the library's
      // "used in N views" counts move.
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
    },
  });
}

/** Rename / publish / set-default. Any subset of the fields. */
export function useUpdateDashboard(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      visibility?: DashboardVisibility;
      isDefault?: true;
    }) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/dashboards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...input }),
      });
      return jsonOrThrow(res, "Failed to update view") as Promise<DashboardConfig>;
    },
    onSuccess: (config) => {
      queryClient.setQueryData(["dashboard", clientId, config.id ?? null], config);
      queryClient.invalidateQueries({ queryKey: ["dashboards", clientId] });
      // A rename or a new default changes what the default-view slot holds, and
      // that is what the header renders when no view is explicitly selected.
      queryClient.invalidateQueries({ queryKey: ["dashboard", clientId, null] });
      if (clientId) clearLocalDashboard(clientId, null);
    },
  });
}

export function useDeleteDashboard(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch(`/api/dashboards?clientId=${clientId}&id=${id}`, { method: "DELETE" });
      await jsonOrThrow(res, "Failed to delete view");
      clearLocalDashboard(clientId, id);
      // The same view is also cached in the "default" slot whenever it was read
      // without an explicit id, so that copy has to go too.
      clearLocalDashboard(clientId, null);
      return id;
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: ["dashboard", clientId, id] });
      queryClient.invalidateQueries({ queryKey: ["dashboards", clientId] });
      // The default may have been promoted elsewhere.
      queryClient.invalidateQueries({ queryKey: ["dashboard", clientId, null] });
      // Deleting a view drops whatever library links it held.
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
    },
  });
}
