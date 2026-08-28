// Pure helpers for the per-widget filter stored at `config.filters`.
// No React here — shared by the widget frame (badge), the config form (write)
// and the `useWidgetScope` hook (read).

import { PLATFORMS } from "@/lib/types/database";
import type { Platform } from "@/lib/types/database";
import type { WidgetFilters } from "@/lib/dashboard/types";

const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google",
  meta: "Meta",
  tiktok: "TikTok",
};

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
 * Defensive parse of `config.filters`. Anything that is not a string array is
 * ignored; platforms are validated against the known set. Keys are only
 * present when they hold at least one value.
 */
export function readWidgetFilters(config: Record<string, unknown>): WidgetFilters {
  const raw = config.filters;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;

  const platforms = stringList(r.platforms).filter(isPlatform);
  const campaignIds = stringList(r.campaignIds);

  const out: WidgetFilters = {};
  if (platforms.length > 0) out.platforms = platforms;
  if (campaignIds.length > 0) out.campaignIds = campaignIds;
  return out;
}

export function hasWidgetFilters(filters: WidgetFilters): boolean {
  return (filters.platforms?.length ?? 0) > 0 || (filters.campaignIds?.length ?? 0) > 0;
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

/** Short label like "Meta, Google · 3 campaigns", "TikTok", "1 campaign". Empty when none. */
export function describeWidgetFilters(filters: WidgetFilters): string {
  const parts: string[] = [];
  if (filters.platforms?.length) {
    parts.push(filters.platforms.map((p) => PLATFORM_LABELS[p]).join(", "));
  }
  const n = filters.campaignIds?.length ?? 0;
  if (n > 0) parts.push(`${n} ${n === 1 ? "campaign" : "campaigns"}`);
  return parts.join(" · ");
}
