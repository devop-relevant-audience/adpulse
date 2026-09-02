// Aggregation query behind the "custom" dashboard widget
// (/api/metrics?action=query). Groups campaign_performance facts by an
// optional group dimension (platform / campaign / ad account / campaign type)
// and an optional time bucket (day / week), sums the base counts in SQL and
// derives the ratio metrics in TypeScript from the summed bases (weighted,
// never averaged).

import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { adAccounts, campaignPerformance, campaigns } from "@/lib/db/schema";
import type { Platform } from "@/lib/types/database";
import { QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT } from "@/lib/dashboard/custom-widget";
import type {
  MetricQueryGroup,
  MetricQueryParams,
  MetricQueryResult,
  MetricQueryRow,
  MetricThreshold,
  QueryGroupBy,
  QueryMetric,
  QuerySortDir,
  QueryTimeBucket,
} from "@/lib/dashboard/custom-widget";

// Deliberately local: chart-theme.ts is client-oriented.
const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google",
  meta: "Meta",
  tiktok: "TikTok",
};

/**
 * Group key for a fact row the dimension cannot resolve: a demo/seeded row
 * (ad_account_id is NULL, so it joins to no account and no campaigns row) or a
 * campaign the dimension table has no objective/type for. Grouping these under
 * one labelled bucket keeps the chart populated and says why, instead of
 * dropping the rows or drawing an unexplained blank.
 */
const UNRESOLVED_GROUP = "__none__";

/**
 * The same sentinel inlined as a SQL literal. It must NOT be a bind parameter:
 * Postgres matches a GROUP BY expression to the select-list one textually, and
 * the two renders of the fragment would carry different placeholders ($1 vs
 * $8) — "column must appear in the GROUP BY clause". Safe to inline: a
 * hardcoded constant, never user input.
 */
const UNRESOLVED_LITERAL = sql.raw(`'${UNRESOLVED_GROUP}'`);

const TOTAL_GROUP: MetricQueryGroup = {
  group: "total",
  label: "Total",
  platform: null,
  campaign_id: null,
  campaign_name: null,
};

// One aggregated SQL bucket before ratios/labels are applied.
interface AggRow {
  group: string;
  name: string | null;
  platform: string | null;
  date: string | Date | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number | null;
}

function round(n: number, dp: number): number {
  return Number(n.toFixed(dp));
}

