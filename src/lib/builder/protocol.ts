// Wire contract for the Builder Assistant (POST /api/builder), shared by the
// route and the panel so the event names exist in exactly one place.
//
// The response is an SSE stream of NAMED events (the AI chat route uses
// anonymous `data:` frames; the builder needs to distinguish prose from a
// created widget, so each frame carries an `event:` line):
//
//   event: delta   data: {"content":"…"}        assistant text, token by token
//   event: widget  data: {"config":…,"title":…} a widget was created and is
//                                               valid — the panel inserts it
//   event: widget_update
//                  data: {"widgetId":…,…}       an EXISTING widget's config was
//                                               rewritten — the panel applies it
//   event: widget_remove
//                  data: {"widgetId":…,"title":…}
//                                               a widget was taken off the view
//   event: widget_resize
//                  data: {"widgetId":…,"width":…,"height":…}
//                                               a widget's footprint changed and
//                                               nothing else did
//   event: widget_arrange
//                  data: {"widgetIds":[…],"titles":[…]}
//                                               widgets were put side by side on
//                                               one row
//   event: status  data: {"message":"…"}        what the route is doing right
//                                               now, shown until text arrives
//   event: error   data: {"message":"…"}        stream-level failure (the HTTP
//                                               status was already 200 by then)
//   event: done    data: {}                     terminal frame, always last
//
// Pre-stream failures (auth, rate limit, missing API key, bad payload) are
// ordinary JSON responses with a non-200 status and an `error` string.

import type { BuilderWidgetType } from "@/lib/builder/widget-kinds";
import type { GridSurface, WidgetHeightKey, WidgetSizeKey } from "@/lib/dashboard/types";

/**
 * Which grid the assistant is pointed at. All four hold the identical widget
 * vocabulary — the same instances, the same three-breakpoint layouts — so the
 * route, the prompt and the panel differ only in wording and in which widget
 * types the surface allows:
 *
 * - `dashboard-view`     — one client's saved dashboard view
 * - `report-layout`      — one client's report layout (the report builder)
 * - `dashboard-template` — the master dashboard template (what a client with no
 *                          saved view renders)
 * - `report-template`    — the master report template (what a new report layout
 *                          starts from)
 */
export const BUILDER_GRID_KINDS = [
  "dashboard-view",
  "report-layout",
  "dashboard-template",
  "report-template",
] as const;
export type BuilderGridKind = (typeof BUILDER_GRID_KINDS)[number];

/** The widget surface a grid kind validates against (`widgetSurface()`'s vocabulary). */
export function builderGridSurface(kind: BuilderGridKind): GridSurface {
  return kind === "report-layout" || kind === "report-template" ? "report" : "dashboard";
}

/** Whether a grid kind is one of the two agency-wide master templates. */
export function isBuilderTemplateKind(kind: BuilderGridKind): boolean {
  return kind === "dashboard-template" || kind === "report-template";
}

export const BUILDER_EVENTS = [
  "delta",
  "widget",
  "widget_update",
  "widget_remove",
  "widget_resize",
  "widget_arrange",
  "status",
  "error",
  "done",
] as const;
export type BuilderEventName = (typeof BUILDER_EVENTS)[number];

/**
 * One image attached to a user message. The panel uploads the file through
 * `POST /api/assets` first, so what travels here — and on to the model — is a
 * public Blob URL, never bytes.
 */
export interface BuilderAttachment {
  /**
   * Public Vercel Blob URL under `adpulse/uploads/`. The route refuses anything
   * else (`isAdpulseUploadUrl`), so this cannot be used to point the model's
   * fetcher at an arbitrary host.
   */
  url: string;
  /** Original filename. Panel-only — it is never sent to the route. */
  name?: string;
}

