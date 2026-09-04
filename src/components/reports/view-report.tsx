"use client";

// Read-only renderer for a frozen ViewSnapshot. Everything it draws comes out
// of the snapshot — there is not a single data hook, store read or fetch in
// here, which is what makes a view report's numbers permanent.
//
// The grid is plain CSS grid rather than react-grid-layout: the same 12 columns,
// 40px rows and 16px gutters the dashboard uses (GRID_COLS / GRID_ROW_HEIGHT /
// GRID_MARGIN), so a report lays out like the view it was taken from, minus the
// drag/resize machinery. Below the `lg` breakpoint it collapses to a single
// column stacked in reading order.

import { format, parseISO } from "date-fns";
import { BiFilterAlt, BiLockAlt } from "react-icons/bi";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { WidgetErrorBoundary } from "@/components/dashboard/widget-frame";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { describeWidgetFilters, readWidgetFilters } from "@/lib/dashboard/filters";
import { GRID_COLS, GRID_MARGIN, GRID_ROW_HEIGHT } from "@/lib/dashboard/types";
import type { GridItem } from "@/lib/dashboard/types";
import {
  NumberViz,
  LineViz,
  AreaViz,
  BarViz,
  ComboViz,
  PieViz,
  TableViz,
  PivotViz,
} from "@/components/dashboard/widgets/custom-viz";
import { NoteWidget } from "@/components/dashboard/widgets/note-widget";
import { CoverBlock } from "@/components/dashboard/widgets/cover-widget";
import { AiSummaryBlock } from "@/components/dashboard/widgets/ai-summary-widget";
import { readCoverConfig } from "@/lib/dashboard/report-blocks";
import { SectionWidget } from "@/components/dashboard/widgets/section-widget";
import { ImageWidget } from "@/components/dashboard/widgets/image-widget";
import { TopMoversList } from "@/components/dashboard/widgets/top-movers-widget";
import { computeMovers, normalizeTopMoversConfig } from "@/lib/dashboard/top-movers";
import { FunnelStages } from "@/components/dashboard/widgets/funnel-widget";
import { HealthGaugeReadout } from "@/components/dashboard/widgets/health-gauge-widget";
import { RevenueRoasReadout } from "@/components/dashboard/widgets/revenue-roas-widget";
import {
  AttributionMiniChart,
  readModel,
} from "@/components/dashboard/widgets/attribution-mini-widget";
import { LtvCacReadout } from "@/components/dashboard/widgets/ltv-cac-widget";
import { DEFAULT_COMPARISON_LABEL, metricWidgetPlan } from "@/lib/reports/view-snapshot";
import { describeThresholdEmpty } from "@/lib/dashboard/custom-widget";
import type { DateRange, SnapshotWidget, ViewSnapshot } from "@/lib/reports/view-snapshot";
import type { MetricQueryRow } from "@/lib/dashboard/custom-widget";
import type { FunnelStage } from "@/lib/data/queries";
import { formatCurrency } from "@/lib/format";

const COLUMNS = GRID_COLS.lg;
const GUTTER = GRID_MARGIN[1];

/** RGL's own item height: h rows plus the gutters between them. */
export function itemHeight(h: number): number {
  return h * GRID_ROW_HEIGHT + (h - 1) * GUTTER;
}

/**
 * How a widget's frame is sized. `"fill"` is the grid's own rule — the panel
 * fills its tile and clips what does not fit, which is what a fixed-row layout
 * needs. `"auto"` lets the panel grow to its content, for the print renderer,
 * where a clipped note or a half-shown table is simply lost.
 */
export type WidgetFit = "fill" | "auto";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center px-3 text-center text-xs text-ink-muted">
      {children}
    </div>
  );
}

// --- Funnel ----------------------------------------------------------------

