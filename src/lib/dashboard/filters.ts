// Pure helpers for the per-widget filter stored at `config.filters`.
// No React here — shared by the widget frame (badge), the config form (write),
// the `useWidgetScope` hook (read) and the server (dashboards PUT validation,
// view-report snapshots).

import { z } from "zod";
import { format, parseISO } from "date-fns";
import { PLATFORMS } from "@/lib/types/database";
import type { Platform } from "@/lib/types/database";
import { DATE_RANGE_PRESETS } from "@/lib/dashboard/date-presets";
import type { WidgetDateRange, WidgetFilters } from "@/lib/dashboard/types";

const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google",
  meta: "Meta",
  tiktok: "TikTok",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function findPreset(id: string) {
  return DATE_RANGE_PRESETS.find((p) => p.id === id);
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

/** Non-empty strings only, deduped, original order preserved. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The two accepted `dateRange` shapes. The preset id is checked against the
 * live `DATE_RANGE_PRESETS` list, so a preset that is removed later stops
 * validating (and `readWidgetFilters` then drops it, falling back to the page
 * range) instead of resolving to nothing at render time.
 */
export const widgetDateRangeSchema = z.union([
  z
    .object({
      preset: z.string().refine((id) => Boolean(findPreset(id)), "unknown date range preset"),
    })
    .strict(),
  z
    .object({
      start: z.string().regex(ISO_DATE, "expected yyyy-MM-dd"),
      end: z.string().regex(ISO_DATE, "expected yyyy-MM-dd"),
    })
    .strict()
    .refine((r) => r.start <= r.end, "start must be on or before end"),
]);

/**
 * Canonical schema for the persisted `config.filters`. Strict on purpose: the
 * dashboards PUT rejects unknown keys rather than storing shapes the readers
 * below silently ignore.
 */
export const widgetFiltersSchema = z
  .object({
    platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
    campaignIds: z.array(z.string().min(1)).max(200).optional(),
    dateRange: widgetDateRangeSchema.optional(),
  })
  .strict();

/**
 * Defensive parse of `config.filters`. Anything that is not a string array is
 * ignored; platforms are validated against the known set and `dateRange`
 * against the two accepted shapes. Keys are only present when they hold a
 * value.
 */
export function readWidgetFilters(config: Record<string, unknown>): WidgetFilters {
  const raw = config.filters;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;

  const platforms = stringList(r.platforms).filter(isPlatform);
  const campaignIds = stringList(r.campaignIds);
  const parsedDateRange = widgetDateRangeSchema.safeParse(r.dateRange);

  const out: WidgetFilters = {};
  if (platforms.length > 0) out.platforms = platforms;
  if (campaignIds.length > 0) out.campaignIds = campaignIds;
  if (parsedDateRange.success) out.dateRange = parsedDateRange.data;
  return out;
}

export function hasWidgetFilters(filters: WidgetFilters): boolean {
  return (
    (filters.platforms?.length ?? 0) > 0 ||
    (filters.campaignIds?.length ?? 0) > 0 ||
    filters.dateRange !== undefined
  );
}

/**
 * Returns a new config with `filters` normalized, or with the `filters` key
 * removed entirely when nothing is selected. Never persists empty arrays.
 */
export function writeWidgetFilters(
  config: Record<string, unknown>,
  filters: WidgetFilters
): Record<string, unknown> {
  const normalized = readWidgetFilters({ filters });
  const next: Record<string, unknown> = { ...config };
  delete next.filters;
  if (!hasWidgetFilters(normalized)) return next;
  next.filters = normalized;
  return next;
}

/**
 * Concrete dates for a widget's pinned range: a preset is resolved against
 * `today` on every call (so "Last 30 days" keeps rolling), a fixed range is
 * returned as-is. Null when the widget has no override — callers fall back to
 * the page's date range.
 */
export function resolveWidgetDateRange(
  dateRange: WidgetDateRange | undefined,
  today: Date = new Date()
): { start: string; end: string } | null {
  if (!dateRange) return null;
  if ("preset" in dateRange) {
    const preset = findPreset(dateRange.preset);
    return preset ? preset.getRange(today) : null;
  }
  return { start: dateRange.start, end: dateRange.end };
}

/** "Last 30 days" for a preset, "May 1 – May 31" for a fixed range. */
export function describeWidgetDateRange(dateRange: WidgetDateRange): string {
  if ("preset" in dateRange) return findPreset(dateRange.preset)?.label ?? "";
  const start = parseISO(dateRange.start);
  const end = parseISO(dateRange.end);
  const pattern = start.getFullYear() === end.getFullYear() ? "MMM d" : "MMM d, yyyy";
  return `${format(start, pattern)} – ${format(end, pattern)}`;
}

/**
 * Short label like "Month to date · Meta, Google · 3 campaigns". The date
 * override comes first: a widget on a different range than the page is the
 * part a reader must not miss when the badge truncates.
 */
export function describeWidgetFilters(filters: WidgetFilters): string {
  const parts: string[] = [];
  if (filters.dateRange) {
    const label = describeWidgetDateRange(filters.dateRange);
    if (label) parts.push(label);
  }
  if (filters.platforms?.length) {
    parts.push(filters.platforms.map((p) => PLATFORM_LABELS[p]).join(", "));
  }
  const n = filters.campaignIds?.length ?? 0;
  if (n > 0) parts.push(`${n} ${n === 1 ? "campaign" : "campaigns"}`);
  return parts.join(" · ");
}
