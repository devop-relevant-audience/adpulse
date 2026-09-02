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
  "top-movers",
  "section",
  "image",
  "cover",
  "ai-summary",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Which grid a widget type may live on. `"both"` is the default and covers
 * every analytics widget — a KPI means the same thing on a dashboard and in a
 * report. `"report"` is for blocks that only make sense on a generated report
 * (a cover page, an AI summary written at generation time).
 *
 * This map is the SERVER-SAFE source of truth: `validateWidgetConfig` and
 * `resolveWidgets` read it, so a report-only block cannot be saved onto a
 * dashboard view. `WidgetDefinition.surface` in the (client-only) registry
 * mirrors it for the catalog — keep the two in step when adding a widget.
 */
export type WidgetSurface = "dashboard" | "report" | "both";

/** A concrete grid being validated or browsed — never the "both" wildcard. */
export type GridSurface = Exclude<WidgetSurface, "both">;

const WIDGET_SURFACES: Partial<Record<WidgetType, WidgetSurface>> = {
  cover: "report",
  "ai-summary": "report",
};

/** A widget type's surface. Anything unlisted is available on both grids. */
export function widgetSurface(type: string): WidgetSurface {
  return WIDGET_SURFACES[type as WidgetType] ?? "both";
}

/** Whether `type` may be added to / saved on `surface`. */
export function surfaceAllows(type: string, surface: WidgetSurface): boolean {
  if (surface === "both") return true;
  const allowed = widgetSurface(type);
  return allowed === "both" || allowed === surface;
}

/**
 * A widget's pinned date range, discriminated by shape:
 * - `{ preset: "mtd" }` — an id from `DATE_RANGE_PRESETS`, resolved to concrete
 *   dates at render time, so "Last 30 days" stays rolling.
 * - `{ start: "2026-05-01", end: "2026-05-31" }` — a fixed range (yyyy-MM-dd).
 */
export type WidgetDateRange = { preset: string } | { start: string; end: string };

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
  /** Date range override. Absent = follow the page's date picker. */
  dateRange?: WidgetDateRange;
}

export interface WidgetInstance {
  /** Unique key — matches the react-grid-layout item key (`i`). */
  i: string;
  type: WidgetType;
  /** Per-widget-type settings; shape is owned/validated by each widget. */
  config: Record<string, unknown>;
  /**
   * Set when this instance is linked to an `adpulse.saved_widgets` row (the
   * agency-wide library). The library row owns the config: it is NOT stored
   * inline for a linked instance — the server strips it on save and hydrates
   * `config` from the library row on read.
   */
  savedWidgetId?: string;
  /**
   * Transient client→server flag on the dashboards PUT: "also write this
   * instance's config back to the library row". Never stored, never served.
   */
  syncToLibrary?: boolean;
}

/** A library entry as the API serves it (snake_case, like every other row type). */
export interface SavedWidget {
  id: string;
  name: string;
  widget_type: WidgetType;
  config: Record<string, unknown>;
  updated_at: string;
}

/**
 * Where a library entry is referenced (`?action=usage`). Templates count too:
 * they store the same `savedWidgetId` pointer, so editing the entry changes what
 * a view stamped from the template will render. Report layouts and report
 * templates store the identical pointer, so they are listed alongside.
 */
export interface SavedWidgetUsage {
  /** Every kind below — everything an "update everywhere" would touch. */
  count: number;
  views: {
    dashboardId: string;
    dashboardName: string;
    clientId: string;
    clientName: string;
  }[];
  templates: {
    templateId: string;
    templateName: string;
  }[];
  reportLayouts: {
    layoutId: string;
    layoutName: string;
    clientId: string;
    clientName: string;
  }[];
  reportTemplates: {
    templateId: string;
    templateName: string;
  }[];
}

/** List-row shape for the template picker — no layouts/widgets payload. */
export interface DashboardTemplateSummary {
  id: string;
  name: string;
  description: string;
  widgetCount: number;
  updated_at: string;
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

/** Who may see a saved view: agency staff only, or the client too. */
export type DashboardVisibility = "internal" | "client";

export interface DashboardConfig {
  /**
   * Row id of the saved view. Absent/null for the built-in preset a client
   * that has never saved a dashboard renders — saving it creates the row.
   */
  id?: string | null;
  name: string;
  widgets: WidgetInstance[];
  layouts: DashboardLayouts;
  /** Config-shape version, so widget-config migrations are possible later. */
  version: number;
  visibility: DashboardVisibility;
  /** The view a client opens on. At most one per client (partial unique index). */
  isDefault: boolean;
}

/** List-row shape for the view switcher — no layouts/widgets payload. */
export interface DashboardSummary {
  id: string;
  name: string;
  visibility: DashboardVisibility;
  isDefault: boolean;
  updatedAt: string;
}

export const DASHBOARD_CONFIG_VERSION = 1;

// --- Report builder ---
// A report layout is a dashboard view's structure without the sharing knobs: it
// is agency-internal by definition, so there is no visibility and no default.
// It reuses the same widget/grid vocabulary, so a widget config means the same
// thing on a dashboard and in a report.

export interface ReportLayoutConfig {
  /** Row id of the saved layout. Absent only on a first save. */
  id?: string | null;
  name: string;
  widgets: WidgetInstance[];
  layouts: DashboardLayouts;
  version: number;
}

/** List-row shape for the layout list — no layouts/widgets payload. */
export interface ReportLayoutSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** List-row shape for the report-template picker — no layouts/widgets payload. */
export interface ReportTemplateSummary {
  id: string;
  name: string;
  description: string;
  widgetCount: number;
  updated_at: string;
}

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

/**
 * The size vocabulary, shared by the config dialog's picker and the Builder
 * Assistant. `label` is what a user reads on a button; `key` is the word the
 * assistant asks for, so "make it full width" and the ¾/Full buttons mean the
 * same four widths instead of drifting into two scales.
 */
export const WIDGET_SIZE_KEYS = ["quarter", "half", "three-quarters", "full"] as const;
export type WidgetSizeKey = (typeof WIDGET_SIZE_KEYS)[number];

// Column-span presets offered in the UI ("¼ / ½ / ¾ / full" on the lg grid).
export const SIZE_PRESETS = [
  { key: "quarter", label: "¼", w: 3 },
  { key: "half", label: "½", w: 6 },
  { key: "three-quarters", label: "¾", w: 9 },
  { key: "full", label: "Full", w: 12 },
] as const satisfies readonly { key: WidgetSizeKey; label: string; w: number }[];

/** Column span for each size word, on the 12-column `lg` grid. */
export const WIDGET_SIZE_WIDTH = Object.fromEntries(
  SIZE_PRESETS.map((p) => [p.key, p.w])
) as Record<WidgetSizeKey, number>;
