"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardLayouts,
  ReportTemplateSummary,
  TemplateContent,
  WidgetInstance,
} from "@/lib/dashboard/types";
import type { ViewSnapshot } from "@/lib/reports/view-snapshot";

// Agency-wide report templates (/api/report-templates): named snapshots of a
// whole report layout, used to stamp the same report structure onto any client.
// Mirrors `use-templates.ts`.

async function jsonOrThrow(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  }
  return res.json();
}

export const REPORT_TEMPLATES_KEY = ["report-templates"] as const;
/** The master's content. A prefix of REPORT_TEMPLATES_KEY, so that invalidation hits it. */
export const MASTER_REPORT_TEMPLATE_KEY = ["report-templates", "master"] as const;

export function useReportTemplates(enabled = true) {
  return useQuery<ReportTemplateSummary[]>({
    queryKey: REPORT_TEMPLATES_KEY,
    queryFn: async () => {
      const res = await fetch("/api/report-templates");
      return jsonOrThrow(res, "Failed to load report templates") as Promise<
        ReportTemplateSummary[]
      >;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The MASTER report template's full content — the house report. The server
 * creates it from the built-in report preset on first read.
 */
export function useMasterReportTemplate(enabled = true) {
  return useQuery<TemplateContent>({
    queryKey: MASTER_REPORT_TEMPLATE_KEY,
    queryFn: async () => {
      const res = await fetch("/api/report-templates?action=master");
      return jsonOrThrow(res, "Failed to load the master report template") as Promise<
        TemplateContent
      >;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * A throwaway render of a report TEMPLATE against one client's data — what
 * stamping it onto them would produce, minus the AI summary. Never cached: a
 * preview is a live look, so it is refetched every time the dialog opens.
 */
export function useReportTemplatePreview(
  clientId: string | null,
  templateId: string | null,
  range: { start: string; end: string } | null,
  enabled: boolean
) {
  return useQuery<ViewSnapshot>({
    queryKey: ["report-template-preview", clientId, templateId, range?.start, range?.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        clientId: clientId!,
        action: "preview",
        id: templateId!,
        start: range!.start,
        end: range!.end,
      });
      const res = await fetch(`/api/report-templates?${params}`);
      return jsonOrThrow(res, "Failed to build the preview") as Promise<ViewSnapshot>;
    },
    enabled: enabled && !!clientId && !!templateId && !!range,
    staleTime: 0,
    gcTime: 0,
  });
}

function useInvalidateReportTemplates() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: REPORT_TEMPLATES_KEY });
    // Templates hold saved-widget links too, so creating or deleting one moves
    // the library's usage counts.
    queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
  };
}

/** Snapshot a saved layout into a new template (the layout as last saved). */
export function useCreateReportTemplate() {
  const invalidate = useInvalidateReportTemplates();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      fromReportLayoutId: string;
    }) => {
      const res = await fetch("/api/report-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to save the report template");
    },
    onSuccess: invalidate,
  });
}

/** Rename / re-describe. Template content is immutable in this phase. */
export function useUpdateReportTemplate() {
  const invalidate = useInvalidateReportTemplates();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string }) => {
      const res = await fetch("/api/report-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to update the report template");
    },
    onSuccess: invalidate,
  });
}

/**
 * Save a report template's blocks. The master is what every new report layout
 * starts from, so saving it only moves future stamps — existing layouts are
 * copies and stay put.
 */
export function useSaveReportTemplateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      layouts: DashboardLayouts;
      widgets: WidgetInstance[];
      version?: number;
    }) => {
      const res = await fetch("/api/report-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to save the report template") as Promise<TemplateContent>;
    },
    onSuccess: (saved, sent) => {
      // Cache what the SERVER stored, never the draft: the draft carries the
      // transient `syncToLibrary` flag and the inline config of linked widgets.
      if (saved.isMaster) queryClient.setQueryData(MASTER_REPORT_TEMPLATE_KEY, saved);
      queryClient.invalidateQueries({ queryKey: REPORT_TEMPLATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
      // An "update everywhere" rewrote a library row, which changes every other
      // grid that links it.
      if (sent.widgets.some((w) => w.syncToLibrary)) {
        queryClient.invalidateQueries({ queryKey: ["saved-widgets"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["report-layout"] });
      }
    },
  });
}

/** Deleting a template leaves every layout already stamped from it untouched. */
export function useDeleteReportTemplate() {
  const invalidate = useInvalidateReportTemplates();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/report-templates?id=${id}`, { method: "DELETE" });
      await jsonOrThrow(res, "Failed to delete the report template");
      return id;
    },
    onSuccess: invalidate,
  });
}
