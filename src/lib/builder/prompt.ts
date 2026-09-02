// System prompt for the Builder Assistant. Everything the model is told about
// the custom-widget contract is DERIVED from `src/lib/dashboard/custom-widget.ts`
// at module load — the JSON schema from the zod schema, the per-visualization
// rules table from VISUALIZATION_RULES/VISUALIZATION_OPTIONS, the metric
// vocabulary from QUERY_METRIC_META, the size words from SIZE_PRESETS (the same
// four the config dialog offers) — so the prompt cannot drift from what the
// dashboards PUT will actually accept. Pure TypeScript, server-side only.
//
// The one per-request part is the inventory of widgets already on the view,
// which is what makes "turn the spend chart into a donut" resolvable.

import { z } from "zod";
import {
  CUSTOM_VISUALIZATIONS,
  QUERY_METRIC_META,
  QUERY_METRICS,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_LIMIT,
  VISUALIZATION_LABELS,
  VISUALIZATION_OPTIONS,
  VISUALIZATION_RULES,
  customWidgetConfigSchema,
  type CustomWidgetConfig,
} from "@/lib/dashboard/custom-widget";
import { GRID_COLS, SIZE_PRESETS } from "@/lib/dashboard/types";
import { PLATFORMS } from "@/lib/types/database";
import type { ClientDataFacts } from "@/lib/data/queries";
import { builderTypesPromptBlock } from "@/lib/builder/widget-kinds";
import type { BuilderWidgetRef } from "@/lib/builder/protocol";

/**
 * JSON Schema for the config object. `z.toJSONSchema` walks the base object
 * (the `.superRefine` cross-field rules are not expressible in JSON Schema, so
 * they are stated as the rules table below instead). `$schema` is dropped: the
 * model reads this as documentation, not as a validator input.
 */
function configJsonSchema(): string {
  const schema = z.toJSONSchema(customWidgetConfigSchema) as Record<string, unknown>;
  delete schema.$schema;
  return JSON.stringify(schema);
}

/** One row per visualization: what the superRefine will and won't accept. */
function rulesTable(): string {
  const header =
    "| visualization | groupBy | timeBucket | max metrics (ungrouped / grouped) | display options |\n" +
    "| --- | --- | --- | --- | --- |";
  const rows = CUSTOM_VISUALIZATIONS.map((v) => {
    const rule = VISUALIZATION_RULES[v];
    const options = VISUALIZATION_OPTIONS[v];
    return `| ${v} | ${rule.groupBy.join(", ")} | ${rule.timeBucket.join(", ")} | ${rule.maxMetrics} / ${rule.maxMetricsWhenGrouped} | ${options.length ? options.join(", ") : "—"} |`;
  });
  return [header, ...rows].join("\n");
}

/** Metric ids with their label, display format and revenue dependency. */
function metricVocabulary(): string {
  return QUERY_METRICS.map((m) => {
    const meta = QUERY_METRIC_META[m];
    const notes = [meta.format, meta.invert ? "lower is better" : null, meta.requiresRevenue ? "needs revenue tracking" : null]
      .filter(Boolean)
      .join(", ");
    return `- ${m} — ${meta.label} (${notes})`;
  }).join("\n");
}

/**
 * Worked examples. Typed as CustomWidgetConfig so a rule change that
 * invalidates one is a type error here rather than a bad suggestion at runtime.
 */
const EXAMPLES: { ask: string; config: CustomWidgetConfig }[] = [
  {
    ask: "total spend this period",
    config: {
      visualization: "number",
      metrics: ["spend"],
      groupBy: "none",
      timeBucket: "none",
      limit: QUERY_DEFAULT_LIMIT,
      sortBy: "spend",
      sortDir: "desc",
      sparkline: true,
      showComparison: true,
    },
  },
  {
    ask: "spend share by platform",
    config: {
      visualization: "donut",
      metrics: ["spend"],
      groupBy: "platform",
      timeBucket: "none",
      limit: QUERY_DEFAULT_LIMIT,
      sortBy: "spend",
      sortDir: "desc",
    },
  },
  {
    ask: "clicks and conversions by day",
    config: {
      visualization: "line",
      metrics: ["clicks", "conversions"],
      groupBy: "none",
      timeBucket: "day",
      limit: QUERY_DEFAULT_LIMIT,
      sortBy: "clicks",
      sortDir: "desc",
      trendLine: true,
    },
  },
  {
    ask: "top 10 campaigns by spend",
    config: {
      visualization: "table",
      metrics: ["spend", "clicks", "conversions", "cpa"],
      groupBy: "campaign",
      timeBucket: "none",
      limit: 10,
      sortBy: "spend",
      sortDir: "desc",
      heatCells: true,
    },
  },
];

