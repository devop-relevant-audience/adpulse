// Server-side capture of a dashboard view into a frozen ViewSnapshot.
//
// Every widget's data is computed HERE, once, and stored on the report row.
// The renderer never queries again, so a view report's numbers stay put even
// as the underlying facts, the source view, or the saved-widget library change.
//
// Page-level scope (the dashboard's platform selector) deliberately does NOT
// apply: a report is built from the view's own definition, so only per-widget
// `config.filters` narrow a widget's query.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { getDashboardById } from "@/lib/data/dashboards";
import { getReportLayoutById } from "@/lib/data/report-layouts";
import { compareMetrics, getClientCurrency } from "@/lib/data/queries";
import { runMetricQuery } from "@/lib/data/metric-query";
import { calculateHealthScore } from "@/lib/data/health-score";
import {
  getAttributionComparison,
  getCohortAnalysis,
  getRevenueOverview,
} from "@/lib/data/attribution";
import { readWidgetFilters, resolveWidgetDateRange } from "@/lib/dashboard/filters";
import { excludeCurrentDay } from "@/lib/format";
import type { WidgetInstance } from "@/lib/dashboard/types";
import { generateAiSummary, widgetHighlights } from "@/lib/reports/ai-summary";
import type { AiSummaryContext } from "@/lib/reports/ai-summary";
import { readAiSummaryConfig } from "@/lib/dashboard/report-blocks";
import { previousPeriodRange } from "@/lib/dashboard/date-presets";
import {
  DEFAULT_COMPARISON_LABEL,
  VIEW_SNAPSHOT_VERSION,
  metricWidgetPlan,
} from "@/lib/reports/view-snapshot";
import type {
  DateRange,
  MetricWidgetPlan,
  SnapshotWidget,
  SnapshotWidgetData,
  ViewSnapshot,
} from "@/lib/reports/view-snapshot";

/**
 * Raised when the requested view or report layout doesn't exist, or belongs to
 * another client. One error type for both sources: the routes turn it into the
 * same 404 either way.
 */
export class ViewNotFoundError extends Error {
  constructor(message = "Dashboard view not found") {
    super(message);
    this.name = "ViewNotFoundError";
  }
}

/** What an AI-summary block says when its period totals could not be read. */
const SUMMARY_UNAVAILABLE = "No written summary could be produced for this period.";

/**
 * Stands in for the prose in a PREVIEW, which deliberately skips the model: the
 * call is slow and costs a request, and a preview is thrown away.
 */
export const AI_SUMMARY_PREVIEW_PLACEHOLDER =
  "The AI summary is written when the report is generated.";

interface BuildContext {
  clientId: string;
  /** Frozen into a cover block — the client's name as it read at build time. */
  clientName: string;
  isDemo: boolean;
  dateRange: DateRange;
  comparison: DateRange;
}

