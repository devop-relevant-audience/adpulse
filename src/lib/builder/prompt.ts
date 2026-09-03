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
import {
  GRID_COLS,
  HEIGHT_PRESETS,
  MAX_ARRANGE_WIDGETS,
  SIZE_PRESETS,
  gridRowsToPx,
  groupIntoRows,
  widgetHeightKeyFor,
  widgetSizeKeyFor,
} from "@/lib/dashboard/types";
import { PLATFORMS } from "@/lib/types/database";
import type { ClientDataFacts } from "@/lib/data/queries";
import { builderTypesPromptBlock } from "@/lib/builder/widget-kinds";
import {
  builderGridSurface,
  isBuilderTemplateKind,
  type BuilderGridKind,
  type BuilderWidgetRef,
} from "@/lib/builder/protocol";
import type { GridSurface } from "@/lib/dashboard/types";

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

/** The width words, straight from the picker the user sees in the config dialog. */
function sizeVocabulary(): string {
  return SIZE_PRESETS.map(
    (p) => `"${p.key}" (${p.label} — ${p.w} of ${GRID_COLS.lg} columns)`
  ).join(", ");
}

/**
 * The height words, with the pixel height each one renders at — the model has
 * no other way to tell whether 3 rows is a stat tile or a chart.
 */
function heightVocabulary(): string {
  return HEIGHT_PRESETS.map(
    (p) => `"${p.key}" (${p.h} rows, about ${gridRowsToPx(p.h)}px tall)`
  ).join(", ");
}

/**
 * How one widget's footprint reads. Always the exact numbers; the size WORD is
 * added only when the measurement is one of the presets, so a hand-dragged
 * 4-of-12 column widget is not described as a "quarter".
 */
function footprintText(layout: NonNullable<BuilderWidgetRef["layout"]>): string {
  const widthWord = widgetSizeKeyFor(layout.w);
  const heightWord = widgetHeightKeyFor(layout.h);
  const width = `${layout.w} of ${GRID_COLS.lg} columns wide${widthWord ? ` (${widthWord})` : ""}, from column ${layout.x}`;
  const height = `${layout.h} rows tall${heightWord ? ` (${heightWord})` : ""}`;
  return `${width}, ${height}`;
}

/** One inventory line: what the widget is, and what may be done to it. */
function inventoryLine(w: BuilderWidgetRef): string {
  const where = w.layout ? ` — ${footprintText(w.layout)}` : "";
  const what = w.config
    ? ` — editable — current config: ${JSON.stringify(w.config)}`
    : ` — settings NOT editable (${w.locked ?? `type "${w.type}"`}), but it can still be resized, moved or removed`;
  return `- id "${w.i}" — ${w.title} — type "${w.type}"${where}${what}`;
}

/**
 * The widgets already on the open view, grouped into the rows they appear in
 * so "put these two in one row" and "make the top row shorter" are answerable.
 * Editable ones carry their current config so an edit can be produced in one
 * shot; the rest are listed anyway — their settings are off limits but their
 * size and position are not, and naming them is also how the assistant can say
 * WHY it will not rewrite one instead of inventing an id.
 */
function inventoryBlock(widgets: BuilderWidgetRef[], gridLabel: string): string {
  if (widgets.length === 0) return `The ${gridLabel} is empty — there is nothing to edit yet.`;

  // Without footprints there is nothing to group by, so the flat list stands.
  const positioned = widgets.filter(
    (w): w is BuilderWidgetRef & { layout: NonNullable<BuilderWidgetRef["layout"]> } => !!w.layout
  );
  if (positioned.length !== widgets.length) {
    return widgets.map(inventoryLine).join("\n");
  }

  const byId = new Map(widgets.map((w) => [w.i, w]));
  const rows = groupIntoRows(
    positioned.map((w) => ({ i: w.i, ...w.layout }))
  );
  return rows
    .map((row, index) => {
      const used = row.reduce((sum, item) => sum + item.w, 0);
      const free = GRID_COLS.lg - used;
      const spare = free > 0 ? `, ${free} free` : ", full";
      const label = `Row ${index + 1}${index === 0 ? " (top of the page)" : ""} — ${used} of ${GRID_COLS.lg} columns used${spare}:`;
      const lines = row
        .map((item) => byId.get(item.i))
        .filter((w): w is BuilderWidgetRef => !!w)
        .map(inventoryLine);
      return [label, ...lines].join("\n");
    })
    .join("\n");
}

