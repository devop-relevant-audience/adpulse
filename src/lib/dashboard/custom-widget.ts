// Contract for the "custom" dashboard widget and the aggregation query that
// feeds it. Pure TypeScript + zod, no React — shared by the server
// (src/lib/data/metric-query.ts, /api/metrics?action=query, dashboards PUT
// validation), the hook (useMetricQuery) and the widget/builder UI.

import { z } from "zod";
import { PLATFORMS } from "@/lib/types/database";
import type { Platform } from "@/lib/types/database";
import type { WidgetFilters } from "@/lib/dashboard/types";

// --- Query vocabulary ------------------------------------------------------

export const QUERY_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "ctr",
  "cpc",
  "cpm",
  "cpa",
  "roas",
] as const;
export type QueryMetric = (typeof QUERY_METRICS)[number];

export const QUERY_GROUP_BYS = ["none", "platform", "campaign"] as const;
export type QueryGroupBy = (typeof QUERY_GROUP_BYS)[number];

export const QUERY_TIME_BUCKETS = ["none", "day", "week"] as const;
export type QueryTimeBucket = (typeof QUERY_TIME_BUCKETS)[number];

export const QUERY_SORT_DIRS = ["asc", "desc"] as const;
export type QuerySortDir = (typeof QUERY_SORT_DIRS)[number];

/** Hard cap on top-N groups the server will return. */
export const QUERY_MAX_LIMIT = 50;
export const QUERY_DEFAULT_LIMIT = 10;

export type MetricFormat = "currency" | "number" | "percent" | "ratio";

export interface QueryMetricMeta {
  label: string;
  format: MetricFormat;
  /** Lower is better (CPA/CPC/CPM): a decrease is "good". */
  invert: boolean;
  /** Series color when several metrics are plotted together. */
  color: string;
  /** Depends on revenue tracking; null for clients without value tracking. */
  requiresRevenue: boolean;
}

export const QUERY_METRIC_META: Record<QueryMetric, QueryMetricMeta> = {
  spend: { label: "Spend", format: "currency", invert: false, color: "#0075de", requiresRevenue: false },
  impressions: { label: "Impressions", format: "number", invert: false, color: "#64748b", requiresRevenue: false },
  clicks: { label: "Clicks", format: "number", invert: false, color: "#06b6d4", requiresRevenue: false },
  conversions: { label: "Conversions", format: "number", invert: false, color: "#16a34a", requiresRevenue: false },
  revenue: { label: "Revenue", format: "currency", invert: false, color: "#0d9488", requiresRevenue: true },
  ctr: { label: "CTR", format: "percent", invert: false, color: "#8b5cf6", requiresRevenue: false },
  cpc: { label: "CPC", format: "currency", invert: true, color: "#ec4899", requiresRevenue: false },
  cpm: { label: "CPM", format: "currency", invert: true, color: "#f97316", requiresRevenue: false },
  cpa: { label: "CPA", format: "currency", invert: true, color: "#f59e0b", requiresRevenue: false },
  roas: { label: "ROAS", format: "ratio", invert: false, color: "#7c3aed", requiresRevenue: true },
};

export const GROUP_BY_LABELS: Record<QueryGroupBy, string> = {
  none: "None",
  platform: "Platform",
  campaign: "Campaign",
};

export const TIME_BUCKET_LABELS: Record<QueryTimeBucket, string> = {
  none: "None",
  day: "Day",
  week: "Week",
};

// --- Query request / response (server ↔ hook) ------------------------------

export interface MetricQueryParams {
  clientId: string;
  /** Inclusive ISO dates (yyyy-MM-dd). */
  startDate: string;
  endDate: string;
  groupBy: QueryGroupBy;
  timeBucket: QueryTimeBucket;
  /** Step-1 filters. Empty/absent = no restriction. */
  platforms?: Platform[];
  campaignIds?: string[];
  /**
   * Top-N groups, ranked by `sortBy` totals over the whole range. Ignored when
   * groupBy = none. Defaults: QUERY_DEFAULT_LIMIT / "spend" / "desc".
   */
  limit?: number;
  sortBy?: QueryMetric;
  sortDir?: QuerySortDir;
}

/** One aggregated bucket. Every metric is always present so the client picks. */
export interface MetricQueryRow {
  /**
   * Stable row key: group key when no time bucket ("meta", "g-camp-001",
   * "total"), "<group>|<date>" when bucketed by time.
   */
  key: string;
  /** Group key alone: platform id, campaign id, or "total". */
  group: string;
  /** Human label for the group: platform short label, campaign name, "Total". */
  label: string;
  platform: Platform | null;
  campaign_id: string | null;
  campaign_name: string | null;
  /** Bucket start date (yyyy-MM-dd) when timeBucket != none, else null. */
  date: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** null = no revenue tracked in this bucket. */
  revenue: number | null;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  /** null when revenue is null. */
  roas: number | null;
}

