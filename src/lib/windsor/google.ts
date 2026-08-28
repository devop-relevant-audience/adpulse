// Google Ads (google_ads connector) semantics: field list, the default
// conversion-mapping heuristic, and the raw→fact normalization. Pure functions
// of the raw payload + mapping config — re-runnable without a re-pull
// (docs/schema-v2-assessment.md §4).
//
// Unlike Meta, Google's metrics are flat top-level numbers, so a mapping's
// `event_key` is simply the Windsor field name to read off the payload.
//
// Primary vs all conversions: Windsor's `conversions` /`conversions_value` count
// only the conversion actions marked "primary" in the account, while
// `all_conversions` / `all_conversions_value` count every tracked action and run
// ~100x larger. Per the agency decision we default to the primary figures; the
// `all_*` fields are still pulled so the landing layer can be re-mapped onto
// them later without a re-pull.

import type {
  AccountIdentity,
  DefaultMapping,
  MappingRule,
  NormalizedFact,
  PlatformAdapter,
} from "./adapter";
import type { WindsorRow } from "./client";

// Bump when normalization logic changes semantics; stamped on every fact row so
// stale rows are identifiable and re-normalization is auditable.
export const GOOGLE_TRANSFORM_VERSION = 1;

// Verified against the live connector 2026-08-28. There is no objective field
// and no link_clicks; `advertising_channel_type` (SEARCH, PERFORMANCE_MAX, …)
// is the campaign-type dimension.
export const GOOGLE_FIELDS = [
  "date",
  "account_id",
  "account_name",
  "currency",
  "account_time_zone",
  "campaign_id",
  "campaign",
  "campaign_status",
  "advertising_channel_type",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "conversions_value",
  "all_conversions",
  "all_conversions_value",
] as const;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Seed mappings for an account we have no config for yet. Google always reports
 * primary `conversions`, so that mapping is unconditional; revenue is only
 * mapped when the account actually reports conversion value in the window
 * (otherwise revenue stays NULL = value tracking not configured).
 */
export function deriveDefaultMappings(payloads: WindsorRow[]): DefaultMapping[] {
  const mappings: DefaultMapping[] = [
    { target: "conversions", eventKey: "conversions", attributionWindow: "value" },
  ];

  const totalValue = payloads.reduce((sum, p) => sum + num(p.conversions_value), 0);
  if (totalValue > 0) {
    mappings.push({ target: "revenue", eventKey: "conversions_value", attributionWindow: "value" });
  }
  return mappings;
}

/** Normalize one raw Windsor Google Ads payload using the account's mapping config. */
export function normalizeGooglePayload(
  payload: WindsorRow,
  mappings: MappingRule[]
): NormalizedFact {
  const enabled = mappings.filter((m) => m.enabled);
  const conversionRules = enabled.filter((m) => m.target === "conversions");
  const revenueRules = enabled.filter((m) => m.target === "revenue");

  const conversions = conversionRules.reduce((sum, m) => sum + num(payload[m.event_key]), 0);
  const revenue =
    revenueRules.length === 0
      ? null
      : revenueRules.reduce((sum, m) => sum + num(payload[m.event_key]), 0);

  return {
    campaignId: String(payload.campaign_id ?? ""),
    campaignName: str(payload.campaign) ?? String(payload.campaign_id ?? ""),
    date: String(payload.date ?? ""),
    impressions: num(payload.impressions),
    clicks: num(payload.clicks),
    // Google has no link-clicks equivalent.
    linkClicks: null,
    spend: Number(num(payload.spend).toFixed(2)),
    conversions: Number(conversions.toFixed(4)),
    revenue: revenue == null ? null : Number(revenue.toFixed(2)),
    currency: str(payload.currency),
    campaignStatus: str(payload.campaign_status),
    // Google has no objective; advertising_channel_type is the campaign type.
    objective: null,
    campaignType: str(payload.advertising_channel_type),
  };
}

/** Reads the account identity off a Google row (note: `account_time_zone`). */
function readGoogleAccount(row: WindsorRow): AccountIdentity | null {
  const externalId = String(row.account_id ?? "");
  if (!externalId || !row.campaign_id || !row.date) return null;
  return {
    externalId,
    name: String(row.account_name ?? externalId),
    currency: String(row.currency ?? "USD"),
    timezone: str(row.account_time_zone),
  };
}

export const googleAdapter: PlatformAdapter = {
  platform: "google",
  connector: "google_ads",
  fields: GOOGLE_FIELDS,
  transformVersion: GOOGLE_TRANSFORM_VERSION,
  // Google restates conversions for ~30 days (conversion lag), so an
  // incremental run re-pulls the trailing 30; a first run backfills 90.
  incrementalDays: 30,
  backfillDays: 90,
  readAccount: readGoogleAccount,
  deriveDefaultMappings,
  normalize: normalizeGooglePayload,
};
