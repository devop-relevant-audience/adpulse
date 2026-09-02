// Contract for the "custom" dashboard widget and the aggregation query that
// feeds it. Pure TypeScript + zod, no React — shared by the server
// (src/lib/data/metric-query.ts, /api/metrics?action=query, dashboards PUT
// validation), the hook (useMetricQuery) and the widget/builder UI.

import { z } from "zod";
import type { Platform } from "@/lib/types/database";
import { widgetFiltersSchema } from "@/lib/dashboard/filters";
import type { WidgetFilters } from "@/lib/dashboard/types";

// The `config.filters` shape lives with its readers in filters.ts; re-exported
// here so existing importers of the custom-widget contract keep working.
export { widgetFiltersSchema };

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

export const QUERY_GROUP_BYS = ["none", "platform", "campaign", "adAccount", "campaignType"] as const;
export type QueryGroupBy = (typeof QUERY_GROUP_BYS)[number];

export const QUERY_TIME_BUCKETS = ["none", "day", "week"] as const;
export type QueryTimeBucket = (typeof QUERY_TIME_BUCKETS)[number];

export const QUERY_SORT_DIRS = ["asc", "desc"] as const;
export type QuerySortDir = (typeof QUERY_SORT_DIRS)[number];

/** Comparison a threshold filter applies to a group's whole-range metric. */
export const THRESHOLD_OPS = ["gt", "lt"] as const;
export type ThresholdOp = (typeof THRESHOLD_OPS)[number];

export const THRESHOLD_OP_LABELS: Record<ThresholdOp, string> = {
  gt: "over",
  lt: "under",
};

/**
 * "Only campaigns whose CPA is over 50". A predicate on ONE group's totals for
 * the whole range, not on individual fact rows and not per time bucket: a group
 * either qualifies and keeps its entire series, or it is absent.
 */
export interface MetricThreshold {
  metric: QueryMetric;
  op: ThresholdOp;
  value: number;
}

export const metricThresholdSchema = z
  .object({
    metric: z.enum(QUERY_METRICS),
    op: z.enum(THRESHOLD_OPS),
    value: z.number().finite(),
  })
  .strict();

/** URL form of a threshold: one query param, one place that spells it. */
export function encodeThreshold(threshold: MetricThreshold): string {
  return `${threshold.metric}:${threshold.op}:${threshold.value}`;
}

/** Inverse of `encodeThreshold`. Null for anything malformed — callers 400. */
export function parseThreshold(raw: string | null | undefined): MetricThreshold | null {
  if (!raw) return null;
  const [metric, op, value] = raw.split(":");
  const parsed = metricThresholdSchema.safeParse({ metric, op, value: Number(value) });
  return parsed.success ? parsed.data : null;
}

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
  adAccount: "Ad account",
  // Meta reports an objective and Google a campaign type; neither ever reports
  // both, so they are one user-facing dimension. See metric-query.ts.
  campaignType: "Campaign type",
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
  /**
   * Keep only the groups whose whole-range total passes this test, and do it
   * BEFORE the top-N cut, so "top 10 campaigns with CPA over 50" is the ten
   * biggest that qualify. Ignored when groupBy = none.
   */
  threshold?: MetricThreshold;
}