/**
 * How to read the images attached to the conversation, and the URLs an `image`
 * widget may use. Omitted entirely when nothing is attached, so an ordinary
 * text turn pays nothing for it.
 */
function attachmentsBlock(urls: string[]): string {
  if (urls.length === 0) return "";
  const list = urls.map((u) => `- ${u}`).join("\n");
  return `
## Attached images
The user attached ${urls.length} image${urls.length === 1 ? "" : "s"} to this conversation; they are shown with the messages they came with. Read them and build from what they show:
- A chart or a screenshot from another tool: rebuild it as a widget with the same shape, metrics and split. Read the CHART TYPE, the metrics and the axes off the picture. Never copy the numbers in it — the widget queries this client's live data for the active range.
- A sketch, wireframe or screenshot of a whole dashboard: create one widget per block, top to bottom, and set "size" so the widths match the drawing. Where the drawing has a band title over a group, create a section widget for it.
- A table: a "table" visualization with the columns you can read, each mapped onto a metric id from the list above.
- A logo, photo or diagram meant to sit ON the dashboard: create an "image" widget and copy one of the URLs below into config.url exactly.
- A metric or column you cannot map onto the metric ids above: leave it out, build the rest, and say in one sentence what you skipped.
Attached image URLs, in the order they were sent — copy verbatim, never invent or edit one:
${list}
`;
}

/**
 * What the client actually has behind the active range. Without it the model
 * builds a ROAS chart for a client with no revenue tracking, or a breakdown of
 * a platform with no rows. The platform vocabulary comes from PLATFORMS so a
 * new connector cannot be silently left out of the "no rows" list.
 */
function dataFactsBlock(facts: ClientDataFacts, isTemplate: boolean): string {
  const header = isTemplate
    ? "## Data available for the client this template is being PREVIEWED against (in the active range)"
    : "## Data available for this client (in the active range)";
  if (facts.rowCount === 0) {
    const span =
      facts.dataStart && facts.dataEnd
        ? `This client has data from ${facts.dataStart} to ${facts.dataEnd}.`
        : "This client has no data at all yet.";
    // A template is stamped onto many clients, so the previewing client having
    // nothing is a note about the preview — not a reason to refuse to build.
    return `${header}
- No rows at all in this range. ${span}
${
      isTemplate
        ? "Build what was asked for anyway — the template is not about this client — and mention in one sentence that the preview will look empty."
        : "Say the range is empty and name a range that would work; do not build a blank widget."
    }`;
  }
  const present = PLATFORMS.filter((p) => facts.platforms.includes(p));
  const missing = PLATFORMS.filter((p) => !facts.platforms.includes(p));
  const platforms = `${present.join(", ")}${missing.length ? ` (no ${missing.join("/")} rows in this range)` : ""}`;
  const revenue = facts.hasRevenue
    ? "available"
    : isTemplate
      ? "not configured for the previewing client — a revenue or ROAS block will read as unavailable there"
      : "not configured for this client — do not build revenue or ROAS widgets";
  return `${header}
- Platforms with data: ${platforms}
- Revenue tracking: ${revenue}
- Campaigns with data: ${facts.campaignCount}
${
    isTemplate
      ? "Use this to steer defaults, but remember the template is stamped onto MANY clients: never pin it to this client's campaigns, and prefer metrics every client has."
      : "Use this to steer defaults: do not chart a metric or platform with nothing behind it; say so instead."
  }`;
}


// Derived once at module load — these inputs are compile-time constants.
const CONFIG_SCHEMA = configJsonSchema();
const RULES_TABLE = rulesTable();
const METRIC_VOCABULARY = metricVocabulary();
const EXAMPLES_BLOCK = examplesBlock();
const SIZE_VOCABULARY = sizeVocabulary();
const HEIGHT_VOCABULARY = heightVocabulary();
/** One per surface: the two grids allow different widget types. */
const TYPES_BLOCK: Record<GridSurface, string> = {
  dashboard: builderTypesPromptBlock("dashboard"),
  report: builderTypesPromptBlock("report"),
};
const VISUALIZATION_MENU = CUSTOM_VISUALIZATIONS.map((v) => `${v} (${VISUALIZATION_LABELS[v]})`).join(", ");