/** 2-decimal rounding, the same shape `getFunnelData` stores. */
function pct(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Rebuilds the funnel's three stages from the frozen whole-range totals —
 * identical arithmetic to `getFunnelData`, including its "no impressions means
 * no funnel" empty case (the caller renders the empty state for `[]`).
 */
function funnelStages(row: MetricQueryRow | undefined): FunnelStage[] {
  if (!row || row.impressions <= 0) return [];
  const steps: [string, number][] = [
    ["Impressions", row.impressions],
    ["Clicks", row.clicks],
    ["Conversions", row.conversions],
  ];
  const first = steps[0][1];
  return steps.map(([stage, volume], i) => {
    const previous = i === 0 ? volume : steps[i - 1][1];
    return {
      stage,
      volume,
      percentOfPrevious: previous > 0 ? pct((volume / previous) * 100) : 0,
      percentOfFirst: pct((volume / first) * 100),
    };
  });
}

// --- One widget ------------------------------------------------------------

function SnapshotWidgetBody({
  widget,
  currency,
  compareLabel,
  dateRange,
  comparison,
}: {
  widget: SnapshotWidget;
  currency: string;
  /** Names the frozen comparison window for readouts that state their baseline. */
  compareLabel: string;
  /** The report's own period — a cover block prints it. */
  dateRange: DateRange;
  /** The report's comparison window, for a widget that froze no range of its own. */
  comparison: DateRange;
}) {
  const { type, config, data } = widget;
  const money = (value: number) => formatCurrency(value, currency);

  // Note and section header are pure config, so the live components are
  // already snapshot-safe (they never had data to freeze).
  if (type === "note") return <NoteWidget config={config} instanceId={widget.i} />;
  if (type === "section") return <SectionWidget config={config} instanceId={widget.i} />;
  // Same reason, and it must stay ABOVE the `!data` guard: an image is pure
  // config, so the builder freezes `null` data for it and it would otherwise
  // fall through to the "not available for this client" placeholder.
  if (type === "image") return <ImageWidget config={config} instanceId={widget.i} />;

  if (!data) {
    return (
      <Placeholder>
        <span className="inline-flex items-center gap-1.5">
          <BiLockAlt className="w-3.5 h-3.5 shrink-0" />
          Not available for this client
        </span>
      </Placeholder>
    );
  }

  switch (data.kind) {
    case "metrics": {
      if (type === "funnel") {
        const stages = funnelStages(data.current.rows[0]);
        if (stages.length === 0) return <Placeholder>No funnel data</Placeholder>;
        return <FunnelStages stages={stages} />;
      }
      if (type === "top-movers") {
        const cfg = normalizeTopMoversConfig(config);
        const movers = computeMovers(cfg, data.current, data.previous);
        if (movers.length === 0) return <Placeholder>Nothing moved in this period</Placeholder>;
        return <TopMoversList movers={movers} metric={cfg.metric} currency={currency} />;
      }
      // The plan frozen at build time wins: re-deriving would re-read today's
      // VISUALIZATION_RULES and could quietly reshape a published report.
      // Older snapshots carry no `viz`, so they still re-derive as before.
      const viz = widget.viz ?? metricWidgetPlan(type, config)?.viz;
      if (!viz) return <Placeholder>Unsupported widget</Placeholder>;
      if (data.current.rows.length === 0) {
        return <Placeholder>{describeThresholdEmpty(viz) ?? "No data for this selection"}</Placeholder>;
      }
      // The comparison series reads the frozen earlier window. `data.range` /
      // `data.previousRange` are what this widget was actually captured over —
      // an older snapshot has neither, and used the report's own two windows.
      const compare =
        viz.compareSeries === true && data.previous
          ? {
              result: data.previous,
              range: data.previousRange ?? comparison,
              baseRange: data.range ?? dateRange,
              label: compareLabel,
            }
          : null;
      switch (viz.visualization) {
        case "number":
          return (
            <NumberViz
              cfg={viz}
              result={data.current}
              previous={data.previous}
              compareLabel={compareLabel}
              series={data.series}
              currency={currency}
            />
          );
        case "line":
          return <LineViz cfg={viz} result={data.current} currency={currency} compare={compare} />;
        case "area":
          return <AreaViz cfg={viz} result={data.current} currency={currency} compare={compare} />;
        case "bar":
          return <BarViz cfg={viz} result={data.current} currency={currency} />;
        case "combo":
          return <ComboViz cfg={viz} result={data.current} currency={currency} compare={compare} />;
        case "pie":
        case "donut":
          return <PieViz cfg={viz} result={data.current} currency={currency} />;
        case "table":
          return <TableViz cfg={viz} result={data.current} currency={currency} />;
        case "pivot":
          return <PivotViz cfg={viz} result={data.current} currency={currency} />;
      }
      break;
    }
    case "health":
      return <HealthGaugeReadout health={data.health} />;
    case "revenue":
      return <RevenueRoasReadout overview={data.overview} formatCurrency={money} />;
    case "attribution":
      return (
        <AttributionMiniChart
          comparison={data.comparison}
          modelA={readModel(config, "modelA", "first_touch")}
          modelB={readModel(config, "modelB", "last_touch")}
        />
      );
    case "cohorts":
      return <LtvCacReadout analysis={data.analysis} formatCurrency={money} />;
    case "cover": {
      const cover = readCoverConfig(config);
      return (
        <CoverBlock
          clientName={data.clientName}
          title={cover.title}
          subtitle={cover.subtitle}
          dateRange={dateRange}
        />
      );
    }
    case "text":
      return <AiSummaryBlock content={data.content} generated={data.generated} />;
  }
  return <Placeholder>Unsupported widget</Placeholder>;
}

/** Same chrome as the dashboard's WidgetFrame, without the edit affordances. */
export function SnapshotWidgetFrame({
  widget,
  currency,
  compareLabel,
  dateRange,
  comparison,
  fit = "fill",
}: {
  widget: SnapshotWidget;
  currency: string;
  compareLabel: string;
  dateRange: DateRange;
  comparison: DateRange;
  /** Defaults to the grid's fill-the-tile behaviour; the print page opts into "auto". */
  fit?: WidgetFit;
}) {
  const auto = fit === "auto";
  const def = getWidget(widget.type);
  if (!def) {
    return (
      <Panel className="h-full w-full grid place-items-center text-xs text-ink-muted">
        Unknown widget: {widget.type}
      </Panel>
    );
  }

  const title = def.getTitle ? def.getTitle(widget.config) : def.title;
  const filterLabel = describeWidgetFilters(readWidgetFilters(widget.config));

  // Same rule as the dashboard's WidgetFrame: page furniture (a section header,
  // an image) is not a card, so it gets no Panel and no title row.
  if (def.chromeless) {
    return (
      <div className={cn("w-full px-1", !auto && "h-full")}>
        <WidgetErrorBoundary>
          <SnapshotWidgetBody
            widget={widget}
            currency={currency}
            compareLabel={compareLabel}
            dateRange={dateRange}
            comparison={comparison}
          />
        </WidgetErrorBoundary>
      </div>
    );
  }

  return (
    <Panel className={cn("w-full flex flex-col", !auto && "h-full overflow-hidden")}>
      <div className="flex items-center gap-1.5 px-3 h-8 shrink-0 border-b border-hairline/60">
        <span className="text-[12px] font-medium text-ink-secondary truncate flex-1">{title}</span>
        {filterLabel && (
          <span
            title={filterLabel}
            className="inline-flex items-center gap-1 shrink-0 min-w-0 max-w-[45%] text-[10px] text-ink-muted bg-canvas-soft border border-hairline/60 rounded-full px-1.5 py-px"
          >
            <BiFilterAlt className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{filterLabel}</span>
          </span>
        )}
      </div>
      <div className={cn("p-3", !auto && "flex-1 min-h-0")}>
        <WidgetErrorBoundary>
          <SnapshotWidgetBody
            widget={widget}
            currency={currency}
            compareLabel={compareLabel}
            dateRange={dateRange}
            comparison={comparison}
          />
        </WidgetErrorBoundary>
      </div>
    </Panel>
  );
}

// --- Grid ------------------------------------------------------------------

export interface PlacedWidget {
  widget: SnapshotWidget;
  item: GridItem;
}

/**
 * Pairs each widget with its `lg` layout item. A widget the layout forgot is
 * appended full width below everything else rather than dropped.
 */
export function placeWidgets(snapshot: ViewSnapshot): PlacedWidget[] {
  const byKey = new Map(snapshot.layouts.lg?.map((item) => [item.i, item]) ?? []);
  let nextY = Math.max(0, ...(snapshot.layouts.lg ?? []).map((i) => i.y + i.h));

  const placed = snapshot.widgets.map((widget) => {
    const item = byKey.get(widget.i);
    if (item) return { widget, item };
    const fallback: GridItem = { i: widget.i, x: 0, y: nextY, w: COLUMNS, h: 6 };
    nextY += fallback.h;
    return { widget, item: fallback };
  });

  // Reading order — also the order of the single-column mobile stack.
  return placed.sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x);
}