/** Images per message, and per request once the thread is replayed. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_ATTACHMENTS_PER_REQUEST = 8;

export interface BuilderDeltaEvent {
  content: string;
}

export interface BuilderWidgetEvent {
  /** Which widget to insert. `custom` is the chart builder; see widget-kinds.ts. */
  type: BuilderWidgetType;
  /** Validated against that type's strict builder schema: safe to insert and to PUT as-is. */
  config: Record<string, unknown>;
  /** `builderWidgetTitle(type, config)` — the title the grid will show. */
  title: string;
  /**
   * Column span the assistant asked for, in the same four steps the config
   * dialog offers. Absent = use the widget type's natural width.
   */
  width?: WidgetSizeKey;
  /**
   * Row count the assistant asked for. Absent = use the widget type's natural
   * height, which is what almost every widget wants.
   */
  height?: WidgetHeightKey;
}

/**
 * Same payload as a creation, plus which widget on the grid it replaces. `type`
 * is the target's OWN type — an edit changes a widget's settings, never its kind.
 */
export interface BuilderWidgetUpdateEvent extends BuilderWidgetEvent {
  /** Grid instance id (`WidgetInstance.i`), taken from the inventory below. */
  widgetId: string;
}

/** A widget the assistant took off the view. */
export interface BuilderWidgetRemoveEvent {
  /** Grid instance id, from the inventory below — editable or not. */
  widgetId: string;
  /** The title it had, so the panel's card names it after it is gone. */
  title: string;
}

/**
 * A widget the assistant resized and did not otherwise touch. Separate from
 * `widget_update` because a resize carries no config: the panel must not rewrite
 * settings the user may have edited since, and a widget whose config the builder
 * cannot parse can still be resized.
 */
export interface BuilderWidgetResizeEvent {
  /** Grid instance id, from the inventory below — editable or not. */
  widgetId: string;
  /** Its current title, for the panel's card. */
  title: string;
  /** At least one of the two is always present. */
  width?: WidgetSizeKey;
  height?: WidgetHeightKey;
}

/**
 * Widgets the assistant put side by side on one row, left to right in this
 * order. Positions are never sent: the grid compacts vertically, so the row
 * ordering is the only thing that survives a render (see
 * `src/lib/dashboard/arrange.ts`).
 */
export interface BuilderWidgetArrangeEvent {
  /** Two or more grid instance ids, in the left-to-right order asked for. */
  widgetIds: string[];
  /** Their titles in the same order, so the card can name the row. */
  titles: string[];
}

/**
 * A one-line note about what the route is doing. Tool rounds can run for tens
 * of seconds before the first token, so the panel shows the latest of these
 * instead of a bare "Working…". Superseded by the next one, dropped once the
 * answer starts.
 */
export interface BuilderStatusEvent {
  message: string;
}

export interface BuilderErrorEvent {
  message: string;
}

/**
 * One widget currently on the open dashboard view, sent up with the request so
 * the assistant can be asked to change "the spend chart" by name.
 *
 * The client decides what is editable: `config` is present only for widget
 * types the builder has a schema for (`BUILDER_WIDGET_TYPES`) that are NOT
 * linked to the saved-widget library. A linked instance stores no inline config
 * (the library row owns it and the dashboards PUT strips whatever is sent), so
 * an inline edit would be silently discarded.
 */
export interface BuilderWidgetRef {
  /** Grid instance id. */
  i: string;
  /** What the grid shows in the widget's title bar. */
  title: string;
  /** Widget type, so the model can explain what it cannot touch. */
  type: string;
  /** Present iff the assistant may rewrite this widget — its current config. */
  config?: Record<string, unknown>;
  /** Short reason the widget is read-only, when `config` is absent. */
  locked?: string;
  /**
   * Where the widget sits on the DESKTOP (`lg`) grid right now, in grid units.
   * Without it the assistant can only size widgets one at a time, in isolation
   * — "put these two in one row" needs to know which row each is on and whether
   * their widths add up. Sent for every widget, editable or not, because both
   * resizing and arranging work on read-only ones too.
   *
   * The narrow breakpoints are deliberately NOT sent: they are derived from the
   * same request by the store, and describing three grids would triple the
   * prompt for a page the user is not looking at.
   */
  layout?: { x: number; y: number; w: number; h: number };
}