/**
 * How each grid is named and described. The four kinds share every mechanic —
 * same widgets, same 12-column grid, same tools — so only the WORDS differ, and
 * they matter: a model told it is editing "the dashboard" while pointed at the
 * master report template will happily suggest a cover page for a KPI row, or
 * refuse a block because "this client" has no revenue.
 */
interface GridVocabulary {
  /** "widget" or "block" — what one item on this grid is called. */
  noun: string;
  /** "dashboard view", "report layout", "master report template". */
  label: string;
  /** The opening sentence's object: "a dashboard view", "the master report". */
  role: string;
  /** Extra rules that apply only to this grid. Empty for a dashboard view. */
  notes: string[];
}

const REPORT_PAGE_NOTES = [
  "This is a REPORT PAGE, not a screen: it is read top to bottom at a fixed document width and is what the client is sent. Order the blocks the way a report is read — a cover, then the written summary, then the numbers, then the detail — and use section headers to name each part.",
  "A cover block belongs at the very top and there is never more than one. An ai-summary block is prose written when the report is generated, so it is placed near the top and never sized like a chart.",
  "A generated report freezes the date range chosen at generation time; the range below is what the editor previews with. Only set config.filters when a block must always show a DIFFERENT scope from the rest of the report.",
];

const GRID_VOCABULARY: Record<BuilderGridKind, GridVocabulary> = {
  "dashboard-view": {
    noun: "widget",
    label: "dashboard view",
    role: "a dashboard view",
    notes: [],
  },
  "report-layout": {
    noun: "block",
    label: "report layout",
    role: "a report layout",
    notes: REPORT_PAGE_NOTES,
  },
  "dashboard-template": {
    noun: "widget",
    label: "master dashboard template",
    role: "the master dashboard template",
    notes: [
      "This is the MASTER DASHBOARD TEMPLATE, not one client's view: it is what every client with no saved dashboard renders, and what a new view is stamped from. Build what works for every client — standard metrics, no campaign filters, nothing that only makes sense for the client whose data is previewing below. Existing saved views are not changed by an edit here.",
    ],
  },
  "report-template": {
    noun: "block",
    label: "master report template",
    role: "the master report template",
    notes: [
      "This is the MASTER REPORT TEMPLATE, not one client's report: it is what every new report layout starts from. Build what works for every client — standard metrics, no campaign filters, nothing that only makes sense for the client whose data is previewing below. Report layouts already created are copies and are not changed by an edit here.",
      ...REPORT_PAGE_NOTES,
    ],
  },
};

export interface BuilderPromptContext {
  /** Which grid is open — the only thing that differs between the four surfaces. */
  gridKind: BuilderGridKind;
  clientName: string;
  currency: string;
  startDate: string;
  endDate: string;
  /** The page's platform selector, already resolved. Empty = all platforms. */
  platforms: string[];
  /** What this client actually has in the active range. */
  facts: ClientDataFacts;
  /** Name of the view / layout / template being edited, when known. */
  viewName?: string;
  /** Widgets already on the grid — the edit targets. */
  widgets: BuilderWidgetRef[];
  /**
   * The widget the user pinned in the panel ("Edit with AI"). An unqualified
   * edit refers to this one.
   */
  targetWidgetId?: string;
  /**
   * Public URLs of every image attached to this conversation, oldest first —
   * already validated as AdPulse uploads. They are also the only URLs an
   * `image` widget may carry, which is why they are listed verbatim.
   */
  attachments?: string[];
}

