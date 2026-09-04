"use client";

// Paper renderer for a frozen ViewSnapshot. Same widgets, same frozen numbers
// and the same presentational components as `view-report.tsx` — only the layout
// differs: the dashboard's fixed 40px-row grid becomes a linear stack of rows,
// because a PDF has pages, not a viewport, and a tile that clips its content on
// screen simply loses it on paper.
//
// A headless Chrome loads `/print/reports/[id]` and prints it; a signed-in human
// can open the same URL and hit Ctrl+P. Both read the flag this component sets:
//   html[data-print-ready="true"]

import { useEffect, useMemo } from "react";
import {
  ViewReportHeader,
  SnapshotWidgetFrame,
  itemHeight,
  placeWidgets,
  type PlacedWidget,
  type WidgetFit,
} from "@/components/reports/view-report";
import { PrintModeProvider } from "@/components/dashboard/print-mode";
import { DEFAULT_COMPARISON_LABEL, metricWidgetPlan } from "@/lib/reports/view-snapshot";
import type { SnapshotWidget, ViewSnapshot } from "@/lib/reports/view-snapshot";

/** A4 portrait at 96dpi (794px) less the 12mm side margins of `@page`. */
const CONTENT_WIDTH = 700;
/** Gutter between two widgets sharing a row, and between rows. */
const COL_GAP = 12;
const ROW_GAP = 16;

/** Grid columns, matching the `lg` layout the snapshot stores. */
const COLUMNS = 12;

// A chart needs a measurable box for Recharts' ResponsiveContainer, so it keeps
// the height the grid asked for — clamped, because a 2-row chart is unreadable
// and a 14-row one would eat a whole page on its own.
const MIN_FIXED_HEIGHT = 120;
const MAX_FIXED_HEIGHT = 420;

/**
 * Widget types whose body is text or a list: they have no intrinsic height and
 * every line matters, so they grow instead of scrolling inside a fixed tile.
 * Tables are decided further down, from the frozen visualization.
 */
const AUTO_HEIGHT_TYPES = new Set<SnapshotWidget["type"]>([
  "cover",
  "ai-summary",
  "note",
  "section",
  "top-movers",
]);

/**
 * Fixed height or natural height, per widget.
 *
 * `"auto"` — prose and lists (above) plus any table: a campaign table cut off
 * after eight of its twenty rows is a wrong report, not a cramped one.
 * `"fill"` — everything with a drawn shape: the Recharts visualizations, the
 * funnel bars, the health gauge, the attribution/LTV readouts and the KPI
 * number. These size themselves to their container, so they need one.
 */
function widgetFit(widget: SnapshotWidget): WidgetFit {
  if (AUTO_HEIGHT_TYPES.has(widget.type)) return "auto";
  // Prefer the plan frozen at build time, exactly as the on-screen renderer does.
  const viz = widget.viz ?? metricWidgetPlan(widget.type, widget.config)?.viz;
  if (viz && (viz.visualization === "table" || viz.visualization === "pivot")) return "auto";
  return "fill";
}

/** Consecutive widgets sharing a grid `y` are one visual row. */
function groupIntoRows(placed: PlacedWidget[]): PlacedWidget[][] {
  const rows: PlacedWidget[][] = [];
  for (const entry of placed) {
    const row = rows[rows.length - 1];
    if (row && row[0].item.y === entry.item.y) row.push(entry);
    else rows.push([entry]);
  }
  return rows;
}

/**
 * The row's page-break behaviour. A cover owns its page; a section header must
 * not be the last thing on one. A row that is a single growing block — a long
 * campaign table, an AI summary — is allowed to break across pages, because
 * holding it together would push a taller-than-a-page block to the next page
 * and still overflow it.
 */
function rowClass(row: PlacedWidget[], fits: WidgetFit[]): string {
  if (row.some((p) => p.widget.type === "cover")) return "print-row print-row--cover";
  if (row.some((p) => p.widget.type === "section")) return "print-row print-row--section";
  if (row.length === 1 && fits[0] === "auto") return "print-row print-row--flow";
  return "print-row";
}

/**
 * A widget's share of the row: its column span out of twelve, taken from what
 * is left once the gutters are removed, so a 6+6 row still reads as two halves.
 */
