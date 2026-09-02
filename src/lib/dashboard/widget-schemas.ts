// Server-safe validation of persisted widget configs (dashboards PUT).
// zod only — no React, no widget-registry import (that file is client code).

import { z } from "zod";
import { WIDGET_TYPES, surfaceAllows } from "@/lib/dashboard/types";
import type { WidgetSurface } from "@/lib/dashboard/types";
import { customWidgetConfigSchema } from "@/lib/dashboard/custom-widget";
import { widgetFiltersSchema } from "@/lib/dashboard/filters";
import {
  AI_SUMMARY_INSTRUCTIONS_MAX,
  COVER_SUBTITLE_MAX,
  COVER_TITLE_MAX,
} from "@/lib/dashboard/report-blocks";

// Every non-custom widget: only the shared `filters` shape is enforced (strict:
// platforms, campaignIds and the `dateRange` override, nothing else); the
// remaining keys are owned by the widget and passed through untouched.
const looseWidgetConfigSchema = z.looseObject({
  filters: widgetFiltersSchema.optional(),
});

/**
 * A widget instance as it arrives on the dashboards PUT.
 *
 * `savedWidgetId` links the instance to an `adpulse.saved_widgets` row, which
 * then OWNS the config: the route strips the inline config before storing and
 * hydrates it back on read. `syncToLibrary` is a transient client flag meaning
 * "also write this config back to the library row" — never stored, never
 * served. Both are validated here so the route's payload schema stays one
 * source of truth.
 */
export const widgetInstanceSchema = z.object({
  i: z.string(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  savedWidgetId: z.string().uuid().optional(),
  syncToLibrary: z.boolean().optional(),
});

export type WidgetInstancePayload = z.infer<typeof widgetInstanceSchema>;

/** One react-grid-layout item, as persisted on a dashboard view or report layout. */
export const gridItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
  maxW: z.number().optional(),
  maxH: z.number().optional(),
  static: z.boolean().optional(),
  moved: z.boolean().optional(),
});

/**
 * Upper bound on one grid's widgets (and on each breakpoint's layout items). A
 * hand-built view or report holds a couple of dozen; the cap just keeps a
 * hostile payload from turning into an unbounded jsonb column.
 */
export const MAX_WIDGETS = 60;

/** The three-breakpoint layouts blob both grids persist. */
export const gridLayoutsSchema = z.object({
  lg: z.array(gridItemSchema).max(MAX_WIDGETS),
  md: z.array(gridItemSchema).max(MAX_WIDGETS),
  sm: z.array(gridItemSchema).max(MAX_WIDGETS),
});

/**
 * Report-only blocks. Both are STRICT (unknown keys are dropped, not passed
 * through) — they carry no data query, so there is no `filters` shape to keep
 * and nothing a widget could own beyond what is declared here. The client name
 * and the reporting period are context, frozen at generation time, never config.
 */
const coverConfigSchema = z.object({
  title: z.string().max(COVER_TITLE_MAX).optional(),
  subtitle: z.string().max(COVER_SUBTITLE_MAX).optional(),
});

/** The prompt steer for the AI summary; the text itself is written at generation. */
const aiSummaryConfigSchema = z.object({
  instructions: z.string().max(AI_SUMMARY_INSTRUCTIONS_MAX).optional(),
});

const STRICT_CONFIG_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  cover: coverConfigSchema,
  "ai-summary": aiSummaryConfigSchema,
};

export type WidgetConfigValidation =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Validates one widget's persisted config.
 *
 * `surface` is the grid the config is being saved onto: a report-only block
 * (cover, AI summary) is rejected on `"dashboard"` and accepted on `"report"`.
 * The default `"both"` imposes no surface restriction — that is what the
 * saved-widget library uses, since a library entry belongs to no grid.
 */
export function validateWidgetConfig(
  type: string,
  config: unknown,
  surface: WidgetSurface = "both"
): WidgetConfigValidation {
  if (!surfaceAllows(type, surface)) {
    return { ok: false, issues: [`widget type "${type}" is not available on a ${surface}`] };
  }

  // "custom" first so this works whether or not WIDGET_TYPES lists it yet.
  if (type === "custom") {
    const result = customWidgetConfigSchema.safeParse(config);
    return result.success
      ? { ok: true, config: { ...result.data } }
      : { ok: false, issues: formatIssues(result.error) };
  }

  if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
    return { ok: false, issues: ["unknown widget type"] };
  }

  const strict = STRICT_CONFIG_SCHEMAS[type];
  if (strict) {
    const parsed = strict.safeParse(config);
    return parsed.success
      ? { ok: true, config: { ...parsed.data } }
      : { ok: false, issues: formatIssues(parsed.error) };
  }

  const result = looseWidgetConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, config: result.data }
    : { ok: false, issues: formatIssues(result.error) };
}