function examplesBlock(): string {
  return EXAMPLES.map((e) => `"${e.ask}" -> ${JSON.stringify(e.config)}`).join("\n");
}

/** The size words, straight from the picker the user sees in the config dialog. */
function sizeVocabulary(): string {
  return SIZE_PRESETS.map(
    (p) => `"${p.key}" (${p.label} — ${p.w} of ${GRID_COLS.lg} columns)`
  ).join(", ");
}

/**
 * The widgets already on the open view. Editable ones carry their current
 * config so an edit can be produced in one shot; the rest are listed anyway,
 * so the assistant can say WHY it will not touch them instead of inventing an
 * id or silently building a second widget.
 */
function inventoryBlock(widgets: BuilderWidgetRef[]): string {
  if (widgets.length === 0) return "The view is empty — there is nothing to edit yet.";
  return widgets
    .map((w) =>
      w.config
        ? `- id "${w.i}" — ${w.title} — type "${w.type}" — editable — current config: ${JSON.stringify(w.config)}`
        : `- id "${w.i}" — ${w.title} — NOT editable (${w.locked ?? `type "${w.type}"`})`
    )
    .join("\n");
}

/**
 * What the client actually has behind the active range. Without it the model
 * builds a ROAS chart for a client with no revenue tracking, or a breakdown of
 * a platform with no rows. The platform vocabulary comes from PLATFORMS so a
 * new connector cannot be silently left out of the "no rows" list.
 */
function dataFactsBlock(facts: ClientDataFacts): string {
  const header = "## Data available for this client (in the active range)";
  if (facts.rowCount === 0) {
    const span =
      facts.dataStart && facts.dataEnd
        ? `This client has data from ${facts.dataStart} to ${facts.dataEnd}.`
        : "This client has no data at all yet.";
    return `${header}
- No rows at all in this range. ${span}
Say the range is empty and name a range that would work; do not build a blank widget.`;
  }
  const present = PLATFORMS.filter((p) => facts.platforms.includes(p));
  const missing = PLATFORMS.filter((p) => !facts.platforms.includes(p));
  const platforms = `${present.join(", ")}${missing.length ? ` (no ${missing.join("/")} rows in this range)` : ""}`;
  const revenue = facts.hasRevenue
    ? "available"
    : "not configured for this client — do not build revenue or ROAS widgets";
  return `${header}
- Platforms with data: ${platforms}
- Revenue tracking: ${revenue}
- Campaigns with data: ${facts.campaignCount}
Use this to steer defaults: do not chart a metric or platform with nothing behind it; say so instead.`;
}

// Derived once at module load — these inputs are compile-time constants.
const CONFIG_SCHEMA = configJsonSchema();
const RULES_TABLE = rulesTable();
const METRIC_VOCABULARY = metricVocabulary();
const EXAMPLES_BLOCK = examplesBlock();
const SIZE_VOCABULARY = sizeVocabulary();
const TYPES_BLOCK = builderTypesPromptBlock();
const VISUALIZATION_MENU = CUSTOM_VISUALIZATIONS.map((v) => `${v} (${VISUALIZATION_LABELS[v]})`).join(", ");

export interface BuilderPromptContext {
  clientName: string;
  currency: string;
  startDate: string;
  endDate: string;
  /** The page's platform selector, already resolved. Empty = all platforms. */
  platforms: string[];
  /** What this client actually has in the active range. */
  facts: ClientDataFacts;
  /** Name of the dashboard view the widget will be added to, when known. */
  viewName?: string;
  /** Widgets already on the view — the edit targets. */
  widgets: BuilderWidgetRef[];
  /**
   * The widget the user pinned in the panel ("Edit with AI"). An unqualified
   * edit refers to this one.
   */
  targetWidgetId?: string;
}

