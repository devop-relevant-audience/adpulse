"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardTemplateSummary,
  DashboardLayouts,
  TemplateContent,
  WidgetInstance,
} from "@/lib/dashboard/types";

// Agency-wide dashboard templates (/api/templates): named snapshots of a whole
// view, used to stamp the same layout onto any client. Agency-only, so the list
// query is disabled for client users (nothing calls it from their UI).

async function jsonOrThrow(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  }
  return res.json();
}

export const TEMPLATES_KEY = ["dashboard-templates"] as const;
/** The master's content. A prefix of TEMPLATES_KEY, so invalidating that hits it too. */
export const MASTER_TEMPLATE_KEY = ["dashboard-templates", "master"] as const;

export function useTemplates(enabled = true) {
  return useQuery<DashboardTemplateSummary[]>({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => {
      const res = await fetch("/api/templates");
      return jsonOrThrow(res, "Failed to load templates") as Promise<DashboardTemplateSummary[]>;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The MASTER template's full content — the house dashboard. The server creates
 * it from the built-in preset on first read, so this never resolves to nothing.
 */
export function useMasterTemplate(enabled = true) {
  return useQuery<TemplateContent>({
    queryKey: MASTER_TEMPLATE_KEY,
    queryFn: async () => {
      const res = await fetch("/api/templates?action=master");
      return jsonOrThrow(res, "Failed to load the master template") as Promise<TemplateContent>;
    },
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidateTemplates() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    // Templates hold saved-widget links too, so creating or deleting one
    // changes the "used in N views and M templates" counts.
    queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
  };
}

/** Snapshot a saved view into a new template (the view as last saved). */
export function useCreateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; fromDashboardId: string }) => {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to save template");
    },
    onSuccess: invalidate,
  });
}

/** Rename / re-describe. Template content is immutable in this phase. */
export function useUpdateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string }) => {
      const res = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to update template");
    },
    onSuccess: invalidate,
  });
}

/**
 * Save a template's blocks. Editing the master changes what every client with
 * no saved view renders, so the dashboard queries go stale with it.
 */
export function useSaveTemplateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      layouts: DashboardLayouts;
      widgets: WidgetInstance[];
      version?: number;
    }) => {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to save the template") as Promise<TemplateContent>;
    },
    onSuccess: (saved, sent) => {
      // Cache what the SERVER stored, never the draft: the draft carries the
      // transient `syncToLibrary` flag and the inline config of linked widgets.
      if (saved.isMaster) queryClient.setQueryData(MASTER_TEMPLATE_KEY, saved);
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
      // A client with no saved view renders the master.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // An "update everywhere" rewrote a library row, which changes every other
      // grid that links it.
      if (sent.widgets.some((w) => w.syncToLibrary)) {
        queryClient.invalidateQueries({ queryKey: ["saved-widgets"] });
        queryClient.invalidateQueries({ queryKey: ["report-layout"] });
      }
    },
  });
}

/** Deleting a template leaves every view already created from it untouched. */
export function useDeleteTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/templates?id=${id}`, { method: "DELETE" });
      await jsonOrThrow(res, "Failed to delete template");
      return id;
    },
    onSuccess: invalidate,
  });
}
