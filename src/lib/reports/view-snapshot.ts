// Contract for a "view report": a report created FROM a dashboard view, whose
// numbers are FROZEN at creation time. Pure TypeScript, no React and no DB —
// shared by the builder (src/lib/reports/build-view-snapshot.ts, server), the
// API route, and the read-only renderer (src/components/reports/view-report.tsx).
//
// The snapshot is self-contained on purpose: it carries the layout, every
// widget's fully inlined config (no `savedWidgetId` — a report must not depend
// on the saved-widget library, whose rows can be edited or deleted) and every
// widget's computed data. Nothing in the render path re-queries anything.

import type { DashboardLayouts, WidgetType } from "@/lib/dashboard/types";
import {
  QUERY_DEFAULT_LIMIT,
  QUERY_METRICS,
  normalizeCustomConfig,
} from "@/lib/dashboard/custom-widget";
import {
  TOP_MOVERS_QUERY_LIMIT,
  TOP_MOVERS_QUERY_SORT_BY,
  normalizeTopMoversConfig,
} from "@/lib/dashboard/top-movers";
import type {
  CustomWidgetConfig,
  MetricQueryResult,
  MetricThreshold,
  QueryGroupBy,
  QueryMetric,
  QuerySortDir,
  QueryTimeBucket,
} from "@/lib/dashboard/custom-widget";
import type { HealthScoreResult } from "@/lib/data/health-score";
import type {
  AttributionComparison,
  CohortAnalysis,
  RevenueOverview,
} from "@/lib/data/attribution";

/** Bump when the stored shape changes incompatibly; old reports keep their number. */
export const VIEW_SNAPSHOT_VERSION = 1;

/** What a view report compares against — see `ViewSnapshot.comparisonLabel`. */
export const DEFAULT_COMPARISON_LABEL = "previous period";

export interface DateRange {
  start: string;
  end: string;
}

/**
 * A widget's frozen data. `null` = the widget needs none (note) or its source
 * is unavailable for this client (the demo-only attribution tables).
 */
export type SnapshotWidgetData =
  | {
      kind: "metrics";
      current: MetricQueryResult;
      previous: MetricQueryResult | null;
      /**
       * Day-bucketed pass over the same range, for a number widget's sparkline.
       * Absent on reports frozen before sparklines existed — the renderer then
       * simply draws no sparkline.
       */
      series?: MetricQueryResult | null;
      /**
       * The windows `current` and `previous` actually cover. A widget that pins
       * its own date range is captured over that one, not the report's, and a
       * comparison series has to name the dates it drew. Absent on older
       * snapshots; the renderer then falls back to the snapshot's own ranges,
       * which is exactly what those reports were built with.
       */
      range?: DateRange;
      previousRange?: DateRange;
    }
  | { kind: "health"; health: HealthScoreResult }
  | { kind: "revenue"; overview: RevenueOverview }
  | { kind: "attribution"; comparison: AttributionComparison }
  | { kind: "cohorts"; analysis: CohortAnalysis }
  /** Cover block — the client's name as it read when the report was built. */
  | { kind: "cover"; clientName: string }
  /**
   * Prose written at build time. `generated: false` = the model was
   * unavailable and `content` is the deterministic fallback, which the renderer
   * says out loud rather than passing off as AI analysis.
   */
  | { kind: "text"; content: string; generated: boolean }
  | null;

export interface SnapshotWidget {
  /** Grid item key — matches the `i` of the copied layout item. */
  i: string;
  type: WidgetType;
  /** Fully hydrated, inlined config. `savedWidgetId` is deliberately dropped. */
  config: Record<string, unknown>;
  /**
   * The chart plan RESOLVED at build time, frozen alongside the data. The
   * renderer must prefer this over re-deriving from `config`, because
   * `metricWidgetPlan` reads VISUALIZATION_RULES — tightening a rule later
   * (say, lowering `table.maxMetrics`) would otherwise silently drop columns
   * from reports that were published with them. Absent on snapshots written
   * before this field existed; the renderer then re-derives, exactly as it did.
   */
  viz?: CustomWidgetConfig | null;
  data: SnapshotWidgetData;
}