export interface MetricQueryGroup {
  group: string;
  label: string;
  platform: Platform | null;
  campaign_id: string | null;
  campaign_name: string | null;
}

export interface MetricQueryResult {
  /** Ordered groups after top-N ranking; a single "total" group when groupBy = none. */
  groups: MetricQueryGroup[];
  /** Sorted by group order, then date ascending. */
  rows: MetricQueryRow[];
  /** Echo of the resolved params (after defaults). */
  params: Required<Pick<MetricQueryParams, "groupBy" | "timeBucket" | "limit" | "sortBy" | "sortDir">>;
}

// --- Custom widget config --------------------------------------------------

export const CUSTOM_VISUALIZATIONS = ["number", "line", "bar", "table"] as const;
export type CustomVisualization = (typeof CUSTOM_VISUALIZATIONS)[number];

export const VISUALIZATION_LABELS: Record<CustomVisualization, string> = {
  number: "Number",
  line: "Line chart",
  bar: "Bar chart",
  table: "Table",
};

export interface CustomWidgetConfig {
  /** Optional user title; falls back to describeCustomWidget(). */
  title?: string;
  visualization: CustomVisualization;
  /** 1..N metrics, bounded by VISUALIZATION_RULES[visualization]. */
  metrics: QueryMetric[];
  groupBy: QueryGroupBy;
  timeBucket: QueryTimeBucket;
  /** Top-N groups when groupBy != none. */
  limit: number;
  sortBy: QueryMetric;
  sortDir: QuerySortDir;
  /** Step-1 filters (same shape as every other widget). */
  filters?: WidgetFilters;
}

export interface VisualizationRule {
  /** Max metrics when the chart is NOT split by a group dimension. */
  maxMetrics: number;
  /** Max metrics when groupBy != none (series = groups, so usually 1). */
  maxMetricsWhenGrouped: number;
  groupBy: readonly QueryGroupBy[];
  timeBucket: readonly QueryTimeBucket[];
}

export const VISUALIZATION_RULES: Record<CustomVisualization, VisualizationRule> = {
  // One headline total with period-over-period delta.
  number: { maxMetrics: 1, maxMetricsWhenGrouped: 1, groupBy: ["none"], timeBucket: ["none"] },
  // Time series. Ungrouped: one line per metric. Grouped: one line per group, single metric.
  line: { maxMetrics: 4, maxMetricsWhenGrouped: 1, groupBy: ["none", "platform", "campaign"], timeBucket: ["day", "week"] },
  // Categories = groups; up to two metrics (second on a right axis).
  bar: { maxMetrics: 2, maxMetricsWhenGrouped: 2, groupBy: ["platform", "campaign"], timeBucket: ["none"] },
  // Rows = groups and/or time buckets; columns = metrics.
  table: { maxMetrics: 6, maxMetricsWhenGrouped: 6, groupBy: ["none", "platform", "campaign"], timeBucket: ["none", "day", "week"] },
};

export const DEFAULT_CUSTOM_CONFIG: CustomWidgetConfig = {
  visualization: "bar",
  metrics: ["spend"],
  groupBy: "platform",
  timeBucket: "none",
  limit: QUERY_DEFAULT_LIMIT,
  sortBy: "spend",
  sortDir: "desc",
};

const platformSchema = z.enum(PLATFORMS);

export const widgetFiltersSchema = z
  .object({
    platforms: z.array(platformSchema).max(PLATFORMS.length).optional(),
    campaignIds: z.array(z.string().min(1)).max(200).optional(),
  })
  .strict();

/** Strict schema for persisted custom-widget config (used by dashboards PUT). */
export const customWidgetConfigSchema = z
  .object({
    title: z.string().max(80).optional(),
    visualization: z.enum(CUSTOM_VISUALIZATIONS),
    metrics: z.array(z.enum(QUERY_METRICS)).min(1).max(6),
    groupBy: z.enum(QUERY_GROUP_BYS),
    timeBucket: z.enum(QUERY_TIME_BUCKETS),
    limit: z.number().int().min(1).max(QUERY_MAX_LIMIT),
    sortBy: z.enum(QUERY_METRICS),
    sortDir: z.enum(QUERY_SORT_DIRS),
    filters: widgetFiltersSchema.optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const rule = VISUALIZATION_RULES[cfg.visualization];
    if (!rule.groupBy.includes(cfg.groupBy)) {
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: `groupBy "${cfg.groupBy}" not allowed for ${cfg.visualization}` });
    }
    if (!rule.timeBucket.includes(cfg.timeBucket)) {
      ctx.addIssue({ code: "custom", path: ["timeBucket"], message: `timeBucket "${cfg.timeBucket}" not allowed for ${cfg.visualization}` });
    }
    const max = cfg.groupBy === "none" ? rule.maxMetrics : rule.maxMetricsWhenGrouped;
    if (cfg.metrics.length > max) {
      ctx.addIssue({ code: "custom", path: ["metrics"], message: `at most ${max} metrics for this visualization` });
    }
  });

