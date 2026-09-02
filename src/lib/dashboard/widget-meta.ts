// Server-safe widget metadata: the display name and the default grid footprint
// of every widget type. Pure data — no React, no zod — so server code (the
// Builder Assistant route) can name and size a widget without importing the
// widget registry, which is client-only.
//
// The registry SPREADS these entries into its definitions, so a widget's name
// and its default footprint exist exactly once. Change a size here and the
// catalog tile, the grid and the assistant all move together.

import type { WidgetType } from "@/lib/dashboard/types";

/** A widget's grid footprint on the 12-column `lg` grid. */
export interface WidgetFootprint {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export interface WidgetMeta {
  /** The widget's name — its catalog tile, and its title bar when it has no dynamic one. */
  title: string;
  defaultSize: WidgetFootprint;
}

export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  custom: { title: "Custom widget", defaultSize: { w: 6, h: 7, minW: 3, minH: 3 } },
  kpi: { title: "KPI Stat", defaultSize: { w: 3, h: 3, minW: 2, minH: 3 } },
  trend: { title: "Trend Chart", defaultSize: { w: 8, h: 9, minW: 4, minH: 6 } },
  "platform-breakdown": {
    title: "Platform Breakdown",
    defaultSize: { w: 4, h: 7, minW: 3, minH: 5 },
  },
  "campaign-table": { title: "Campaign Table", defaultSize: { w: 6, h: 8, minW: 4, minH: 5 } },
  "health-gauge": { title: "Health Score", defaultSize: { w: 4, h: 8, minW: 3, minH: 6 } },
  funnel: { title: "Conversion Funnel", defaultSize: { w: 6, h: 7, minW: 4, minH: 5 } },
  "revenue-roas": { title: "Revenue & ROAS", defaultSize: { w: 3, h: 3, minW: 3, minH: 3 } },
  "attribution-mini": {
    title: "Attribution Models",
    defaultSize: { w: 6, h: 8, minW: 4, minH: 6 },
  },
  "ltv-cac": { title: "LTV : CAC", defaultSize: { w: 6, h: 7, minW: 4, minH: 5 } },
  note: { title: "Note", defaultSize: { w: 4, h: 4, minW: 2, minH: 2 } },
  "top-movers": { title: "Top movers", defaultSize: { w: 4, h: 7, minW: 3, minH: 4 } },
  section: { title: "Section header", defaultSize: { w: 12, h: 2, minW: 3, minH: 1 } },
  image: { title: "Image", defaultSize: { w: 4, h: 5, minW: 2, minH: 2 } },
  cover: { title: "Cover", defaultSize: { w: 12, h: 3, minW: 4, minH: 2 } },
  "ai-summary": { title: "AI summary", defaultSize: { w: 12, h: 4, minW: 4, minH: 3 } },
};
