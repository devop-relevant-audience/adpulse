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
//   event: status  data: {"message":"…"}        what the route is doing right
//                                               now, shown until text arrives
//   event: error   data: {"message":"…"}        stream-level failure (the HTTP
//                                               status was already 200 by then)
//   event: done    data: {}                     terminal frame, always last
//
// Pre-stream failures (auth, rate limit, missing API key, bad payload) are
// ordinary JSON responses with a non-200 status and an `error` string.

import type { BuilderWidgetType } from "@/lib/builder/widget-kinds";
import type { WidgetSizeKey } from "@/lib/dashboard/types";

export const BUILDER_EVENTS = [
  "delta",
  "widget",
  "widget_update",
  "widget_remove",
  "status",
  "error",
  "done",
] as const;
export type BuilderEventName = (typeof BUILDER_EVENTS)[number];

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
   * dialog offers. Absent = use the widget type's natural footprint.
   */
  size?: WidgetSizeKey;
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
}