/** One aggregated bucket. Every metric is always present so the client picks. */
export interface MetricQueryRow {
  /**
   * Stable row key: group key when no time bucket ("meta", "g-camp-001",
   * "total"), "<group>|<date>" when bucketed by time.
   */
  key: string;
  /** Group key alone: platform id, campaign id, ad account id, campaign type, or "total". */
  group: string;
  /** Human label for the group, resolved server-side; "Total" when ungrouped. */
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

export const CUSTOM_VISUALIZATIONS = [
  "number",
  "line",
  "area",
  "bar",
  "combo",
  "pie",
  "donut",
  "table",
  "pivot",
] as const;
export type CustomVisualization = (typeof CUSTOM_VISUALIZATIONS)[number];

export const VISUALIZATION_LABELS: Record<CustomVisualization, string> = {
  number: "Number",
  line: "Line chart",
  area: "Area chart",
  bar: "Bar chart",
  combo: "Combo (bar + line)",
  pie: "Pie chart",
  donut: "Donut chart",
  table: "Table",
  pivot: "Pivot table",
};

/**
 * Picker grouping for the builder: which question each chart type answers.
 * Every CustomVisualization appears exactly once, in picker order.
 */
export const VISUALIZATION_FAMILIES = [
  { label: "Number", types: ["number"] },
  { label: "Over time", types: ["line", "area", "combo"] },
  { label: "Comparison", types: ["bar"] },
  { label: "Part-to-whole", types: ["pie", "donut"] },
  { label: "Table", types: ["table", "pivot"] },
] as const satisfies readonly { label: string; types: readonly CustomVisualization[] }[];

export const BAR_MODES = ["grouped", "stacked", "stacked100"] as const;
export type BarMode = (typeof BAR_MODES)[number];

export const BAR_MODE_LABELS: Record<BarMode, string> = {
  grouped: "Grouped",
  stacked: "Stacked",
  stacked100: "100% stacked",
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
  /**
   * Keep only the groups passing this test, applied before the top-N cut.
   * Only meaningful with a breakdown, so the normalizer drops it when
   * groupBy = none and the strict schema rejects it there.
   */
  threshold?: MetricThreshold;

  // Display options. Each one belongs to a subset of visualizations
  // (VISUALIZATION_OPTIONS) and normalizeCustomConfig drops the rest, so a
  // persisted config never carries a key its chart type cannot use.
  /** number: tiny trend line under the figure. */
  sparkline?: boolean;
  /** number: previous-period value and delta. */
  showComparison?: boolean;
  /** bar: how several metrics share a category. */
  barMode?: BarMode;
  /** area: stack the series instead of overlaying them. */
  areaStacked?: boolean;
  /** line/area/combo: least-squares fit across the plotted points. */
  trendLine?: boolean;
  /** table/pivot: shade numeric cells by their value within the column. */
  heatCells?: boolean;
  /** line/area/combo: draw the comparison period as a second, dashed series. */
  compareSeries?: boolean;
}

export const DISPLAY_OPTIONS = [
  "sparkline",
  "showComparison",
  "barMode",
  "areaStacked",
  "trendLine",
  "heatCells",
  "compareSeries",
] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];

/** Which display options each visualization accepts. Anything else is stripped. */
export const VISUALIZATION_OPTIONS: Record<CustomVisualization, readonly DisplayOption[]> = {
  number: ["sparkline", "showComparison"],
  // The comparison series needs a time axis to lay the earlier window onto, so
  // only the three time-bucketed chart types offer it.
  line: ["trendLine", "compareSeries"],
  area: ["areaStacked", "trendLine", "compareSeries"],
  bar: ["barMode"],
  combo: ["trendLine", "compareSeries"],
  pie: [],
  donut: [],
  table: ["heatCells"],
  pivot: ["heatCells"],
};

