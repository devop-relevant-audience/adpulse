import type { DashboardConfig, GridItem, WidgetInstance } from "./types";
import { DASHBOARD_CONFIG_VERSION } from "./types";

// The default dashboard — mirrors the classic fixed layout (KPI row → trend →
// platform breakdown) so a client with no saved dashboard sees a sensible page
// and nothing regresses. Stage 2 enriches this with the campaign table / health
// gauge once those widgets are registered.
interface PresetEntry {
  widget: WidgetInstance;
  lg: Omit<GridItem, "i">;
  md: Omit<GridItem, "i">;
  sm: Omit<GridItem, "i">;
}

const PRESET: PresetEntry[] = [
  {
    widget: { i: "kpi-spend", type: "kpi", config: { metric: "spend" } },
    lg: { x: 0, y: 0, w: 3, h: 3 },
    md: { x: 0, y: 0, w: 4, h: 3 },
    sm: { x: 0, y: 0, w: 2, h: 3 },
  },
  {
    widget: { i: "kpi-conversions", type: "kpi", config: { metric: "conversions" } },
    lg: { x: 3, y: 0, w: 3, h: 3 },
    md: { x: 4, y: 0, w: 4, h: 3 },
    sm: { x: 2, y: 0, w: 2, h: 3 },
  },
  {
    widget: { i: "kpi-cpa", type: "kpi", config: { metric: "cpa" } },
    lg: { x: 6, y: 0, w: 3, h: 3 },
    md: { x: 0, y: 3, w: 4, h: 3 },
    sm: { x: 0, y: 3, w: 2, h: 3 },
  },
  {
    widget: { i: "kpi-ctr", type: "kpi", config: { metric: "ctr" } },
    lg: { x: 9, y: 0, w: 3, h: 3 },
    md: { x: 4, y: 3, w: 4, h: 3 },
    sm: { x: 2, y: 3, w: 2, h: 3 },
  },
  {
    widget: { i: "trend-main", type: "trend", config: { metrics: ["spend", "conversions"] } },
    lg: { x: 0, y: 3, w: 8, h: 9 },
    md: { x: 0, y: 6, w: 8, h: 8 },
    sm: { x: 0, y: 6, w: 4, h: 7 },
  },
  {
    widget: { i: "platform-split", type: "platform-breakdown", config: { metric: "spend" } },
    lg: { x: 8, y: 3, w: 4, h: 9 },
    md: { x: 0, y: 14, w: 8, h: 7 },
    sm: { x: 0, y: 13, w: 4, h: 7 },
  },
];

export function buildDefaultDashboard(name = "Default"): DashboardConfig {
  return {
    name,
    version: DASHBOARD_CONFIG_VERSION,
    widgets: PRESET.map((p) => ({ ...p.widget, config: { ...p.widget.config } })),
    layouts: {
      lg: PRESET.map((p) => ({ i: p.widget.i, ...p.lg })),
      md: PRESET.map((p) => ({ i: p.widget.i, ...p.md })),
      sm: PRESET.map((p) => ({ i: p.widget.i, ...p.sm })),
    },
  };
}
