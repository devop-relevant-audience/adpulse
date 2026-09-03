"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfigSection, ConfigField, ChipRow, ChipToggle } from "@/components/dashboard/config-ui";
import { CampaignPicker, campaignCountLabel } from "@/components/dashboard/campaign-picker";
import { PLATFORMS } from "@/lib/types/database";
import type { Platform } from "@/lib/types/database";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT } from "@/lib/dashboard/chart-theme";
import {
  describeWidgetDateRange,
  hasWidgetFilters,
  readWidgetFilters,
  writeWidgetFilters,
} from "@/lib/dashboard/filters";
import { DATE_RANGE_PRESETS } from "@/lib/dashboard/date-presets";
import type { WidgetConfigFormProps } from "@/lib/dashboard/types";

const EMPTY: string[] = [];

// Sentinels for the two non-preset choices; `__`-prefixed so they can never
// collide with a preset id.
const FOLLOW_PAGE = "__follow";
const CUSTOM_RANGE = "__custom";

/**
 * Shared "Filters" section of the widget config dialog. Writes the normalized
 * `config.filters` via `writeWidgetFilters` (empty selections drop the key).
 */
export function WidgetFiltersForm({ config, onChange }: WidgetConfigFormProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const pageRange = useAppStore((s) => s.dateRange);
  const pageCampaignIds = useAppStore((s) => s.selectedCampaignIds);
  const filters = useMemo(() => readWidgetFilters(config), [config]);
  const platforms = filters.platforms ?? (EMPTY as Platform[]);
  const campaignIds = filters.campaignIds ?? EMPTY;

  const dateRange = filters.dateRange;
  const fixed = dateRange && !("preset" in dateRange) ? dateRange : null;
  const dateMode = !dateRange ? FOLLOW_PAGE : "preset" in dateRange ? dateRange.preset : CUSTOM_RANGE;

  // The custom start/end live in local state so a half-typed (invalid) range
  // does not get dropped by `writeWidgetFilters` and snap the select back to
  // "Follow page". Only a valid range is written.
  const [customDraft, setCustomDraft] = useState(() => fixed ?? pageRange);
  const fixedKey = fixed ? `${fixed.start}|${fixed.end}` : null;
  const [lastFixedKey, setLastFixedKey] = useState(fixedKey);
  if (fixedKey !== lastFixedKey) {
    // A different widget's stored range arrived (or our own write landed).
    setLastFixedKey(fixedKey);
    if (fixed) setCustomDraft(fixed);
  }
  const customValid = customDraft.start !== "" && customDraft.end !== "" && customDraft.start <= customDraft.end;

  const active = hasWidgetFilters(filters);

  function setDateMode(value: string | null) {
    if (value === null || value === FOLLOW_PAGE) {
      onChange(writeWidgetFilters(config, { ...filters, dateRange: undefined }));
      return;
    }
    if (value === CUSTOM_RANGE) {
      const next = customValid ? customDraft : pageRange;
      setCustomDraft(next);
      onChange(writeWidgetFilters(config, { ...filters, dateRange: next }));
      return;
    }
    onChange(writeWidgetFilters(config, { ...filters, dateRange: { preset: value } }));
  }

  function setCustomBound(bound: "start" | "end", value: string) {
    const next = { ...customDraft, [bound]: value };
    setCustomDraft(next);
    if (next.start && next.end && next.start <= next.end) {
      onChange(writeWidgetFilters(config, { ...filters, dateRange: next }));
    }
  }

  function togglePlatform(p: Platform) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    onChange(writeWidgetFilters(config, { ...filters, platforms: next }));
  }

  function setCampaignIds(next: string[]) {
    onChange(writeWidgetFilters(config, { ...filters, campaignIds: next }));
  }

  function clearAll() {
    onChange(writeWidgetFilters(config, {}));
  }

  return (
    <ConfigSection
      title="Filters"
      hint={
        active ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-ink-muted hover:text-ink underline underline-offset-2 transition-colors"
          >
            Clear all
          </button>
        ) : (
          "This widget only"
        )
      }
    >
      <ConfigField
        label="Date range"
        hint={
          dateMode === FOLLOW_PAGE
            ? "Following the page date picker"
            : dateMode === CUSTOM_RANGE && !customValid
              ? "Start must be on or before end"
              : undefined
        }
      >
        <Select value={dateMode} onValueChange={setDateMode}>
          <SelectTrigger className="w-full h-8 text-xs">
            <SelectValue>
              {dateMode === FOLLOW_PAGE
                ? "Follow page date range"
                : dateRange
                  ? describeWidgetDateRange(dateRange)
                  : "Custom range"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_PAGE}>Follow page date range</SelectItem>
            {DATE_RANGE_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_RANGE}>Custom range…</SelectItem>
          </SelectContent>
        </Select>
        {dateMode === CUSTOM_RANGE && (
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={customDraft.start}
              max={customDraft.end || undefined}
              onChange={(e) => setCustomBound("start", e.target.value)}
              aria-label="Start date"
              aria-invalid={!customValid}
              className="h-8 text-xs"
            />
            <Input
              type="date"
              value={customDraft.end}
              min={customDraft.start || undefined}
              onChange={(e) => setCustomBound("end", e.target.value)}
              aria-label="End date"
              aria-invalid={!customValid}
              className="h-8 text-xs"
            />
          </div>
        )}
      </ConfigField>

      <ConfigField
        label="Platforms"
        hint={platforms.length === 0 ? "Following the page filter" : undefined}
      >
        <ChipRow>
          {PLATFORMS.map((p) => {
            const on = platforms.includes(p);
            return (
              <ChipToggle key={p} active={on} onClick={() => togglePlatform(p)}>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: PLATFORM_COLORS[p] }}
                />
                {PLATFORM_LABELS_SHORT[p]}
              </ChipToggle>
            );
          })}
        </ChipRow>
      </ConfigField>

      <ConfigField
        label="Campaigns"
        hint={
          campaignIds.length > 0
            ? `${campaignIds.length} selected`
            : pageCampaignIds.length > 0
              ? `Following the page filter (${campaignCountLabel(pageCampaignIds.length)})`
              : "All campaigns"
        }
      >
        <CampaignPicker
          clientId={clientId}
          selectedIds={campaignIds}
          onChange={setCampaignIds}
          platforms={platforms}
        />
      </ConfigField>
    </ConfigSection>
  );
}
