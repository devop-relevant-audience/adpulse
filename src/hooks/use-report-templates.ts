"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReportTemplateSummary } from "@/lib/dashboard/types";

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
