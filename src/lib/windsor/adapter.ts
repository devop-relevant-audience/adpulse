// Shared contract for the Windsor ingestion pipeline. `sync.ts` is platform
// agnostic and drives everything through a PlatformAdapter: the connector +
// field list to pull, how to read account identity off a row, how to seed
// default conversion mappings, and how to normalize one raw payload into a
// campaign_performance fact. Per-platform semantics live in meta.ts / google.ts.

import type { ConversionMappingRow } from "@/lib/types/database";
import type { WindsorConnector, WindsorRow } from "./client";
// meta.ts / google.ts import only types from this module, so there is no
// runtime import cycle.
import { googleAdapter } from "./google";
import { metaAdapter } from "./meta";

/** Value stored in `ad_accounts.platform` / `campaign_performance.platform`. */
export type SyncPlatform = "meta" | "google";

export interface DefaultMapping {
  target: "conversions" | "revenue";
  eventKey: string;
  attributionWindow: string;
}

/** The subset of a conversion_mappings row normalization needs. */
export type MappingRule = Pick<
  ConversionMappingRow,
  "target" | "event_key" | "attribution_window" | "enabled"
>;

/** One normalized fact row, platform independent. */
export interface NormalizedFact {
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
  campaignType: string | null;
}

export interface AccountIdentity {
  externalId: string;
  name: string;
  currency: string;
  timezone: string | null;
}

export interface PlatformAdapter {
  platform: SyncPlatform;
  connector: WindsorConnector;
  fields: readonly string[];
  transformVersion: number;
  /** Rolling re-pull window once the landing layer has rows for this platform. */
  incrementalDays: number;
  /** Window for the first run (no landed rows yet). */
  backfillDays: number;
  /** null when the row lacks the natural key (account_id / campaign_id / date). */
  readAccount(row: WindsorRow): AccountIdentity | null;
  deriveDefaultMappings(rows: WindsorRow[]): DefaultMapping[];
  normalize(payload: WindsorRow, mappings: MappingRule[]): NormalizedFact;
}

const ADAPTERS: Record<SyncPlatform, PlatformAdapter> = {
  meta: metaAdapter,
  google: googleAdapter,
};

export function getAdapter(platform: SyncPlatform): PlatformAdapter {
  return ADAPTERS[platform];
}