export interface ViewSnapshot {
  /** Discriminator, so other frozen report kinds can share the column later. */
  kind: "view";
  schemaVersion: number;
  /** Provenance only — the report never re-reads the view. */
  sourceDashboardId: string | null;
  /**
   * Provenance for a report built from a REPORT LAYOUT rather than a dashboard
   * view. Absent on every snapshot written before report layouts existed, and
   * on view reports; stripped for non-agency readers alongside
   * `sourceDashboardId`, since a layout is agency-internal.
   */
  sourceReportLayoutId?: string | null;
  /**
   * How the renderer frames the grid. Absent (the dashboard-view default) = the
   * full-width dashboard grid. `"document"` = a centred page, for reports built
   * block by block from a report layout.
   */
  pageStyle?: "document";
  /** The view's or report layout's name. */
  viewName: string;
  /** ISO 4217 code of the client at snapshot time. */
  currency: string;
  dateRange: DateRange;
  /** Previous period, same arithmetic the dashboard's own comparisons use. */
  comparison: DateRange;
  /**
   * What `comparison` IS, in words, for readouts that name their baseline. It
   * lives at the top level because one comparison covers the whole snapshot: a
   * report is built without the page's Compare selector, so every widget —
   * including one that pinned its own date range — compares against the period
   * immediately before. Absent on older snapshots, which were all built that
   * way too, hence DEFAULT_COMPARISON_LABEL as the fallback.
   */
  comparisonLabel?: string;
  layouts: DashboardLayouts;
  widgets: SnapshotWidget[];
}

/**
 * Drops the agency-internal provenance ids before a snapshot goes to a reader
 * who must not see them — a client_user's report list, and the public share
 * endpoint, whose reader is anonymous. One helper for both paths so they cannot
 * drift. `sourceReportLayoutId` is only rewritten when it is there, so a
 * snapshot written before report layouts existed comes back unchanged.
 */
export function stripInternalProvenance(snapshot: ViewSnapshot): ViewSnapshot {
  return {
    ...snapshot,
    sourceDashboardId: null,
    ...(snapshot.sourceReportLayoutId ? { sourceReportLayoutId: null } : {}),
  };
}

/** Narrowing guard for the nullable `reports.view_snapshot` column. */
export function isViewSnapshot(value: unknown): value is ViewSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ViewSnapshot>;
  return v.kind === "view" && Array.isArray(v.widgets) && !!v.layouts;
}

// --- Metric-backed widgets -------------------------------------------------

/**
 * How a widget is fed by `runMetricQuery`, and how its frozen result is drawn.
 * `null` from `metricWidgetPlan` means the widget is not metric-query backed
 * (health gauge, the attribution trio, note).
 */
export interface MetricWidgetPlan {
  groupBy: QueryGroupBy;
  timeBucket: QueryTimeBucket;
  limit?: number;
  sortBy?: QueryMetric;
  sortDir?: QuerySortDir;
  /**
   * The group filter, carried into the snapshot query so a frozen report
   * captures the groups the dashboard was showing. Without it the report would
   * freeze the UNFILTERED top-N while its title (and its empty state) still
   * named the threshold. Ignored by `runMetricQuery` when groupBy is "none".
   */
  threshold?: MetricThreshold;
  /** Headline-number widgets also snapshot the comparison period. */
  withPrevious: boolean;
  /**
   * A number widget with `sparkline` on also snapshots a day-bucketed pass over
   * the same range — its own query is one undated total and cannot be plotted.
   */
  withSeries: boolean;
  /**
   * Non-null = render through the shared custom-widget visualizations. The
   * funnel is metric-backed but has its own renderer, so it carries null.
   */
  viz: CustomWidgetConfig | null;
}