function basis(w: number, gutters: number): string {
  const ratio = Math.min(w, COLUMNS) / COLUMNS;
  return `calc((100% - ${gutters}px) * ${ratio.toFixed(6)})`;
}

/**
 * Sets `html[data-print-ready="true"]` once the tree has mounted AND the browser
 * has painted twice — Recharts sizes itself off a ResizeObserver, so one frame
 * after mount its containers are still measuring and the charts are empty boxes.
 */
function usePrintReady() {
  useEffect(() => {
    let cancelled = false;
    let outer = 0;
    let inner = 0;
    // Fonts first: a late webfont swap reflows every label after the flag.
    document.fonts.ready.then(() => {
      if (cancelled) return;
      outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          if (!cancelled) document.documentElement.dataset.printReady = "true";
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      delete document.documentElement.dataset.printReady;
    };
  }, []);
}

export function PrintReport({ snapshot, title }: { snapshot: ViewSnapshot; title: string }) {
  usePrintReady();

  const rows = useMemo(() => groupIntoRows(placeWidgets(snapshot)), [snapshot]);

  // A document report opens on its cover block, which already prints the title
  // and the period — a header above it would say all of it twice. A
  // dashboard-view report has no cover, so it gets the same header the
  // on-screen renderer draws.
  const showHeader = snapshot.pageStyle !== "document";

  return (
    <PrintModeProvider>
      <style>{PRINT_STYLES}</style>
      <div className="print-doc">
        {showHeader && (
          <div className="print-header">
            <ViewReportHeader title={title} snapshot={snapshot} />
          </div>
        )}

        {rows.length === 0 && (
          <p className="text-[13px] text-ink-muted py-8 text-center">
            This view had no widgets when the report was created.
          </p>
        )}

        {rows.map((row) => {
          const gutters = COL_GAP * (row.length - 1);
          const fits = row.map((p) => widgetFit(p.widget));
          return (
            <div key={row[0].widget.i} className={rowClass(row, fits)}>
              {row.map(({ widget, item }, i) => {
                const fit = fits[i];
                return (
                  <div
                    key={widget.i}
                    style={{
                      flex: `0 1 ${basis(item.w, gutters)}`,
                      minWidth: 0,
                      ...(fit === "fill"
                        ? {
                            height: Math.min(
                              MAX_FIXED_HEIGHT,
                              Math.max(MIN_FIXED_HEIGHT, itemHeight(item.h))
                            ),
                          }
                        : {}),
                    }}
                  >
                    <SnapshotWidgetFrame
                      widget={widget}
                      currency={snapshot.currency}
                      compareLabel={snapshot.comparisonLabel ?? DEFAULT_COMPARISON_LABEL}
                      dateRange={snapshot.dateRange}
                      comparison={snapshot.comparison}
                      fit={fit}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </PrintModeProvider>
  );
}

// Pagination rules. Screen and print both use them so what a human sees in the
// browser is what Chrome's PDF function produces.
const PRINT_STYLES = `
.print-doc {
  width: ${CONTENT_WIDTH}px;
  margin: 0 auto;
  padding: 16px 0 24px;
  background: #fff;
}
.print-header { margin-bottom: ${ROW_GAP}px; break-after: avoid; page-break-after: avoid; }
.print-row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: ${COL_GAP}px;
  break-inside: avoid;
  page-break-inside: avoid;
}
.print-row + .print-row { margin-top: ${ROW_GAP}px; }
/* The cover is page one on its own. */
.print-row--cover { break-after: page; page-break-after: always; }
/* A heading stays with the band it labels. */
.print-row--section { break-after: avoid; page-break-after: avoid; }
/* A lone growing block (a long table, an AI summary) flows across pages. */
.print-row--flow { break-inside: auto; page-break-inside: auto; }
/* A long table repeats its header on each page and never splits a row. Sticky
   positioning is a scroll affordance and would defeat table-header-group. */
.print-doc table { break-inside: auto; }
.print-doc thead { display: table-header-group; position: static; }
.print-doc th, .print-doc td { position: static; }
.print-doc tr { break-inside: avoid; page-break-inside: avoid; }
`;