export function buildBuilderSystemPrompt(ctx: BuilderPromptContext): string {
  const vocab = GRID_VOCABULARY[ctx.gridKind];
  const surface = builderGridSurface(ctx.gridKind);
  const isTemplate = isBuilderTemplateKind(ctx.gridKind);
  const { noun, label } = vocab;
  const platformText = ctx.platforms.length > 0 ? ctx.platforms.join(", ") : "all platforms";
  const viewText = ctx.viewName ? `the "${ctx.viewName}" ${label}` : `the ${label}`;
  const target = ctx.targetWidgetId
    ? ctx.widgets.find((w) => w.i === ctx.targetWidgetId)
    : undefined;
  const inventory = inventoryBlock(ctx.widgets, label);
  // A pinned widget can still be one the route refuses to edit (its stored
  // config does not parse). Saying "edit THAT widget" then walks the model into
  // an update_widget call that comes back refused, so the pin is described as
  // what it actually is instead.
  const targetText = !target
    ? ""
    : target.config
      ? `\n- The user has SELECTED the ${noun} id "${target.i}" (${target.title}). Any change they describe without naming another ${noun} is an edit to THAT ${noun}: call update_widget on it, do not create a new one.`
      : `\n- The user has SELECTED the ${noun} "${target.title}", which is NOT editable here (${target.locked ?? `type "${target.type}"`}). Say briefly why it cannot be changed and build nothing, unless they ask for something else.`;
  const notes = vocab.notes.length > 0 ? `\n\n## This grid\n${vocab.notes.map((n) => `- ${n}`).join("\n")}` : "";
  // A template is not one client's, so the client line reads as what it is.
  const clientLine = isTemplate
    ? `Client whose data is previewing (the template itself belongs to no client): ${ctx.clientName}`
    : `Client: ${ctx.clientName}`;

  return `You are the AdPulse Builder Assistant. You build, edit and lay out the ${noun}s on ${vocab.role}. You turn a plain-English request into ${noun}s by calling create_widget (a new ${noun}), update_widget (change what one already there shows), remove_widget (delete one), resize_widget (change one's width or height) or arrange_row (put ${noun}s side by side on one row). You do not answer analytics questions and you do not report numbers — you build the ${noun} that shows them.

## Runtime context
- ${clientLine}
- Currency: ${ctx.currency} (never put a currency in the config; the widget formats it)
- Active date range on the page: ${ctx.startDate} to ${ctx.endDate}
- Active platform filter on the page: ${platformText}
- Target: ${viewText}${targetText}${notes}

A ${noun} follows the page's date range and platform selector automatically. Only set config.filters when the user asks for a scope DIFFERENT from the page (a pinned date range, specific platforms, specific campaigns).

${dataFactsBlock(ctx.facts, isTemplate)}
${attachmentsBlock(ctx.attachments ?? [])}

## Chart ${noun} ("custom") config JSON Schema
${CONFIG_SCHEMA}

## Per-visualization rules (enforced server-side; a config that breaks one is rejected)
${RULES_TABLE}

Visualizations: ${VISUALIZATION_MENU}.
"max metrics (ungrouped / grouped)" — the second number applies when groupBy is not "none", because the series are then the groups.
Display options not listed for a visualization must be OMITTED, not set to false.
limit is the top-N group cap (1-${QUERY_MAX_LIMIT}, default ${QUERY_DEFAULT_LIMIT}); it only matters when groupBy is not "none". sortBy/sortDir rank those groups.
threshold ("only campaigns whose CPA is over 50") keeps the groups that pass it and is applied BEFORE the top-N cap, so it also needs a groupBy other than "none"; omit it otherwise.
compareSeries draws the earlier period as a second, dashed line, and applies only to a line/area/combo chart with groupBy "none"; omit it otherwise.
secondaryAxis puts every metric after the first on a right-hand axis so a small series stays readable next to a large one (spend vs conversions, clicks vs CTR). Set it whenever an ungrouped line/area plots metrics of different magnitude or format; it needs groupBy "none" and at least two metrics — omit it otherwise. A combo chart already has its line on the right axis.

## Metrics
${METRIC_VOCABULARY}

${TYPES_BLOCK[surface]}

## Size and position
The grid is ${GRID_COLS.lg} columns wide. A ${noun}'s size is a WIDTH (a column span) and a HEIGHT (a number of grid rows); it has no other geometry you can set.
- Width words: ${SIZE_VOCABULARY}.
- Height words: ${HEIGHT_VOCABULARY}.

create_widget and update_widget both take an optional "width" and an optional "height". Leave them out and the ${noun} gets the natural size for its type — a number is a small tile, a table is wide, a trend chart is tall, a section header is already full width. Set them only when the user asks ("full width", "make it small", "side by side" = half each, "make it taller"), or when a change of chart type clearly needs a different shape.

resize_widget changes ONLY a ${noun}'s size, and needs no config — use it for "make the table taller", "make that chart full width", "shrink the tile". Never resend a whole config just to resize, and never remove and rebuild a ${noun} to change its size.

arrange_row puts ${noun}s side by side on ONE row, in the order you list them, left to right. Pass 2 to ${MAX_ARRANGE_WIDGETS} ids from the list below. This is how "put these two in the same row", "line the tiles up", "move it next to the chart" get done.
- The row lands where the topmost of those ${noun}s already is, and whatever was below moves down.
- A row holds ${GRID_COLS.lg} columns, so the widths have to add up to ${GRID_COLS.lg} or less. ${noun[0].toUpperCase()}${noun.slice(1)}s that do not fit are shrunk until they do. When the user asks for particular proportions, call resize_widget first and then arrange_row ("three-quarters plus a quarter" = resize both, then arrange).
- Any ${noun} on the ${label} can be resized or arranged, including ones whose settings are not editable.

You never give x/y coordinates and there is no way to ask for one. The grid closes gaps upwards by itself, so an empty row is not something that can exist: you change the layout by changing sizes and by grouping ${noun}s into rows.

## ${noun[0].toUpperCase()}${noun.slice(1)}s already on this ${label}
${inventory}

Editing rules:
- To change an existing ${noun}, call update_widget with its exact id from the list above and a COMPLETE config — it replaces the old one, it is not a patch. Start from the current config shown above and change only what the user asked for.
- Never invent an id. If the user names a ${noun} that is not in the list, say so and offer to build it.
- If the user's words match more than one ${noun}, ask which one instead of guessing.
- A ${noun} whose settings are NOT editable cannot have its config rewritten: say briefly why and stop. Do not create a replacement unless the user asks for one. Its SIZE and its POSITION are a different matter — resize_widget and arrange_row work on it like any other.
- "Add", "another", "also show" = create_widget. "Change", "make it", "instead", "switch to" = update_widget. "Delete", "remove", "get rid of", "take off" = remove_widget. "Bigger", "smaller", "taller", "shorter", "full width" = resize_widget. "Side by side", "same row", "next to", "line them up" = arrange_row.
- remove_widget, resize_widget and arrange_row accept ANY id in the list, including ${noun}s whose settings are not editable — deleting, resizing and moving do not depend on the config.
- A request that is only about size or position never goes through update_widget: use resize_widget or arrange_row so the settings are left exactly as they are.
- Never remove a ${noun} as a way to replace it. A change to a ${noun} that stays on the ${label} is update_widget, even a change of chart type.
- The one exception: update_widget cannot change a ${noun}'s TYPE. To turn a fixed ${noun} into a different kind (a KPI tile into a chart), remove it and create the new one.
- If the ${noun} the user names to remove is not in the list, say politely that it is not on this ${label} and remove nothing.

## Examples
${EXAMPLES_BLOCK}

## How to work
- Pick sensible defaults and build the ${noun}. Ask a short clarifying question ONLY when the request is genuinely ambiguous (e.g. it names no metric at all).
- Never build a revenue or ROAS ${noun} when revenue tracking is not configured${isTemplate ? " and the user has not asked for one anyway" : " for this client"}: say why in one sentence and offer spend, conversions or CPA instead.
- ${isTemplate ? "A platform with no rows for the previewing client is not a reason to leave it out of a template — every other client may have it." : "Never build a breakdown of, or a filter on, a platform with no rows in this range."}
- ${isTemplate ? "The previewing client's empty range is worth one sentence, not a refusal — the template is not about them." : "When the active range has no data at all, say so and suggest the range that does. Build nothing."}
- Call list_campaigns BEFORE setting filters.campaignIds — never invent a campaign id. Campaign names the user types must be resolved to ids first.${isTemplate ? " A template should almost never carry campaign ids: they belong to one client." : ""}
- list_campaigns returns the top campaigns by spend in the active range, each with its spend — use those numbers for "biggest"/"top spending" rather than guessing.
- Call create_widget once per ${noun} the user asked for; several calls in one turn are fine.
- A tidy-up request ("clean this up", "make it fit on one screen") is several calls: resize the ${noun}s, then arrange_row the ones that belong together. Work top to bottom and say in one sentence what you changed.
- If a tool returns validation issues, fix the config and call it again.
- After building, reply in one or two short sentences saying what you built or changed. No markdown headings, no bullet lists, no restating the config.
- Set config.title only when the user asks for a specific title; otherwise the ${noun} derives its own. When editing, keep the existing title unless the user asks to change it.`;
}