export function buildBuilderSystemPrompt(ctx: BuilderPromptContext): string {
  const platformText = ctx.platforms.length > 0 ? ctx.platforms.join(", ") : "all platforms";
  const viewText = ctx.viewName ? `the "${ctx.viewName}" dashboard view` : "the current dashboard view";
  const target = ctx.targetWidgetId
    ? ctx.widgets.find((w) => w.i === ctx.targetWidgetId)
    : undefined;
  const inventory = inventoryBlock(ctx.widgets);
  // A pinned widget can still be one the route refuses to edit (its stored
  // config does not parse). Saying "edit THAT widget" then walks the model into
  // an update_widget call that comes back refused, so the pin is described as
  // what it actually is instead.
  const targetText = !target
    ? ""
    : target.config
      ? `\n- The user has SELECTED the widget id "${target.i}" (${target.title}). Any change they describe without naming another widget is an edit to THAT widget: call update_widget on it, do not create a new one.`
      : `\n- The user has SELECTED the widget "${target.title}", which is NOT editable here (${target.locked ?? `type "${target.type}"`}). Say briefly why it cannot be changed and build nothing, unless they ask for something else.`;

  return `You are the AdPulse Builder Assistant. You build and edit the widgets on a dashboard view. You turn a plain-English request into widgets by calling create_widget (a new widget), update_widget (change one that already exists) or remove_widget (delete one). You do not answer analytics questions and you do not report numbers — you build the widget that shows them.

## Runtime context
- Client: ${ctx.clientName}
- Currency: ${ctx.currency} (never put a currency in the config; the widget formats it)
- Active date range on the page: ${ctx.startDate} to ${ctx.endDate}
- Active platform filter on the page: ${platformText}
- Target: ${viewText}${targetText}

A widget follows the page's date range and platform selector automatically. Only set config.filters when the user asks for a scope DIFFERENT from the page (a pinned date range, specific platforms, specific campaigns).

${dataFactsBlock(ctx.facts)}

## Chart widget ("custom") config JSON Schema
${CONFIG_SCHEMA}

## Per-visualization rules (enforced server-side; a config that breaks one is rejected)
${RULES_TABLE}

Visualizations: ${VISUALIZATION_MENU}.
"max metrics (ungrouped / grouped)" — the second number applies when groupBy is not "none", because the series are then the groups.
Display options not listed for a visualization must be OMITTED, not set to false.
limit is the top-N group cap (1-${QUERY_MAX_LIMIT}, default ${QUERY_DEFAULT_LIMIT}); it only matters when groupBy is not "none". sortBy/sortDir rank those groups.
threshold ("only campaigns whose CPA is over 50") keeps the groups that pass it and is applied BEFORE the top-N cap, so it also needs a groupBy other than "none"; omit it otherwise.
compareSeries draws the earlier period as a second, dashed line, and applies only to a line/area/combo chart with groupBy "none"; omit it otherwise.

## Metrics
${METRIC_VOCABULARY}

${TYPES_BLOCK}

## Size
Both tools take an optional "size", which is the widget's width on the grid: ${SIZE_VOCABULARY}. The height follows the chart type.
Leave "size" out and the widget gets the natural width for its type — a number is small, a table is wide, a section header is already full width. Only set it when the user asks for one ("full width", "make it small", "side by side" = half each), or when a change of chart type clearly needs a different width.

## Widgets already on this view
${inventory}

Editing rules:
- To change an existing widget, call update_widget with its exact id from the list above and a COMPLETE config — it replaces the old one, it is not a patch. Start from the current config shown above and change only what the user asked for.
- Never invent an id. If the user names a widget that is not in the list, say so and offer to build it.
- If the user's words match more than one widget, ask which one instead of guessing.
- A widget marked NOT editable cannot be changed here: say briefly why and stop. Do not create a replacement unless the user asks for one.
- "Add", "another", "also show" = create_widget. "Change", "make it", "instead", "switch to" = update_widget. "Delete", "remove", "get rid of", "take off" = remove_widget.
- remove_widget accepts ANY id in the list, including widgets marked NOT editable — deleting one does not depend on its config.
- Never remove a widget as a way to replace it. A change to a widget that stays on the view is update_widget, even a change of chart type.
- The one exception: update_widget cannot change a widget's TYPE. To turn a fixed widget into a different kind (a KPI tile into a chart), remove it and create the new one.
- If the widget the user names to remove is not in the list, say politely that it is not on this view and remove nothing.

## Examples
${EXAMPLES_BLOCK}

## How to work
- Pick sensible defaults and build the widget. Ask a short clarifying question ONLY when the request is genuinely ambiguous (e.g. it names no metric at all).
- Never build a revenue or ROAS widget when revenue tracking is not configured for this client: say why in one sentence and offer spend, conversions or CPA instead.
- Never build a breakdown of, or a filter on, a platform with no rows in this range.
- When the active range has no data at all, say so and suggest the range that does. Build nothing.
- Call list_campaigns BEFORE setting filters.campaignIds — never invent a campaign id. Campaign names the user types must be resolved to ids first.
- list_campaigns returns the top campaigns by spend in the active range, each with its spend — use those numbers for "biggest"/"top spending" rather than guessing.
- Call create_widget once per widget the user asked for; several calls in one turn are fine.
- If a tool returns validation issues, fix the config and call it again.
- After building, reply in one or two short sentences saying what you built or changed. No markdown headings, no bullet lists, no restating the config.
- Set config.title only when the user asks for a specific title; otherwise the widget derives its own. When editing, keep the existing title unless the user asks to change it.`;
}
