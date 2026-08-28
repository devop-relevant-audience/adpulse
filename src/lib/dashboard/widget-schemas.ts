// Server-safe validation of persisted widget configs (dashboards PUT).
// zod only — no React, no widget-registry import (that file is client code).

import { z } from "zod";
import { WIDGET_TYPES } from "@/lib/dashboard/types";
import { customWidgetConfigSchema, widgetFiltersSchema } from "@/lib/dashboard/custom-widget";

// Every non-custom widget: only the shared `filters` shape is enforced; the
// remaining keys are owned by the widget and passed through untouched.
const looseWidgetConfigSchema = z.looseObject({
  filters: widgetFiltersSchema.optional(),
});

export type WidgetConfigValidation =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function validateWidgetConfig(type: string, config: unknown): WidgetConfigValidation {
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

  const result = looseWidgetConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, config: result.data }
    : { ok: false, issues: formatIssues(result.error) };
}