async function captureWidget(
  widget: WidgetInstance,
  ctx: BuildContext,
  /** Resolved once by the caller, which also freezes `plan.viz` on the widget. */
  plan: MetricWidgetPlan | null
): Promise<SnapshotWidgetData> {
  const filters = readWidgetFilters(widget.config);

  // A widget that pins its own range (`config.filters.dateRange`) is captured
  // over that range instead of the report's. A preset is resolved HERE, once,
  // at snapshot time and frozen with the numbers — a view report is a record of
  // what the view showed when it was built, not a live "last 30 days".
  // An overridden widget compares against the equal-length window immediately
  // before its own range, so its delta stays internally consistent.
  const override = resolveWidgetDateRange(filters.dateRange);
  const dateRange = override ?? ctx.dateRange;
  const comparison = override ? previousPeriodRange(override) : ctx.comparison;

  if (plan) {
    const base = {
      clientId: ctx.clientId,
      groupBy: plan.groupBy,
      timeBucket: plan.timeBucket,
      limit: plan.limit,
      sortBy: plan.sortBy,
      sortDir: plan.sortDir,
      // Safe on all three queries below: a threshold only survives
      // normalization on a grouped config, and the previous/series passes are
      // only taken for ungrouped ones, where runMetricQuery ignores it anyway.
      ...(plan.threshold ? { threshold: plan.threshold } : {}),
      platforms: filters.platforms,
      campaignIds: filters.campaignIds,
    };
    const [current, previous, series] = await Promise.all([
      runMetricQuery({ ...base, startDate: dateRange.start, endDate: dateRange.end }),
      plan.withPrevious
        ? runMetricQuery({ ...base, startDate: comparison.start, endDate: comparison.end })
        : Promise.resolve(null),
      // The sparkline's own day-bucketed pass — same range and scope, only the
      // bucket differs, exactly what CustomWidget runs live.
      plan.withSeries
        ? runMetricQuery({
            ...base,
            timeBucket: "day",
            startDate: dateRange.start,
            endDate: dateRange.end,
          })
        : Promise.resolve(null),
    ]);
    // Same rule as the live dashboard hooks: never freeze the partial current
    // day into a snapshot, or the report's charts end in a fake dropoff forever.
    return {
      kind: "metrics",
      current: { ...current, rows: excludeCurrentDay(current.rows) },
      previous,
      series: series ? { ...series, rows: excludeCurrentDay(series.rows) } : null,
      // Frozen alongside the numbers because a widget with its own date range
      // was captured over a different pair of windows than the report's.
      range: dateRange,
      previousRange: comparison,
    };
  }

  const range = {
    clientId: ctx.clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
  };

  switch (widget.type) {
    case "health-gauge":
      return {
        kind: "health",
        health: await calculateHealthScore({
          ...range,
          platforms: filters.platforms,
          campaignIds: filters.campaignIds,
        }),
      };

    // The attribution trio reads attribution_journeys / customer_cohorts, which
    // only demo clients have. A real client freezes `null` and the renderer
    // shows the same "not available" note the live dashboard shows.
    case "revenue-roas":
      return ctx.isDemo ? { kind: "revenue", overview: await getRevenueOverview(range) } : null;

    case "attribution-mini":
      return ctx.isDemo
        ? { kind: "attribution", comparison: await getAttributionComparison(range) }
        : null;

    case "ltv-cac":
      return ctx.isDemo ? { kind: "cohorts", analysis: await getCohortAnalysis(range) } : null;

    // The client name is context, not config, so it is frozen here: renaming
    // the client later must not rewrite a report that has already gone out.
    case "cover":
      return { kind: "cover", clientName: ctx.clientName };

    // note (config.text is the whole widget), ai-summary (filled in by a second
    // pass, once every other widget's numbers exist) and anything unknown.
    default:
      return null;
  }
}

/**
 * Client-level facts every snapshot needs: the currency to format in, whether
 * the demo-only attribution tables apply, and the name a cover block freezes.
 */
async function buildContext(
  clientId: string,
  dateRange: DateRange
): Promise<{ ctx: BuildContext; currency: string }> {
  const [currency, clientRow] = await Promise.all([
    getClientCurrency(clientId),
    db
      .select({ name: clients.name, isDemo: clients.isDemo })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1),
  ]);

  return {
    currency,
    ctx: {
      clientId,
      clientName: clientRow[0]?.name ?? "",
      isDemo: clientRow[0]?.isDemo ?? false,
      dateRange,
      comparison: previousPeriodRange(dateRange),
    },
  };
}

/**
 * Freezes every widget of one grid. `savedWidgetId` is dropped: the read
 * already hydrated `config`, and a report must never follow a library pointer
 * that can change later. A grid holds at most a couple of dozen widgets, so one
 * wave is fine.
 */
async function captureWidgets(
  widgets: WidgetInstance[],
  ctx: BuildContext
): Promise<SnapshotWidget[]> {
  return Promise.all(
    widgets.map(async (widget) => {
      // Resolved here so the plan the data was computed FROM is the same one
      // stored for the renderer — one derivation, frozen with the numbers.
      const plan = metricWidgetPlan(widget.type, widget.config);
      return {
        i: widget.i,
        type: widget.type,
        config: widget.config,
        viz: plan?.viz ?? null,
        data: await captureWidget(widget, ctx, plan),
      };
    })
  );
}

/**
 * Fills in every `ai-summary` block, IN PLACE, once the rest of the grid has
 * its numbers — the prose is written from the frozen data, so it can only cite
 * figures that are also on the page. Each block gets its own call because each
 * carries its own instructions; the context they share is computed once.
 *
 * Never throws: `generateAiSummary` answers with a deterministic fallback on
 * any failure, and a failure to assemble its context (the period totals come
 * from the DB) degrades to `SUMMARY_UNAVAILABLE`. Every other block already has
 * its numbers by this point, so nothing here may cost the caller its report.
 */
