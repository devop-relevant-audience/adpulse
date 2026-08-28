// Aggregation query behind the "custom" dashboard widget
// (/api/metrics?action=query). Groups campaign_performance facts by an
// optional group dimension (platform / campaign) and an optional time bucket
// (day / week), sums the base counts in SQL and derives the ratio metrics in
// TypeScript from the summed bases (weighted, never averaged).

import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignPerformance } from "@/lib/db/schema";
import type { Platform } from "@/lib/types/database";
import { QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT } from "@/lib/dashboard/custom-widget";
import type {
  MetricQueryGroup,
  MetricQueryParams,
  MetricQueryResult,
  MetricQueryRow,
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
  const groupExpr: SQL<string> | null =
    opts.groupBy === "platform"
      ? sql<string>`${campaignPerformance.platform}`
      : opts.groupBy === "campaign"
        ? sql<string>`${campaignPerformance.campaignId}`
        : null;

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
      // One campaign lives on one platform, so max(name)/min(platform) are exact.
      name:
        opts.groupBy === "campaign"
          ? sql<string | null>`max(${campaignPerformance.campaignName})`
          : sql<string | null>`null::text`,
      platform:
        opts.groupBy === "campaign"
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
    .where(opts.where)
    .$dynamic();

  if (groupExprs.length > 0) {
    query = query.groupBy(...groupExprs);
  }
  if (timeExpr) {
    query = query.orderBy(asc(timeExpr));
  }

  return query;
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
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
    cpc: clicks > 0 ? round(spend / clicks, 4) : 0,
    cpm: impressions > 0 ? round((spend / impressions) * 1000, 4) : 0,
    cpa: conversions > 0 ? round(spend / conversions, 2) : 0,
    roas: revenue === null ? null : spend > 0 ? round(revenue / spend, 2) : 0,
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
    .sort(compareByMetric(sortBy, sortDir))
    .slice(0, limit);
  const groups = ranked.map(toGroup);

  if (timeBucket === "none" || groups.length === 0) {
    return { groups, rows: timeBucket === "none" ? ranked : [], params: resolved };
  }

  const keys = groups.map((g) => g.group);
  const groupColumn = groupBy === "platform" ? campaignPerformance.platform : campaignPerformance.campaignId;
  const bucketed = await aggregate({
    where: and(where, inArray(groupColumn, keys))!,
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
