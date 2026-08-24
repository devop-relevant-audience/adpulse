// Meta sync pipeline: Windsor pull → land raw_windsor_rows → normalize (pure
// function of the landing layer + conversion_mappings) → upsert
// campaign_performance + campaigns dimension. Restatement-safe: every run
// re-pulls a rolling window and upserts on the natural keys.

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adAccounts,
  campaignPerformance,
  campaigns,
  clients,
  conversionMappings,
  rawWindsorRows,
} from "@/lib/db/schema";
import { fetchWindsorRows, type WindsorRow } from "./client";
import {
  META_FIELDS,
  META_TRANSFORM_VERSION,
  deriveDefaultMappings,
  normalizeMetaPayload,
} from "./meta";

// Meta restates conversions for up to ~28 days (attribution windows), so an
// incremental run re-pulls the trailing 28; a first run backfills 90.
const INCREMENTAL_DAYS = 28;
const BACKFILL_DAYS = 90;
const BATCH_SIZE = 500;

export interface SyncSummary {
  connector: "facebook";
  dateFrom: string;
  dateTo: string;
  accountsSeen: number;
  accountsCreated: string[];
  mappingsSeeded: Array<{ account: string; target: string; eventKey: string }>;
  rawRowsUpserted: number;
  factsUpserted: number;
  campaignsUpserted: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function syncMeta(params: { days?: number } = {}): Promise<SyncSummary> {
  // 1. Window: explicit > incremental (have raw rows) > first-run backfill.
  let days = params.days;
  if (!days) {
    const existing = await db
      .select({ id: rawWindsorRows.id })
      .from(rawWindsorRows)
      .where(eq(rawWindsorRows.platform, "meta"))
      .limit(1);
    days = existing.length > 0 ? INCREMENTAL_DAYS : BACKFILL_DAYS;
  }
  const now = new Date();
  const dateTo = isoDate(now);
  const dateFrom = isoDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));

  // 2. Pull. One request covers every connected account (rows carry account_id).
  const rows = await fetchWindsorRows({ connector: "facebook", fields: META_FIELDS, dateFrom, dateTo });

  const byAccount = new Map<string, { name: string; currency: string; rows: WindsorRow[] }>();
  for (const row of rows) {
    const externalId = String(row.account_id ?? "");
    if (!externalId || !row.campaign_id || !row.date) continue;
    const acc = byAccount.get(externalId) ?? {
      name: String(row.account_name ?? externalId),
      currency: String(row.currency ?? "USD"),
      rows: [],
    };
    acc.rows.push(row);
    byAccount.set(externalId, acc);
  }

  // 3. Ensure ad_accounts (+ a real client per new account — 1 account = 1
  //    client for the pilot; rename/remap in the DB is safe at any time).
  const accountsCreated: string[] = [];
  const accountIdByExternal = new Map<string, string>();
  const clientIdByAccountId = new Map<string, string>();

  const existingAccounts = await db
    .select({
      id: adAccounts.id,
      externalAccountId: adAccounts.externalAccountId,
      clientId: adAccounts.clientId,
    })
    .from(adAccounts)
    .where(eq(adAccounts.platform, "meta"));
  for (const acc of existingAccounts) {
    accountIdByExternal.set(acc.externalAccountId, acc.id);
    clientIdByAccountId.set(acc.id, acc.clientId);
  }

  for (const [externalId, acc] of byAccount) {
    if (accountIdByExternal.has(externalId)) continue;
    const [client] = await db
      .insert(clients)
      .values({ name: acc.name, industry: "Unassigned", isDemo: false })
      .returning({ id: clients.id });
    const [account] = await db
      .insert(adAccounts)
      .values({
        clientId: client.id,
        platform: "meta",
        externalAccountId: externalId,
        accountName: acc.name,
        currency: acc.currency,
      })
      .returning({ id: adAccounts.id });
    accountIdByExternal.set(externalId, account.id);
    clientIdByAccountId.set(account.id, client.id);
    accountsCreated.push(acc.name);
  }

  // 4. Seed default conversion mappings for accounts that have none yet.
  const mappingsSeeded: SyncSummary["mappingsSeeded"] = [];
  const accountIds = [...accountIdByExternal.values()];
  const existingMappings = accountIds.length
    ? await db
        .select()
        .from(conversionMappings)
        .where(inArray(conversionMappings.adAccountId, accountIds))
    : [];
  const mappingsByAccount = new Map<string, typeof existingMappings>();
  for (const m of existingMappings) {
    const list = mappingsByAccount.get(m.adAccountId) ?? [];
    list.push(m);
    mappingsByAccount.set(m.adAccountId, list);
  }

  for (const [externalId, acc] of byAccount) {
    const accountId = accountIdByExternal.get(externalId)!;
    if ((mappingsByAccount.get(accountId) ?? []).length > 0) continue;
    const defaults = deriveDefaultMappings(acc.rows);
    if (defaults.length === 0) continue;
    const inserted = await db
      .insert(conversionMappings)
      .values(
        defaults.map((d) => ({
          adAccountId: accountId,
          target: d.target,
          eventKey: d.eventKey,
          attributionWindow: d.attributionWindow,
        }))
      )
      .onConflictDoNothing()
      .returning();
    mappingsByAccount.set(accountId, inserted);
    for (const d of defaults) {
      mappingsSeeded.push({ account: acc.name, target: d.target, eventKey: d.eventKey });
    }
  }

  // 5. Land raw (upsert-latest on the natural key).
  let rawRowsUpserted = 0;
  for (const [externalId, acc] of byAccount) {
    const accountId = accountIdByExternal.get(externalId)!;
    const values = acc.rows.map((row) => ({
      adAccountId: accountId,
      platform: "meta",
      campaignId: String(row.campaign_id),
      date: String(row.date),
      payload: row as Record<string, unknown>,
    }));
    for (const batch of chunk(values, BATCH_SIZE)) {
      await db
        .insert(rawWindsorRows)
        .values(batch)
        .onConflictDoUpdate({
          target: [rawWindsorRows.adAccountId, rawWindsorRows.campaignId, rawWindsorRows.date],
          set: {
            payload: sql`excluded.payload`,
            pulledAt: sql`now()`,
          },
        });
      rawRowsUpserted += batch.length;
    }
  }

  // 6. Normalize FROM the landing layer (not the in-memory pull) so this step
  //    stays a pure, re-runnable function of raw + mappings.
  const landed = accountIds.length
    ? await db
        .select()
        .from(rawWindsorRows)
        .where(
          and(
            eq(rawWindsorRows.platform, "meta"),
            inArray(rawWindsorRows.adAccountId, accountIds),
            gte(rawWindsorRows.date, dateFrom),
            lte(rawWindsorRows.date, dateTo)
          )
        )
    : [];

  let factsUpserted = 0;
  const campaignMeta = new Map<
    string,
    { adAccountId: string; campaignId: string; name: string; status: string | null; objective: string | null; firstSeen: string; lastSeen: string }
  >();

  const factValues = landed.map((raw) => {
    const mappings = (mappingsByAccount.get(raw.adAccountId) ?? []).map((m) => ({
      target: m.target as "conversions" | "revenue",
      event_key: m.eventKey,
      attribution_window: m.attributionWindow,
      enabled: m.enabled,
    }));
    const fact = normalizeMetaPayload(raw.payload, mappings);

    const key = `${raw.adAccountId}:${fact.campaignId}`;
    const meta = campaignMeta.get(key);
    if (!meta || fact.date > meta.lastSeen) {
      campaignMeta.set(key, {
        adAccountId: raw.adAccountId,
        campaignId: fact.campaignId,
        name: fact.campaignName,
        status: fact.campaignStatus,
        objective: fact.objective,
        firstSeen: meta && meta.firstSeen < fact.date ? meta.firstSeen : fact.date,
        lastSeen: fact.date,
      });
    } else if (fact.date < meta.firstSeen) {
      meta.firstSeen = fact.date;
    }

    return {
      clientId: clientIdByAccountId.get(raw.adAccountId)!,
      adAccountId: raw.adAccountId,
      platform: "meta",
      campaignId: fact.campaignId,
      campaignName: fact.campaignName,
      date: fact.date,
      impressions: fact.impressions,
      clicks: fact.clicks,
      linkClicks: fact.linkClicks,
      spend: fact.spend,
      conversions: fact.conversions,
      revenue: fact.revenue,
      currency: fact.currency,
      transformVersion: META_TRANSFORM_VERSION,
      syncedAt: new Date().toISOString(),
    };
  });

  for (const batch of chunk(factValues, BATCH_SIZE)) {
    await db
      .insert(campaignPerformance)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          campaignPerformance.adAccountId,
          campaignPerformance.campaignId,
          campaignPerformance.date,
        ],
        targetWhere: sql`ad_account_id IS NOT NULL`,
        set: {
          campaignName: sql`excluded.campaign_name`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          linkClicks: sql`excluded.link_clicks`,
          spend: sql`excluded.spend`,
          conversions: sql`excluded.conversions`,
          revenue: sql`excluded.revenue`,
          currency: sql`excluded.currency`,
          transformVersion: sql`excluded.transform_version`,
          syncedAt: sql`now()`,
        },
      });
    factsUpserted += batch.length;
  }

  // 7. Campaign dimension (SCD-lite): latest name/status/objective, widen
  //    first_seen/last_seen.
  let campaignsUpserted = 0;
  const dimValues = [...campaignMeta.values()].map((c) => ({
    adAccountId: c.adAccountId,
    campaignId: c.campaignId,
    name: c.name,
    status: c.status,
    objective: c.objective,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
  }));
  for (const batch of chunk(dimValues, BATCH_SIZE)) {
    await db
      .insert(campaigns)
      .values(batch)
      .onConflictDoUpdate({
        target: [campaigns.adAccountId, campaigns.campaignId],
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          objective: sql`excluded.objective`,
          firstSeen: sql`least(${campaigns.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${campaigns.lastSeen}, excluded.last_seen)`,
          updatedAt: sql`now()`,
        },
      });
    campaignsUpserted += batch.length;
  }

  return {
    connector: "facebook",
    dateFrom,
    dateTo,
    accountsSeen: byAccount.size,
    accountsCreated,
    mappingsSeeded,
    rawRowsUpserted,
    factsUpserted,
    campaignsUpserted,
  };
}
