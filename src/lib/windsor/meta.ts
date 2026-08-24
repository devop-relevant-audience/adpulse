// Meta (facebook connector) semantics: field list, event extraction from the
// nested actions/conversions arrays, the default conversion-mapping heuristic,
// and the raw→fact normalization. Pure functions of the raw payload + mapping
// config — re-runnable without a re-pull (docs/schema-v2-assessment.md §4).

import type { ConversionMappingRow } from "@/lib/types/database";
import type { WindsorRow } from "./client";

// Bump when normalization logic changes semantics; stamped on every fact row so
// stale rows are identifiable and re-normalization is auditable.
export const META_TRANSFORM_VERSION = 1;

// Probed against the live connector 2026-07-13 (all confirmed valid):
// - ctr/cpc/cpm exist but are platform-reported ratios — deliberately NOT pulled;
//   we recompute from base counts.
// - `conversions`/`conversion_values` = the account's configured conversion
//   events; `actions`/`action_values` = the full engagement/event array
//   (purchase family often lives here even when not configured as a conversion).
export const META_FIELDS = [
  "date",
  "account_id",
  "account_name",
  "currency",
  "campaign_id",
  "campaign",
  "campaign_status",
  "objective",
  "impressions",
  "clicks",
  "link_clicks",
  "spend",
  "conversions",
  "conversion_values",
  "actions",
  "action_values",
] as const;

// One entry of Meta's actions[]-shaped arrays: value = the account's active
// attribution setting; window keys (1d_view, 7d_click, …) are fixed-window
// re-readings of the same conversions.
interface ActionEntry {
  action_type: string;
  value?: string;
  [window: string]: string | undefined;
}

function entries(payload: WindsorRow, field: string): ActionEntry[] {
  const value = payload[field];
  return Array.isArray(value) ? (value as ActionEntry[]) : [];
}

function readEntry(entry: ActionEntry | undefined, window: string): number {
  if (!entry) return 0;
  const raw = window === "value" ? entry.value : entry[window];
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Count for an event key, checking configured conversions first, then the full actions array. */
export function readEventCount(payload: WindsorRow, eventKey: string, window: string): number {
  const fromConversions = entries(payload, "conversions").find((e) => e.action_type === eventKey);
  if (fromConversions) return readEntry(fromConversions, window);
  return readEntry(
    entries(payload, "actions").find((e) => e.action_type === eventKey),
    window
  );
}

/** Monetary value for an event key, from conversion_values then action_values. */
export function readEventValue(payload: WindsorRow, eventKey: string): number {
  const fromConversionValues = entries(payload, "conversion_values").find(
    (e) => e.action_type === eventKey
  );
  if (fromConversionValues) return readEntry(fromConversionValues, "value");
  return readEntry(
    entries(payload, "action_values").find((e) => e.action_type === eventKey),
    "value"
  );
}

// omni_purchase is Meta's canonical deduplicated purchase event (the plain
// "purchase"/pixel variants report the same totals in different namespaces).
const PURCHASE_KEY = "omni_purchase";
const PURCHASE_FAMILY = new Set([
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

export interface DefaultMapping {
  target: "conversions" | "revenue";
  eventKey: string;
  attributionWindow: string;
}

/**
 * Seed mappings for an account we have no config for yet, from its observed
 * events. Heuristic (confirmed with the agency): purchase family first (real
 * completed-sale counts + value, even when the account's configured conversion
 * is an upper-funnel custom event); otherwise the account's highest-volume
 * configured conversion event (revenue only if that event carries values);
 * otherwise nothing (conversions stay 0, revenue stays NULL = not tracked).
 */
export function deriveDefaultMappings(payloads: WindsorRow[]): DefaultMapping[] {
  let purchaseSeen = false;
  const configuredCounts = new Map<string, number>();
  const valueKeys = new Set<string>();

  for (const payload of payloads) {
    for (const e of entries(payload, "actions")) {
      if (PURCHASE_FAMILY.has(e.action_type)) purchaseSeen = true;
    }
    for (const e of entries(payload, "action_values")) {
      if (PURCHASE_FAMILY.has(e.action_type)) purchaseSeen = true;
    }
    for (const e of entries(payload, "conversions")) {
      configuredCounts.set(
        e.action_type,
        (configuredCounts.get(e.action_type) ?? 0) + readEntry(e, "value")
      );
    }
    for (const e of entries(payload, "conversion_values")) {
      valueKeys.add(e.action_type);
    }
  }

  if (purchaseSeen) {
    return [
      { target: "conversions", eventKey: PURCHASE_KEY, attributionWindow: "value" },
      { target: "revenue", eventKey: PURCHASE_KEY, attributionWindow: "value" },
    ];
  }

  const top = [...configuredCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return [];

  const mappings: DefaultMapping[] = [
    { target: "conversions", eventKey: top[0], attributionWindow: "value" },
  ];
  if (valueKeys.has(top[0])) {
    mappings.push({ target: "revenue", eventKey: top[0], attributionWindow: "value" });
  }
  return mappings;
}

export interface NormalizedMetaFact {
  campaignId: string;
  campaignName: string;
  date: string;
  impressions: number;
  clicks: number;
  linkClicks: number | null;
  spend: number;
  conversions: number;
  /** null = no revenue mapping configured for the account (not tracked). */
  revenue: number | null;
  currency: string | null;
  campaignStatus: string | null;
  objective: string | null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalize one raw Windsor Meta payload using the account's mapping config. */
export function normalizeMetaPayload(
  payload: WindsorRow,
  mappings: Pick<ConversionMappingRow, "target" | "event_key" | "attribution_window" | "enabled">[]
): NormalizedMetaFact {
  const enabled = mappings.filter((m) => m.enabled);
  const conversionRules = enabled.filter((m) => m.target === "conversions");
  const revenueRules = enabled.filter((m) => m.target === "revenue");

  const conversions = conversionRules.reduce(
    (sum, m) => sum + readEventCount(payload, m.event_key, m.attribution_window),
    0
  );
  const revenue =
    revenueRules.length === 0
      ? null
      : revenueRules.reduce((sum, m) => sum + readEventValue(payload, m.event_key), 0);

  return {
    campaignId: String(payload.campaign_id ?? ""),
    campaignName: str(payload.campaign) ?? String(payload.campaign_id ?? ""),
    date: String(payload.date ?? ""),
    impressions: num(payload.impressions),
    clicks: num(payload.clicks),
    linkClicks: payload.link_clicks == null ? null : num(payload.link_clicks),
    spend: Number(num(payload.spend).toFixed(2)),
    conversions: Number(conversions.toFixed(4)),
    revenue: revenue == null ? null : Number(revenue.toFixed(2)),
    currency: str(payload.currency),
    campaignStatus: str(payload.campaign_status),
    objective: str(payload.objective),
  };
}