export function ViewReport({ snapshot }: { snapshot: ViewSnapshot }) {
  const placed = placeWidgets(snapshot);

  const body =
    placed.length === 0 ? (
      <p className="text-[13px] text-ink-muted py-8 text-center">
        This view had no widgets when the report was created.
      </p>
    ) : (
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:auto-rows-[40px] lg:gap-4">
        {placed.map(({ widget, item }) => (
          <div
            key={widget.i}
            // grid-column/grid-row are inert in the mobile flex column, where the
            // explicit height keeps chart containers from collapsing to zero.
            style={
              {
                gridColumn: `${item.x + 1} / span ${item.w}`,
                gridRow: `${item.y + 1} / span ${item.h}`,
                "--widget-h": `${itemHeight(item.h)}px`,
              } as React.CSSProperties
            }
            className="min-w-0 h-[var(--widget-h)] lg:h-auto"
          >
            <SnapshotWidgetFrame
              widget={widget}
              currency={snapshot.currency}
              compareLabel={snapshot.comparisonLabel ?? DEFAULT_COMPARISON_LABEL}
              dateRange={snapshot.dateRange}
              comparison={snapshot.comparison}
            />
          </div>
        ))}
      </div>
    );

  // A report built from a report LAYOUT is a document, not a dashboard: the
  // same grid, narrowed to a page and set on paper. Dashboard-view reports
  // carry no `pageStyle` and render exactly as they always have.
  if (snapshot.pageStyle === "document") {
    return (
      <div className="mx-auto w-full max-w-[860px] rounded-xl border border-hairline bg-white shadow-sm px-5 py-6 sm:px-9 sm:py-10">
        {body}
      </div>
    );
  }

  return body;
}

/** Title + date range header shared by the in-app and public report views. */
export function ViewReportHeader({
  title,
  snapshot,
}: {
  title: string;
  snapshot: ViewSnapshot;
}) {
  // A document report's `viewName` is the report LAYOUT's name, which is
  // agency-internal — and the report already carries its own title. A
  // dashboard-view report still names the view it was taken from.
  const sourceName = snapshot.pageStyle === "document" ? null : snapshot.viewName;
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-[-0.3px] text-ink">{title}</h2>
      <p className="text-[12px] text-ink-muted mt-0.5">
        {formatDate(snapshot.dateRange.start)} — {formatDate(snapshot.dateRange.end)}
        {" · "}
        vs {formatDate(snapshot.comparison.start)} — {formatDate(snapshot.comparison.end)}
        {sourceName && ` · ${sourceName}`}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}