function uniq<T>(list: T[]): T[] {
  return list.filter((v, i) => list.indexOf(v) === i);
}

/**
 * Coerce any persisted config into a valid CustomWidgetConfig. Never throws:
 * unknown values fall back to defaults, and VISUALIZATION_RULES are enforced
 * (metrics trimmed, groupBy/timeBucket snapped to the first allowed value).
 * The builder calls this on every change so the preview is always renderable.
 */
export function normalizeCustomConfig(input: Partial<CustomWidgetConfig> | Record<string, unknown>): CustomWidgetConfig {
  const raw = input as Record<string, unknown>;
  const visualization = (CUSTOM_VISUALIZATIONS as readonly string[]).includes(String(raw.visualization))
    ? (raw.visualization as CustomVisualization)
    : DEFAULT_CUSTOM_CONFIG.visualization;
  const rule = VISUALIZATION_RULES[visualization];

  let groupBy = (QUERY_GROUP_BYS as readonly string[]).includes(String(raw.groupBy))
    ? (raw.groupBy as QueryGroupBy)
    : DEFAULT_CUSTOM_CONFIG.groupBy;
  if (!rule.groupBy.includes(groupBy)) groupBy = rule.groupBy[0];

  let timeBucket = (QUERY_TIME_BUCKETS as readonly string[]).includes(String(raw.timeBucket))
    ? (raw.timeBucket as QueryTimeBucket)
    : DEFAULT_CUSTOM_CONFIG.timeBucket;
  if (!rule.timeBucket.includes(timeBucket)) timeBucket = rule.timeBucket[0];

  const metricsRaw = Array.isArray(raw.metrics) ? raw.metrics : [];
  let metrics = uniq(
    metricsRaw.filter((m): m is QueryMetric => (QUERY_METRICS as readonly string[]).includes(String(m)))
  );
  if (metrics.length === 0) metrics = [...DEFAULT_CUSTOM_CONFIG.metrics];
  const max = groupBy === "none" ? rule.maxMetrics : rule.maxMetricsWhenGrouped;
  metrics = metrics.slice(0, max);

  const limitNum = Number(raw.limit);
  const limit = Number.isInteger(limitNum) && limitNum >= 1 && limitNum <= QUERY_MAX_LIMIT ? limitNum : QUERY_DEFAULT_LIMIT;

  const sortBy = (QUERY_METRICS as readonly string[]).includes(String(raw.sortBy))
    ? (raw.sortBy as QueryMetric)
    : metrics[0];
  const sortDir = (QUERY_SORT_DIRS as readonly string[]).includes(String(raw.sortDir))
    ? (raw.sortDir as QuerySortDir)
    : "desc";

  const title = typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim().slice(0, 80) : undefined;

  const filtersParsed = widgetFiltersSchema.safeParse(raw.filters);
  const filters = filtersParsed.success ? filtersParsed.data : undefined;
  const cleanFilters: WidgetFilters | undefined =
    filters && ((filters.platforms?.length ?? 0) > 0 || (filters.campaignIds?.length ?? 0) > 0)
      ? {
          ...(filters.platforms?.length ? { platforms: filters.platforms } : {}),
          ...(filters.campaignIds?.length ? { campaignIds: filters.campaignIds } : {}),
        }
      : undefined;

  return {
    ...(title ? { title } : {}),
    visualization,
    metrics,
    groupBy,
    timeBucket,
    limit,
    sortBy,
    sortDir,
    ...(cleanFilters ? { filters: cleanFilters } : {}),
  };
}

/** Auto title, e.g. "Spend by platform", "Spend & Clicks by week", "Top 10 campaigns by CPA". */
export function describeCustomWidget(cfg: CustomWidgetConfig): string {
  const names = cfg.metrics.map((m) => QUERY_METRIC_META[m].label);
  const metricText = names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const parts: string[] = [metricText];
  if (cfg.groupBy === "campaign") parts.push(`top ${cfg.limit} campaigns`);
  else if (cfg.groupBy === "platform") parts.push("by platform");
  if (cfg.timeBucket !== "none") parts.push(`by ${TIME_BUCKET_LABELS[cfg.timeBucket].toLowerCase()}`);
  return parts.join(" · ");
}

/** Builds the MetricQueryParams for a widget from its config + resolved scope. */
export function toMetricQueryParams(
  cfg: CustomWidgetConfig,
  scope: { clientId: string; startDate: string; endDate: string; platforms?: Platform[]; campaignIds?: string[] }
): MetricQueryParams {
  return {
    clientId: scope.clientId,
    startDate: scope.startDate,
    endDate: scope.endDate,
    groupBy: cfg.groupBy,
    timeBucket: cfg.timeBucket,
    platforms: scope.platforms,
    campaignIds: scope.campaignIds,
    limit: cfg.groupBy === "none" ? undefined : cfg.limit,
    sortBy: cfg.sortBy,
    sortDir: cfg.sortDir,
  };
}