function toDateString(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * The SQL the group key is read from. Shared by the aggregate and by the
 * top-N follow-up's `IN (...)` filter, so both always agree on the key.
 */
function groupExpression(groupBy: QueryGroupBy): SQL<string> | null {
  switch (groupBy) {
    case "platform":
      return sql<string>`${campaignPerformance.platform}`;
    case "campaign":
      return sql<string>`${campaignPerformance.campaignId}`;
    case "adAccount":
      return sql<string>`coalesce(${campaignPerformance.adAccountId}::text, ${UNRESOLVED_LITERAL})`;
    // Meta fills `objective` and Google fills `campaign_type` (src/lib/windsor:
    // meta.ts sets campaignType null, google.ts sets objective null), so the
    // two never collide and coalescing them is one dimension, not a merge that
    // has to pick a winner.
    case "campaignType":
      return sql<string>`coalesce(${campaigns.objective}, ${campaigns.campaignType}, ${UNRESOLVED_LITERAL})`;
    default:
      return null;
  }
}

function baseConditions(params: MetricQueryParams): SQL {
  const conditions: SQL[] = [
    eq(campaignPerformance.clientId, params.clientId),
    gte(campaignPerformance.date, params.startDate),
    lte(campaignPerformance.date, params.endDate),
  ];
  if (params.platforms?.length) {
    conditions.push(inArray(campaignPerformance.platform, params.platforms));
  }
  if (params.campaignIds?.length) {
    conditions.push(inArray(campaignPerformance.campaignId, params.campaignIds));
  }
  return and(...conditions)!;
}

/**
 * One aggregate query. `groupBy` / `timeBucket` decide which dimension
 * expressions are selected and grouped on; the sums are always the same.
 */
async function aggregate(opts: {
  where: SQL;
  groupBy: QueryGroupBy;
  timeBucket: QueryTimeBucket;
}): Promise<AggRow[]> {
  const groupExpr = groupExpression(opts.groupBy);

  // Explicit ::timestamp keeps date_trunc off the timestamptz overload, so the
  // session time zone can never shift the bucket. Week buckets start Monday.
  const timeExpr: SQL<string> | null =
    opts.timeBucket === "day"
      ? sql<string>`${campaignPerformance.date}`
      : opts.timeBucket === "week"
        ? sql<string>`date_trunc('week', ${campaignPerformance.date}::timestamp)::date`
        : null;

  const groupExprs = [groupExpr, timeExpr].filter((e): e is SQL<string> => e !== null);

  const nullableNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  let query = db
    .select({
      group: groupExpr ?? sql<string>`'total'::text`,
      // One campaign lives on one platform and one ad account is one platform,
      // so max(name)/min(platform) are exact for both. A campaign type spans
      // whatever campaigns carry it, so it claims no name and no platform.
      name:
        opts.groupBy === "campaign"
          ? sql<string | null>`max(${campaignPerformance.campaignName})`
          : opts.groupBy === "adAccount"
            ? sql<string | null>`max(${adAccounts.accountName})`
            : sql<string | null>`null::text`,
      platform:
        opts.groupBy === "campaign" || opts.groupBy === "adAccount"
          ? sql<string | null>`min(${campaignPerformance.platform})`
          : sql<string | null>`null::text`,
      date: timeExpr ?? sql<string | null>`null::date`,
      impressions: sql<number>`coalesce(sum(${campaignPerformance.impressions}), 0)`.mapWith(Number),
      clicks: sql<number>`coalesce(sum(${campaignPerformance.clicks}), 0)`.mapWith(Number),
      spend: sql<number>`coalesce(sum(${campaignPerformance.spend}), 0)`.mapWith(Number),
      conversions: sql<number>`coalesce(sum(${campaignPerformance.conversions}), 0)`.mapWith(Number),
      // Stays NULL when every row's revenue is NULL (value tracking not configured).
      revenue: sql<number | null>`sum(${campaignPerformance.revenue})`.mapWith(nullableNumber),
    })
    .from(campaignPerformance)
    .$dynamic();

  // LEFT so a fact row the dimension has no match for (demo rows carry no
  // ad_account_id) still reaches the UNRESOLVED_GROUP bucket instead of
  // vanishing from the totals.
  if (opts.groupBy === "adAccount") {
    query = query.leftJoin(adAccounts, eq(adAccounts.id, campaignPerformance.adAccountId));
  } else if (opts.groupBy === "campaignType") {
    query = query.leftJoin(
      campaigns,
      and(
        eq(campaigns.adAccountId, campaignPerformance.adAccountId),
        eq(campaigns.campaignId, campaignPerformance.campaignId)
      )
    );
  }

  query = query.where(opts.where);

  if (groupExprs.length > 0) {
    query = query.groupBy(...groupExprs);
  }
  if (timeExpr) {
    query = query.orderBy(asc(timeExpr));
  }

  return query;
}

/**
 * Platform enums arrive SHOUTING ("PERFORMANCE_MAX", "OUTCOME_SALES"). Only
 * an all-caps value is rewritten, so a platform that already ships readable
 * casing keeps it verbatim.
 */
function humanizeCampaignType(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function toRow(agg: AggRow, groupBy: QueryGroupBy): MetricQueryRow {
  const { impressions, clicks, spend, conversions, revenue } = agg;
  const date = toDateString(agg.date);

  let group = "total";
  let label = "Total";
  let platform: Platform | null = null;
  let campaign_id: string | null = null;
  let campaign_name: string | null = null;

  if (groupBy === "platform") {
    group = agg.group;
    platform = agg.group as Platform;
    label = PLATFORM_LABELS[platform] ?? agg.group;
  } else if (groupBy === "campaign") {
    group = agg.group;
    platform = (agg.platform as Platform | null) ?? null;
    campaign_id = agg.group;
    campaign_name = agg.name ?? agg.group;
    label = campaign_name;
  } else if (groupBy === "adAccount") {
    group = agg.group;
    platform = (agg.platform as Platform | null) ?? null;
    label =
      group === UNRESOLVED_GROUP
        ? "No ad account"
        : // The FK makes a missing account row impossible today, but a uuid is
          // never a label a reader can act on, so it is not one of the options.
          (agg.name ?? "Unnamed account");
  } else if (groupBy === "campaignType") {
    group = agg.group;
    label = group === UNRESOLVED_GROUP ? "No type set" : humanizeCampaignType(group);
  }

  return {
    key: date ? `${group}|${date}` : group,
    group,
    label,
    platform,
    campaign_id,
    campaign_name,
    date,
    spend: round(spend, 2),
    impressions,
    clicks,
    conversions: round(conversions, 4),
    revenue: revenue === null ? null : round(revenue, 2),
    // The ONLY definition of the five derived metrics. `passesThreshold` reads
    // them off the row this builds rather than recomputing them, so a change
    // here changes filtering, ranking and display together.
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
    cpc: clicks > 0 ? round(spend / clicks, 4) : 0,
    cpm: impressions > 0 ? round((spend / impressions) * 1000, 4) : 0,
    cpa: conversions > 0 ? round(spend / conversions, 2) : 0,
    roas: revenue === null ? null : spend > 0 ? round(revenue / spend, 2) : 0,
  };
}

/**
 * Group-level predicate for `params.threshold`. It reads the metric off a row
 * that `toRow` has already built, which is the whole point: CTR/CPC/CPM/CPA/
 * ROAS are not columns, and this must not become a second place that knows how
 * they are derived. Keeping it here also keeps it BEFORE the top-N cut below —
 * a HAVING clause could do the same job only by re-spelling those five ratios
 * in SQL, and the two definitions would drift.
 *
 * A null metric (revenue/ROAS without value tracking) passes no test: "ROAS
 * under 2" must not sweep in every group whose ROAS is unknown. A ratio with a
 * zero denominator is 0, not null, by `toRow`'s convention, so "CPA under 50"
 * does keep a group with no conversions — the same 0 the chart itself shows.
 */
function passesThreshold(threshold: MetricThreshold | undefined) {
  return (row: MetricQueryRow): boolean => {
    if (!threshold) return true;
    const value = row[threshold.metric];
    if (value === null) return false;
    return threshold.op === "gt" ? value > threshold.value : value < threshold.value;
  };
}

function toGroup(row: MetricQueryRow): MetricQueryGroup {
  return {
    group: row.group,
    label: row.label,
    platform: row.platform,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
  };
}

/** Sort by one metric; null values (revenue/roas without tracking) always last. */
function compareByMetric(sortBy: QueryMetric, sortDir: QuerySortDir) {
  return (a: MetricQueryRow, b: MetricQueryRow): number => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av === null && bv === null) return a.group.localeCompare(b.group);
    if (av === null) return 1;
    if (bv === null) return -1;
    const diff = sortDir === "asc" ? av - bv : bv - av;
    return diff !== 0 ? diff : a.group.localeCompare(b.group);
  };
}

