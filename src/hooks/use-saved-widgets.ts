"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedWidget, SavedWidgetUsage, WidgetType } from "@/lib/dashboard/types";

// The agency-wide saved widget library (/api/saved-widgets). Every mutation
// invalidates the dashboard view queries too: a linked widget's config is
// hydrated server-side, so a library edit changes what those views render.

async function jsonOrThrow(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  }
  return res.json();
}

export const SAVED_WIDGETS_KEY = ["saved-widgets"] as const;

export function savedWidgetUsageQuery(id: string) {
  return {
    queryKey: ["saved-widget-usage", id] as const,
    queryFn: async (): Promise<SavedWidgetUsage> => {
      const res = await fetch(`/api/saved-widgets?action=usage&id=${id}`);
      return jsonOrThrow(res, "Failed to load widget usage") as Promise<SavedWidgetUsage>;
    },
    staleTime: 30_000,
  };
}

export function useSavedWidgets(enabled = true) {
  return useQuery<SavedWidget[]>({
    queryKey: SAVED_WIDGETS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/saved-widgets");
      return jsonOrThrow(res, "Failed to load saved widgets") as Promise<SavedWidget[]>;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Which views use a library entry. Used to prefetch while the config dialog is
 * open so the "update everywhere / create a copy" decision is instant on Save.
 */
export function useSavedWidgetUsage(id: string | null | undefined) {
  return useQuery({ ...savedWidgetUsageQuery(id ?? ""), enabled: !!id });
}

// Any library write can change what a dashboard renders, so both caches go.
function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: SAVED_WIDGETS_KEY });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["saved-widget-usage"] });
  };
}

export function useCreateSavedWidget() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      widgetType: WidgetType;
      config: Record<string, unknown>;
    }) => {
      const res = await fetch("/api/saved-widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to save widget") as Promise<SavedWidget>;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateSavedWidget() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; config?: Record<string, unknown> }) => {
      const res = await fetch("/api/saved-widgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return jsonOrThrow(res, "Failed to update saved widget") as Promise<SavedWidget>;
    },
    onSuccess: invalidate,
  });
}

/** Deleting detaches server-side: views that used the entry keep it inline. */
export function useDeleteSavedWidget() {
  const invalidate = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/saved-widgets?id=${id}`, { method: "DELETE" });
      await jsonOrThrow(res, "Failed to delete saved widget");
      return id;
    },
    onSuccess: invalidate,
  });
}
