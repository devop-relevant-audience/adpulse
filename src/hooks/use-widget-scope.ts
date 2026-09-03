"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import {
  hasWidgetFilters,
  readWidgetFilters,
  resolveWidgetDateRange,
} from "@/lib/dashboard/filters";
import type { WidgetFilters } from "@/lib/dashboard/types";
import type { Platform } from "@/lib/types/database";

export interface WidgetScope {
  clientId: string | null;
  /** Effective range: the widget's pinned override, else the page's date picker. */
  dateRange: { start: string; end: string };
  /** Effective platform filter: widget override, else the global selector wrapped in an array, else undefined. */
  platforms: Platform[] | undefined;
  /** Single-platform convenience for callers that need one value (undefined when 0 or 2+ platforms). */
  platform: Platform | undefined;
  /** Effective campaign filter: widget override, else the page selection, else undefined. */
  campaignIds: string[] | undefined;
  filters: WidgetFilters;
  hasWidgetFilters: boolean;
}

/**
 * Combines the page-level selection (client, date range, platform, campaigns)
 * with the widget's own `config.filters`. A non-empty widget platform or
 * campaign list replaces the matching page selection, and a pinned `dateRange`
 * replaces the page range (presets resolve on every render, so they stay
 * rolling).
 */
export function useWidgetScope(config: Record<string, unknown>): WidgetScope {
  const clientId = useAppStore((s) => s.selectedClientId);
  const pageDateRange = useAppStore((s) => s.dateRange);
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);
  const selectedCampaignIds = useAppStore((s) => s.selectedCampaignIds);

  return useMemo<WidgetScope>(() => {
    const filters = readWidgetFilters(config);
    const platforms = filters.platforms?.length
      ? filters.platforms
      : selectedPlatform
        ? [selectedPlatform]
        : undefined;
    const campaignIds = filters.campaignIds?.length
      ? filters.campaignIds
      : selectedCampaignIds.length > 0
        ? selectedCampaignIds
        : undefined;
    const platform = platforms && platforms.length === 1 ? platforms[0] : undefined;
    return {
      clientId,
      dateRange: resolveWidgetDateRange(filters.dateRange) ?? pageDateRange,
      platforms,
      platform,
      campaignIds,
      filters,
      hasWidgetFilters: hasWidgetFilters(filters),
    };
  }, [config, clientId, pageDateRange, selectedPlatform, selectedCampaignIds]);
}