export async function runMetricQuery(params: MetricQueryParams): Promise<MetricQueryResult> {
  const { groupBy, timeBucket } = params;
  const limit = Math.max(1, Math.min(params.limit ?? QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT));
  const sortBy: QueryMetric = params.sortBy ?? "spend";
  const sortDir: QuerySortDir = params.sortDir ?? "desc";
  const resolved = { groupBy, timeBucket, limit, sortBy, sortDir };

  const where = baseConditions(params);

  if (groupBy === "none") {
    const agg = await aggregate({ where, groupBy, timeBucket });
    const rows = agg.map((r) => toRow(r, groupBy));
    if (timeBucket !== "none") {
      rows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    }
    return { groups: [TOTAL_GROUP], rows, params: resolved };
  }

  // Top-N: rank groups on whole-range totals first, so the bucketed series
  // below is restricted to exactly those groups in the same order.
  const totals = await aggregate({ where, groupBy, timeBucket: "none" });
  const ranked = totals
    .map((r) => toRow(r, groupBy))
    // Filter first: "top 10 campaigns with CPA over 50" means the ten biggest
    // that qualify, not the qualifiers among the ten biggest.
    .filter(passesThreshold(params.threshold))
    .sort(compareByMetric(sortBy, sortDir))
    .slice(0, limit);
  const groups = ranked.map(toGroup);

  if (timeBucket === "none" || groups.length === 0) {
    return { groups, rows: timeBucket === "none" ? ranked : [], params: resolved };
  }

  const keys = groups.map((g) => g.group);
  // Filtering on the same expression the key came from, not on a column, is
  // what lets the derived dimensions restrict to their top-N the way a plain
  // column does — including the UNRESOLVED_GROUP bucket.
  const groupExpr = groupExpression(groupBy)!;
  const bucketed = await aggregate({
    where: and(where, inArray(groupExpr, keys))!,
    groupBy,
    timeBucket,
  });

  const rank = new Map(keys.map((k, i) => [k, i]));
  const rows = bucketed
    .map((r) => toRow(r, groupBy))
    .sort((a, b) => {
      const byGroup = (rank.get(a.group) ?? 0) - (rank.get(b.group) ?? 0);
      return byGroup !== 0 ? byGroup : (a.date ?? "").localeCompare(b.date ?? "");
    });

  return { groups, rows, params: resolved };
}
