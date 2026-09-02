"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { useUrlFilters } from "@/hooks/use-url-filters";

/**
 * One-way bridge: mirrors the URL filters (`?start&end&platform&compare`) into the
 * Zustand store so the ~30 existing components that read `dateRange` /
 * `selectedPlatform` from the store keep working unchanged while the URL stays
 * the source of truth. Renders nothing.
 */
export function UrlFilterSync() {
  const { start, end, platform, compare } = useUrlFilters();
  const setDateRange = useAppStore((s) => s.setDateRange);
  const setSelectedPlatform = useAppStore((s) => s.setSelectedPlatform);
  const setCompareMode = useAppStore((s) => s.setCompareMode);

  useEffect(() => {
    if (start && end) setDateRange({ start, end });
  }, [start, end, setDateRange]);

  useEffect(() => {
    setSelectedPlatform(platform);
  }, [platform, setSelectedPlatform]);

  useEffect(() => {
    setCompareMode(compare);
  }, [compare, setCompareMode]);

  return null;
}
