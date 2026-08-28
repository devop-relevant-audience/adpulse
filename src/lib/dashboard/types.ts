// Types for the customizable dashboard: widget instances + react-grid-layout
// layout, persisted as JSON on the `dashboards` table (added in stage 3). The
// `widgets`/`layouts` blobs are nested JSON and cross the Drizzle case boundary
// untouched (same rule as raw_payload / retention).

import type { Platform } from "@/lib/types/database";

export const WIDGET_TYPES = [
  "kpi",
  "trend",
  "platform-breakdown",
  "campaign-table",
  "health-gauge",
  "funnel",
  "revenue-roas",
  "attribution-mini",
  "ltv-cac",
  "note",
  "custom",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Optional per-widget data filter stored at `WidgetInstance.config.filters`.
 * Read/normalize it with `src/lib/dashboard/filters.ts` — never trust the raw
 * JSON shape. Empty arrays are never persisted (the key is dropped instead).
 */
export interface WidgetFilters {
  /** Platforms to include. Empty/absent = follow the page's platform selector. */
  platforms?: Platform[];
  /** Campaign ids to include. Empty/absent = all campaigns. */
  campaignIds?: string[];
}

export interface WidgetInstance {
  /** Unique key — matches the react-grid-layout item key (`i`). */
  i: string;
  type: WidgetType;
  /** Per-widget-type settings; shape is owned/validated by each widget. */
  config: Record<string, unknown>;
}

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export const BREAKPOINTS = ["lg", "md", "sm"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

export type DashboardLayouts = Record<Breakpoint, GridItem[]>;

export interface DashboardConfig {
  name: string;
  widgets: WidgetInstance[];
  layouts: DashboardLayouts;
  /** Config-shape version, so widget-config migrations are possible later. */
  version: number;
}

export const DASHBOARD_CONFIG_VERSION = 1;

// Props contracts shared by widget render components and their config forms.
// Kept here (not in the registry) to avoid a registry↔widget import cycle.
export interface WidgetRenderProps {
  config: Record<string, unknown>;
  instanceId: string;
}

export interface WidgetConfigFormProps {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

// Grid geometry — shared by the host and layout helpers.
export const GRID_COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 };
export const GRID_BREAKPOINTS: Record<Breakpoint, number> = { lg: 1024, md: 640, sm: 0 };
export const GRID_ROW_HEIGHT = 40;
// Inter-widget gutter (x, y).
export const GRID_MARGIN: [number, number] = [16, 16];
// Grid outer padding (x, y). Kept at 0 so the widget grid spans the SAME
// content box as the dashboard header/toolbar above it — otherwise RGL
// defaults containerPadding to `margin`, insetting the grid 16px on every side
// and misaligning it against the full-width header (inconsistent gutters).
export const GRID_CONTAINER_PADDING: [number, number] = [0, 0];

// Column-span presets offered in the UI ("¼ / ½ / ¾ / full" on the lg grid).
export const SIZE_PRESETS = [
  { label: "¼", w: 3 },
  { label: "½", w: 6 },
  { label: "¾", w: 9 },
  { label: "Full", w: 12 },
] as const;