async function writeAiSummaries(
  widgets: SnapshotWidget[],
  ctx: BuildContext,
  currency: string
): Promise<void> {
  const blocks = widgets.filter((w) => w.type === "ai-summary");
  if (blocks.length === 0) return;

  let context: AiSummaryContext;
  try {
    const totals = await compareMetrics({
      clientId: ctx.clientId,
      currentStart: ctx.dateRange.start,
      currentEnd: ctx.dateRange.end,
      previousStart: ctx.comparison.start,
      previousEnd: ctx.comparison.end,
    });

    context = {
      clientName: ctx.clientName,
      currency,
      dateRange: ctx.dateRange,
      comparison: ctx.comparison,
      totals,
      highlights: widgetHighlights(widgets, currency),
    };
  } catch {
    // Without the totals there is nothing truthful to write — a zeroed context
    // would state zeros as fact. The block says so instead, flagged the same
    // way the deterministic fallback is.
    for (const block of blocks) {
      block.data = { kind: "text", content: SUMMARY_UNAVAILABLE, generated: false };
    }
    return;
  }

  await Promise.all(
    blocks.map(async (block) => {
      const { instructions } = readAiSummaryConfig(block.config);
      const summary = await generateAiSummary(context, instructions);
      block.data = { kind: "text", content: summary.content, generated: summary.generated };
    })
  );
}

/**
 * Builds the frozen snapshot for `dashboardId` over `dateRange`. The caller is
 * responsible for authorizing `clientId`; this only enforces that the view
 * actually belongs to it.
 */
export async function buildViewSnapshot(params: {
  clientId: string;
  dashboardId: string;
  dateRange: DateRange;
}): Promise<ViewSnapshot> {
  const view = await getDashboardById(params.dashboardId);
  if (!view || view.clientId !== params.clientId) throw new ViewNotFoundError();

  const { ctx, currency } = await buildContext(params.clientId, params.dateRange);
  const widgets = await captureWidgets(view.widgets, ctx);

  return {
    kind: "view",
    schemaVersion: VIEW_SNAPSHOT_VERSION,
    sourceDashboardId: view.id,
    viewName: view.name,
    currency,
    dateRange: params.dateRange,
    comparison: ctx.comparison,
    comparisonLabel: DEFAULT_COMPARISON_LABEL,
    layouts: view.layouts,
    widgets,
  };
}

/**
 * The same capture, from a REPORT LAYOUT instead of a dashboard view: the block
 * vocabulary is identical, so only the source row, the two report-only blocks
 * and the document page style differ. The AI summary runs last, over the
 * numbers the rest of the blocks froze.
 *
 * `skipAiSummaries` is for the preview: every other block is computed exactly
 * as it would be for a real report, but the AI blocks say so instead of costing
 * an OpenRouter call the preview would only discard.
 *
 * The caller authorizes `clientId`; this only enforces that the layout belongs
 * to it.
 */
export async function buildReportLayoutSnapshot(params: {
  clientId: string;
  layoutId: string;
  dateRange: DateRange;
  skipAiSummaries?: boolean;
}): Promise<ViewSnapshot> {
  const layout = await getReportLayoutById(params.layoutId);
  if (!layout || layout.clientId !== params.clientId) {
    throw new ViewNotFoundError("Report layout not found");
  }

  const { ctx, currency } = await buildContext(params.clientId, params.dateRange);
  const widgets = await captureWidgets(layout.widgets, ctx);
  if (params.skipAiSummaries) {
    for (const block of widgets) {
      if (block.type === "ai-summary") {
        block.data = { kind: "text", content: AI_SUMMARY_PREVIEW_PLACEHOLDER, generated: false };
      }
    }
  } else {
    await writeAiSummaries(widgets, ctx, currency);
  }

  return {
    kind: "view",
    schemaVersion: VIEW_SNAPSHOT_VERSION,
    sourceDashboardId: null,
    sourceReportLayoutId: layout.id,
    pageStyle: "document",
    viewName: layout.name,
    currency,
    dateRange: params.dateRange,
    comparison: ctx.comparison,
    comparisonLabel: DEFAULT_COMPARISON_LABEL,
    layouts: layout.layouts,
    widgets,
  };
}