/** Applied when an applicable option is missing from a persisted config. */
export const DISPLAY_OPTION_DEFAULTS = {
  sparkline: false,
  // On: number widgets have always drawn their period-over-period delta, and
  // configs written before this option existed must keep doing so.
  showComparison: true,
  barMode: "grouped",
  areaStacked: false,
  trendLine: false,
  heatCells: false,
  compareSeries: false,
} as const satisfies { [K in DisplayOption]: NonNullable<CustomWidgetConfig[K]> };

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
  line: { maxMetrics: 4, maxMetricsWhenGrouped: 1, groupBy: ["none", "platform", "campaign", "adAccount", "campaignType"], timeBucket: ["day", "week"] },
  // Same series as a line, filled — and stackable into a composition over time.
  area: { maxMetrics: 4, maxMetricsWhenGrouped: 1, groupBy: ["none", "platform", "campaign", "adAccount", "campaignType"], timeBucket: ["day", "week"] },
  // Categories = groups; up to two metrics (second on a right axis).
  bar: { maxMetrics: 2, maxMetricsWhenGrouped: 2, groupBy: ["platform", "campaign", "adAccount", "campaignType"], timeBucket: ["none"] },
  // Bars for metric 1 against a line for metric 2 on a right axis, over time.
  combo: { maxMetrics: 2, maxMetricsWhenGrouped: 1, groupBy: ["none"], timeBucket: ["day", "week"] },
  // One metric split into shares, so a breakdown dimension is mandatory.
  pie: { maxMetrics: 1, maxMetricsWhenGrouped: 1, groupBy: ["platform", "campaign", "adAccount", "campaignType"], timeBucket: ["none"] },
  donut: { maxMetrics: 1, maxMetricsWhenGrouped: 1, groupBy: ["platform", "campaign", "adAccount", "campaignType"], timeBucket: ["none"] },
  // Rows = groups and/or time buckets; columns = metrics.
  table: { maxMetrics: 6, maxMetricsWhenGrouped: 6, groupBy: ["none", "platform", "campaign", "adAccount", "campaignType"], timeBucket: ["none", "day", "week"] },
  // Rows = groups, columns = time buckets, cells = the one metric.
  pivot: { maxMetrics: 1, maxMetricsWhenGrouped: 1, groupBy: ["platform", "campaign", "adAccount", "campaignType"], timeBucket: ["day", "week"] },
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
    sparkline: z.boolean().optional(),
    showComparison: z.boolean().optional(),
    barMode: z.enum(BAR_MODES).optional(),
    areaStacked: z.boolean().optional(),
    trendLine: z.boolean().optional(),
    heatCells: z.boolean().optional(),
    compareSeries: z.boolean().optional(),
    threshold: metricThresholdSchema.optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const rule = VISUALIZATION_RULES[cfg.visualization];
    const options = VISUALIZATION_OPTIONS[cfg.visualization];
    for (const opt of DISPLAY_OPTIONS) {
      if (cfg[opt] !== undefined && !options.includes(opt)) {
        ctx.addIssue({ code: "custom", path: [opt], message: `${opt} does not apply to ${cfg.visualization}` });
      }
    }
    if (!rule.groupBy.includes(cfg.groupBy)) {
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: `groupBy "${cfg.groupBy}" not allowed for ${cfg.visualization}` });
    }
    if (!rule.timeBucket.includes(cfg.timeBucket)) {
      ctx.addIssue({ code: "custom", path: ["timeBucket"], message: `timeBucket "${cfg.timeBucket}" not allowed for ${cfg.visualization}` });
    }
    // Both cross-field option rules below are presence-based, exactly like the
    // display-option loop above: the normalizer omits a key that does not
    // apply, so a config carrying one is a config nothing normalized.
    if (cfg.threshold !== undefined && cfg.groupBy === "none") {
      ctx.addIssue({ code: "custom", path: ["threshold"], message: "threshold needs a breakdown (groupBy is none)" });
    }
    if (cfg.compareSeries !== undefined && cfg.groupBy !== "none") {
      ctx.addIssue({
        code: "custom",
        path: ["compareSeries"],
        message: "compareSeries only applies to an ungrouped chart",
      });
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

  // A threshold picks WHICH groups appear, so an ungrouped chart has nothing to
  // apply it to and the key is dropped rather than carried as dead weight the
  // strict schema would then reject.
  const thresholdParsed = groupBy === "none" ? null : metricThresholdSchema.safeParse(raw.threshold);
  const threshold = thresholdParsed?.success ? thresholdParsed.data : undefined;

  // Only the options this visualization understands survive, so switching type
  // can't leave a dead key behind in a config the strict schema then rejects.
  const allowed = VISUALIZATION_OPTIONS[visualization];
  const bool = (key: Exclude<DisplayOption, "barMode">) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : DISPLAY_OPTION_DEFAULTS[key];
  const options: Partial<CustomWidgetConfig> = {
    ...(allowed.includes("sparkline") ? { sparkline: bool("sparkline") } : {}),
    ...(allowed.includes("showComparison") ? { showComparison: bool("showComparison") } : {}),
    ...(allowed.includes("barMode")
      ? {
          barMode: (BAR_MODES as readonly string[]).includes(String(raw.barMode))
            ? (raw.barMode as BarMode)
            : DISPLAY_OPTION_DEFAULTS.barMode,
        }
      : {}),
    ...(allowed.includes("areaStacked") ? { areaStacked: bool("areaStacked") } : {}),
    ...(allowed.includes("trendLine") ? { trendLine: bool("trendLine") } : {}),
    ...(allowed.includes("heatCells") ? { heatCells: bool("heatCells") } : {}),
    // Mirror image of the threshold rule: one earlier window laid over N group
    // series is unreadable, so the comparison is an ungrouped-chart option.
    ...(allowed.includes("compareSeries") && groupBy === "none"
      ? { compareSeries: bool("compareSeries") }
      : {}),
  };

  const filtersParsed = widgetFiltersSchema.safeParse(raw.filters);
  const filters = filtersParsed.success ? filtersParsed.data : undefined;
  const cleanFilters: WidgetFilters | undefined =
    filters &&
    ((filters.platforms?.length ?? 0) > 0 ||
      (filters.campaignIds?.length ?? 0) > 0 ||
      filters.dateRange !== undefined)
      ? {
          ...(filters.platforms?.length ? { platforms: filters.platforms } : {}),
          ...(filters.campaignIds?.length ? { campaignIds: filters.campaignIds } : {}),
          ...(filters.dateRange ? { dateRange: filters.dateRange } : {}),
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
    ...options,
    ...(threshold ? { threshold } : {}),
    ...(cleanFilters ? { filters: cleanFilters } : {}),
  };
}