function isQueryMetric(value: unknown): value is QueryMetric {
  return (QUERY_METRICS as readonly string[]).includes(String(value));
}

function vizPlan(viz: CustomWidgetConfig): MetricWidgetPlan {
  return {
    groupBy: viz.groupBy,
    timeBucket: viz.timeBucket,
    limit: viz.groupBy === "none" ? undefined : viz.limit,
    sortBy: viz.sortBy,
    sortDir: viz.sortDir,
    ...(viz.threshold ? { threshold: viz.threshold } : {}),
    // A number with its comparison switched off has no reader for the earlier
    // window, so it isn't captured. `!== false` keeps the option's default-on
    // behaviour for kpi widgets and for configs written before it existed.
    // A chart with `compareSeries` on draws that same window as a second
    // series, so it needs the very same capture.
    withPrevious:
      (viz.visualization === "number" && viz.showComparison !== false) || viz.compareSeries === true,
    withSeries: viz.visualization === "number" && viz.sparkline === true,
    viz,
  };
}

/**
 * Maps a live widget's config onto the query + visualization that reproduce it
 * from a frozen `MetricQueryResult`. Every metric-backed widget type is an
 * instance of the custom widget's own vocabulary, so one query path and one set
 * of renderers cover them all.
 */
export function metricWidgetPlan(
  type: WidgetType,
  config: Record<string, unknown>
): MetricWidgetPlan | null {
  switch (type) {
    case "custom":
      return vizPlan(normalizeCustomConfig(config));

    case "kpi": {
      const metric = isQueryMetric(config.metric) ? config.metric : "spend";
      return vizPlan(
        normalizeCustomConfig({ visualization: "number", metrics: [metric], sortBy: metric })
      );
    }

    case "trend": {
      const raw = Array.isArray(config.metrics) ? config.metrics : [];
      const metrics = raw.filter(isQueryMetric);
      return vizPlan(
        normalizeCustomConfig({
          visualization: "line",
          metrics: metrics.length > 0 ? metrics : ["spend", "conversions"],
          groupBy: "none",
          timeBucket: "day",
        })
      );
    }

    case "platform-breakdown": {
      const metric = isQueryMetric(config.metric) ? config.metric : "spend";
      return vizPlan(
        normalizeCustomConfig({
          visualization: "bar",
          metrics: [metric],
          groupBy: "platform",
          timeBucket: "none",
          sortBy: metric,
        })
      );
    }

    case "campaign-table": {
      const sortBy = isQueryMetric(config.sortBy) ? config.sortBy : "spend";
      const limit = typeof config.limit === "number" ? config.limit : QUERY_DEFAULT_LIMIT;
      return vizPlan(
        normalizeCustomConfig({
          visualization: "table",
          // Same columns the live campaign table shows.
          metrics: ["spend", "conversions", "ctr", "cpa"],
          groupBy: "campaign",
          timeBucket: "none",
          limit,
          sortBy,
          sortDir: "desc",
        })
      );
    }

    case "funnel":
      // Impressions → clicks → conversions off one whole-range total.
      return { groupBy: "none", timeBucket: "none", withPrevious: false, withSeries: false, viz: null };

    case "top-movers": {
      // Both windows over the same wide, spend-ranked slice of groups; the
      // ranking by absolute change happens in the renderer (computeMovers), so
      // the frozen data is just the two aggregations. Its own renderer, like
      // the funnel's, hence `viz: null`.
      const cfg = normalizeTopMoversConfig(config);
      return {
        groupBy: cfg.groupBy,
        timeBucket: "none",
        limit: TOP_MOVERS_QUERY_LIMIT,
        sortBy: TOP_MOVERS_QUERY_SORT_BY,
        sortDir: "desc",
        withPrevious: true,
        withSeries: false,
        viz: null,
      };
    }

    default:
      return null;
  }
}
