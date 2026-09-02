"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReportLayoutConfig, ReportLayoutSummary } from "@/lib/dashboard/types";
import type { ViewSnapshot } from "@/lib/reports/view-snapshot";

// The report builder's per-client layouts (/api/report-layouts). Mirrors
// `use-dashboard.ts`, minus the localStorage cache: a layout is an authoring
// surface for agency staff, so there is nothing to render offline.

async function jsonOrThrow(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  }
  return res.json();
}

/** The client's report layouts, most recently edited first. */
export function useReportLayouts(clientId: string | null, enabled = true) {
  return useQuery<ReportLayoutSummary[]>({
    queryKey: ["report-layouts", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/report-layouts?clientId=${clientId}&action=list`);
      return jsonOrThrow(res, "Failed to load report layouts") as Promise<ReportLayoutSummary[]>;
    },
    enabled: enabled && !!clientId,
    staleTime: 60_000,
  });
}

/** One layout's full config (widgets hydrated from the library server-side). */
export function useReportLayout(clientId: string | null, layoutId: string | null) {
  return useQuery<ReportLayoutConfig>({
    queryKey: ["report-layout", clientId, layoutId],
    queryFn: async () => {
      const res = await fetch(`/api/report-layouts?clientId=${clientId}&id=${layoutId}`);
      return jsonOrThrow(res, "Failed to load the report layout") as Promise<ReportLayoutConfig>;
    },
    enabled: !!clientId && !!layoutId,
    staleTime: 60_000,
  });
}

/**
 * A throwaway render of the SAVED layout over `range` — what generating it now
 * would produce, minus the AI summary. Never cached: a preview is a live look,
 * so it is refetched every time the dialog opens.
 */
export function useReportLayoutPreview(
  clientId: string | null,
  layoutId: string | null,
  range: { start: string; end: string } | null,
  enabled: boolean
) {
  return useQuery<ViewSnapshot>({
    queryKey: ["report-layout-preview", clientId, layoutId, range?.start, range?.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        clientId: clientId!,
        action: "preview",
        id: layoutId!,
        start: range!.start,
        end: range!.end,
      });
      const res = await fetch(`/api/report-layouts?${params}`);
      return jsonOrThrow(res, "Failed to build the preview") as Promise<ViewSnapshot>;
    },
    enabled: enabled && !!clientId && !!layoutId && !!range,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useSaveReportLayout(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: ReportLayoutConfig) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/report-layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, config }),
      });
      return jsonOrThrow(res, "Failed to save the report layout") as Promise<ReportLayoutConfig>;
    },
    onSuccess: (saved, sent) => {
      // Cache what the SERVER stored, never the draft: the draft carries the
      // transient `syncToLibrary` flag and the inline config of linked widgets.
      queryClient.setQueryData(["report-layout", clientId, saved.id ?? null], saved);
      queryClient.invalidateQueries({ queryKey: ["report-layouts", clientId] });
      // An "update everywhere" rewrote a library row, which changes what every
      // dashboard view and every other layout renders.
      if (sent.widgets.some((w) => w.syncToLibrary)) {
        queryClient.invalidateQueries({ queryKey: ["saved-widgets"] });
        queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["report-layout"] });
      }
    },
  });
}

export function useCreateReportLayout(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      duplicateFromId?: string;
      fromTemplateId?: string;
    }) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/report-layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...input }),
      });
      return jsonOrThrow(res, "Failed to create the report layout") as Promise<ReportLayoutConfig>;
    },
    onSuccess: (created) => {
      // Seed both caches before the invalidation refetch lands, so opening the
      // new layout straight away doesn't bounce off a list without it.
      const createdId = created.id;
      if (createdId) {
        queryClient.setQueryData(["report-layout", clientId, createdId], created);
        queryClient.setQueryData<ReportLayoutSummary[]>(["report-layouts", clientId], (list) =>
          list && !list.some((l) => l.id === createdId)
            ? [
                { id: createdId, name: created.name, updatedAt: new Date().toISOString() },
                ...list,
              ]
            : list
        );
      }
      queryClient.invalidateQueries({ queryKey: ["report-layouts", clientId] });
      // A duplicate/template stamp copies linked widgets, so the library's usage
      // counts move.
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
    },
  });
}

export function useRenameReportLayout(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch("/api/report-layouts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...input }),
      });
      return jsonOrThrow(res, "Failed to rename the report layout") as Promise<ReportLayoutConfig>;
    },
    onSuccess: (layout) => {
      queryClient.setQueryData(["report-layout", clientId, layout.id ?? null], layout);
      queryClient.invalidateQueries({ queryKey: ["report-layouts", clientId] });
    },
  });
}

export function useDeleteReportLayout(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!clientId) throw new Error("No client selected");
      const res = await fetch(`/api/report-layouts?clientId=${clientId}&id=${id}`, {
        method: "DELETE",
      });
      await jsonOrThrow(res, "Failed to delete the report layout");
      return id;
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: ["report-layout", clientId, id] });
      queryClient.invalidateQueries({ queryKey: ["report-layouts", clientId] });
      // Deleting a layout drops whatever library links it held.
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
    },
  });
}