/** "CPA over 50" — the threshold in words, for titles, forms and empty states. */
export function describeThreshold(threshold: MetricThreshold): string {
  return `${QUERY_METRIC_META[threshold.metric].label} ${THRESHOLD_OP_LABELS[threshold.op]} ${threshold.value}`;
}

/**
 * What a chart says when its threshold matched no group. Null when there is no
 * threshold, so the caller falls back to its usual "no data" line — a filter
 * that hid everything must not read as an absence of data.
 */
export function describeThresholdEmpty(cfg: CustomWidgetConfig): string | null {
  if (!cfg.threshold || cfg.groupBy === "none") return null;
  return `No ${GROUP_BY_LABELS[cfg.groupBy].toLowerCase()}s match ${describeThreshold(cfg.threshold)}`;
}

/** Auto title, e.g. "Spend by platform", "Spend & Clicks by week", "Top 10 campaigns by CPA". */
export function describeCustomWidget(cfg: CustomWidgetConfig): string {
  const names = cfg.metrics.map((m) => QUERY_METRIC_META[m].label);
  const joiner = cfg.visualization === "combo" ? " vs " : " & ";
  const metricText = names.length <= 2 ? names.join(joiner) : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  // A pivot's point is the grid, so name both of its axes instead of listing
  // the breakdown and the bucket as two independent facets.
  if (cfg.visualization === "pivot") {
    return `${metricText} · ${GROUP_BY_LABELS[cfg.groupBy].toLowerCase()} × ${TIME_BUCKET_LABELS[cfg.timeBucket].toLowerCase()}`;
  }

  const share = cfg.visualization === "pie" || cfg.visualization === "donut";
  const parts: string[] = [share ? `${metricText} share` : metricText];
  // Only campaigns run to hundreds of rows, so only they are worth naming by
  // the top-N cap; the other dimensions read better as a plain breakdown.
  if (cfg.groupBy === "campaign") parts.push(`top ${cfg.limit} campaigns`);
  else if (cfg.groupBy !== "none") parts.push(`by ${GROUP_BY_LABELS[cfg.groupBy].toLowerCase()}`);
  if (cfg.timeBucket !== "none") parts.push(`by ${TIME_BUCKET_LABELS[cfg.timeBucket].toLowerCase()}`);
  // Named last, and always: a chart silently hiding groups is worse than a
  // long title, and this is the only place the filter shows without opening
  // the config dialog.
  if (cfg.threshold) parts.push(describeThreshold(cfg.threshold));
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
    ...(cfg.threshold ? { threshold: cfg.threshold } : {}),
  };
}
