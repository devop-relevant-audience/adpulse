import type { DashboardLayouts, GridItem, WidgetInstance } from "./types";
import { DASHBOARD_CONFIG_VERSION } from "./types";
import { DEFAULT_TOP_MOVERS_CONFIG } from "./top-movers";

// The default report — cover → written summary → KPI row → trend → channel
// split and movers → campaign table, in the section order a monthly report is
// usually read in. It is the SEED for the master report template: the first
// time the master is asked for it is created from this, and after that the
// stored row is what a new report layout starts from.
//
// Demo-only blocks (revenue-roas, attribution-mini, ltv-cac) are deliberately
// absent: they read tables only seeded demo clients have, so a real client's
// report would render "not available" panels.
interface PresetEntry {
  widget: WidgetInstance;
  lg: Omit<GridItem, "i">;
  md: Omit<GridItem, "i">;
  sm: Omit<GridItem, "i">;
}

const PRESET: PresetEntry[] = [
  {
    widget: { i: "master-cover", type: "cover", config: { title: "Performance report" } },
    lg: { x: 0, y: 0, w: 12, h: 3 },
    md: { x: 0, y: 0, w: 8, h: 3 },
    sm: { x: 0, y: 0, w: 4, h: 3 },
  },
  {
    widget: { i: "master-summary", type: "ai-summary", config: {} },
    lg: { x: 0, y: 3, w: 12, h: 4 },
    md: { x: 0, y: 3, w: 8, h: 4 },
    sm: { x: 0, y: 3, w: 4, h: 4 },
  },
  {
    widget: {
      i: "master-sec-overview",
      type: "section",
      config: { title: "Performance overview", divider: true },
    },
    lg: { x: 0, y: 7, w: 12, h: 2 },
    md: { x: 0, y: 7, w: 8, h: 2 },
    sm: { x: 0, y: 7, w: 4, h: 2 },
  },
  {
    widget: { i: "master-kpi-spend", type: "kpi", config: { metric: "spend" } },
    lg: { x: 0, y: 9, w: 3, h: 3 },
    md: { x: 0, y: 9, w: 4, h: 3 },
    sm: { x: 0, y: 9, w: 2, h: 3 },
  },
  {
    widget: { i: "master-kpi-conversions", type: "kpi", config: { metric: "conversions" } },
    lg: { x: 3, y: 9, w: 3, h: 3 },
    md: { x: 4, y: 9, w: 4, h: 3 },
    sm: { x: 2, y: 9, w: 2, h: 3 },
  },
  {
    widget: { i: "master-kpi-cpa", type: "kpi", config: { metric: "cpa" } },
    lg: { x: 6, y: 9, w: 3, h: 3 },
    md: { x: 0, y: 12, w: 4, h: 3 },
    sm: { x: 0, y: 12, w: 2, h: 3 },
  },
  {
    widget: { i: "master-kpi-ctr", type: "kpi", config: { metric: "ctr" } },
    lg: { x: 9, y: 9, w: 3, h: 3 },
    md: { x: 4, y: 12, w: 4, h: 3 },
    sm: { x: 2, y: 12, w: 2, h: 3 },
  },
  {
    widget: { i: "master-trend", type: "trend", config: { metrics: ["spend", "conversions"] } },
    lg: { x: 0, y: 12, w: 12, h: 8 },
    md: { x: 0, y: 15, w: 8, h: 8 },
    sm: { x: 0, y: 15, w: 4, h: 7 },
  },
  {
    widget: {
      i: "master-sec-channels",
      type: "section",
      config: { title: "Channels & movers", divider: true },
    },
    lg: { x: 0, y: 20, w: 12, h: 2 },
    md: { x: 0, y: 23, w: 8, h: 2 },
    sm: { x: 0, y: 22, w: 4, h: 2 },
  },
  {
    widget: {
      i: "master-platforms",
      type: "platform-breakdown",
      config: { metric: "spend" },
    },
    lg: { x: 0, y: 22, w: 6, h: 7 },
    md: { x: 0, y: 25, w: 8, h: 6 },
    sm: { x: 0, y: 24, w: 4, h: 6 },
  },
  {
    widget: {
      i: "master-movers",
      type: "top-movers",
      config: { ...DEFAULT_TOP_MOVERS_CONFIG },
    },
    lg: { x: 6, y: 22, w: 6, h: 7 },
    md: { x: 0, y: 31, w: 8, h: 6 },
    sm: { x: 0, y: 30, w: 4, h: 6 },
  },
  {
    widget: {
      i: "master-sec-campaigns",
      type: "section",
      config: { title: "Campaigns", divider: true },
    },
    lg: { x: 0, y: 29, w: 12, h: 2 },
    md: { x: 0, y: 37, w: 8, h: 2 },
    sm: { x: 0, y: 36, w: 4, h: 2 },
  },
  {
    widget: {
      i: "master-campaigns",
      type: "campaign-table",
      config: { limit: 10, sortBy: "spend" },
    },
    lg: { x: 0, y: 31, w: 12, h: 8 },
    md: { x: 0, y: 39, w: 8, h: 8 },
    sm: { x: 0, y: 38, w: 4, h: 8 },
  },
];

/** The seed content for the master report template (no row id — it is content). */
export function buildDefaultReportLayout(): {
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version: number;
} {
  return {
    version: DASHBOARD_CONFIG_VERSION,
    widgets: PRESET.map((p) => ({ ...p.widget, config: { ...p.widget.config } })),
    layouts: {
      lg: PRESET.map((p) => ({ i: p.widget.i, ...p.lg })),
      md: PRESET.map((p) => ({ i: p.widget.i, ...p.md })),
      sm: PRESET.map((p) => ({ i: p.widget.i, ...p.sm })),
    },
  };
}
