"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useCampaigns } from "@/hooks/use-metrics";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PLATFORMS } from "@/lib/types/database";
import type { Platform } from "@/lib/types/database";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT } from "@/lib/dashboard/chart-theme";
import { readWidgetFilters, writeWidgetFilters } from "@/lib/dashboard/filters";
import type { WidgetConfigFormProps } from "@/lib/dashboard/types";

const EMPTY: string[] = [];

/**
 * Shared "Filters" section of the widget config dialog. Writes the normalized
 * `config.filters` via `writeWidgetFilters` (empty selections drop the key).
 */
export function WidgetFiltersForm({ config, onChange }: WidgetConfigFormProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const filters = useMemo(() => readWidgetFilters(config), [config]);
  const platforms = filters.platforms ?? (EMPTY as Platform[]);
  const campaignIds = filters.campaignIds ?? EMPTY;

  const [search, setSearch] = useState("");
  const { data: campaigns, isLoading } = useCampaigns(clientId);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (campaigns ?? []).filter((c) => {
      if (platforms.length > 0 && !platforms.includes(c.platform as Platform)) return false;
      if (q && !c.campaign_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, platforms, search]);

  function togglePlatform(p: Platform) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    onChange(writeWidgetFilters(config, { ...filters, platforms: next }));
  }

  function toggleCampaign(id: string) {
    // Selected ids outside the visible list are kept; only the toggled id changes.
    const next = campaignIds.includes(id)
      ? campaignIds.filter((x) => x !== id)
      : [...campaignIds, id];
    onChange(writeWidgetFilters(config, { ...filters, campaignIds: next }));
  }

  function clearCampaigns() {
    onChange(writeWidgetFilters(config, { ...filters, campaignIds: [] }));
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-ink-secondary">Filters</label>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Overrides the page filters for this widget only.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-secondary">Platforms</span>
          {platforms.length === 0 && (
            <span className="text-[11px] text-ink-muted">Following page filter</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const active = platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => togglePlatform(p)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md border transition-colors",
                  active
                    ? "border-primary bg-primary/8 text-primary font-medium"
                    : "border-hairline text-ink-muted hover:text-ink"
                )}
              >
                {PLATFORM_LABELS_SHORT[p]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-secondary">
            Campaigns
            {campaignIds.length > 0 && (
              <span className="text-ink-muted font-normal"> · {campaignIds.length} selected</span>
            )}
          </span>
          {campaignIds.length > 0 && (
            <button
              type="button"
              onClick={clearCampaigns}
              className="text-[11px] text-ink-muted hover:text-ink transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search campaigns"
          aria-label="Search campaigns"
          className="h-7 text-xs"
        />
        <div className="max-h-48 overflow-y-auto rounded-md border border-hairline">
          {!clientId || isLoading ? (
            <div className="p-2 space-y-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-3 text-center text-xs text-ink-muted">No campaigns found</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {visible.map((c) => {
                const checked = campaignIds.includes(c.campaign_id);
                const platform = c.platform as Platform;
                return (
                  <li key={`${c.platform}:${c.campaign_id}`}>
                    <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-canvas-soft/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCampaign(c.campaign_id)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-hairline accent-primary"
                      />
                      <span className="text-xs text-ink truncate flex-1 min-w-0">
                        {c.campaign_name}
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-ink-muted">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                        />
                        {PLATFORM_LABELS_SHORT[platform] ?? c.platform}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
