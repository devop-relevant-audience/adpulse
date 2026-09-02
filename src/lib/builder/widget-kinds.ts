// What the Builder Assistant is allowed to build, and the exact shape of each
// one's config. Pure TypeScript + zod — no React, no widget-registry import —
// because the route (server) and the panel (client) both read it.
//
// WHY A SECOND SET OF SCHEMAS. The dashboards PUT validates every non-`custom`
// widget config LOOSELY on purpose: those shapes are owned by their widget, and
// views saved months ago may carry keys nobody models any more. Making that
// validator strict would reject saved dashboards. So strictness lives here
// instead — it applies only to what the assistant EMITS, where a hallucinated
// key must not reach the grid. Everything these schemas accept is a subset of
// what `validateWidgetConfig` accepts, so an assistant-built widget always
// saves.
//
// The prompt block at the bottom is generated from the same table, so the model
// can never be told about a field the schema would reject.

import { z } from "zod";
import { widgetFiltersSchema } from "@/lib/dashboard/filters";
import { METRIC_OPTIONS, getMetricOption } from "@/lib/dashboard/metrics";
import { WIDGET_META } from "@/lib/dashboard/widget-meta";
import {
  CAMPAIGN_TABLE_DEFAULT_LIMIT,
  CAMPAIGN_TABLE_DEFAULT_SORT_BY,
  CAMPAIGN_TABLE_LIMITS,
  CAMPAIGN_TABLE_SORT_BYS,
  campaignTableSortLabel,
  type CampaignTableSortBy,
} from "@/lib/dashboard/campaign-table";
import {
  GROUP_BY_LABELS,
  QUERY_METRICS,
  QUERY_METRIC_META,
  TIME_BUCKET_LABELS,
  VISUALIZATION_LABELS,
  customWidgetConfigSchema,
  describeCustomWidget,
  normalizeCustomConfig,
} from "@/lib/dashboard/custom-widget";
import {
  DEFAULT_TOP_MOVERS_CONFIG,
  TOP_MOVERS_DIRECTIONS,
  TOP_MOVERS_GROUP_BYS,
  TOP_MOVERS_MAX_LIMIT,
  describeTopMovers,
  normalizeTopMoversConfig,
} from "@/lib/dashboard/top-movers";
import {
  SECTION_SUBTITLE_MAX,
  SECTION_TITLE_MAX,
  readSectionConfig,
} from "@/lib/dashboard/section";
import type { WidgetType } from "@/lib/dashboard/types";

/**
 * The widget types the assistant may create and edit. `custom` (the chart
 * builder) is the default and covers most asks; the rest are the fixed widgets
 * whose config is small enough to be written from a sentence.
 *
 * Deliberately absent: the three attribution widgets (demo-only data),
 * `image` (needs an upload), and `cover`/`ai-summary` (report-only blocks —
 * `widgetSurface()` keeps them off a dashboard anyway).
 */
export const BUILDER_WIDGET_TYPES = [
  "custom",
  "kpi",
  "trend",
  "platform-breakdown",
  "campaign-table",
  "top-movers",
  "funnel",
  "health-gauge",
  "note",
  "section",
] as const satisfies readonly WidgetType[];

export type BuilderWidgetType = (typeof BUILDER_WIDGET_TYPES)[number];

export function isBuilderWidgetType(type: string): type is BuilderWidgetType {
  return (BUILDER_WIDGET_TYPES as readonly string[]).includes(type);
}

// --- Vocabularies, taken from the widgets' own option lists ----------------

/** Every metric the KPI tile can show — the shared dashboard metric catalog. */
const KPI_METRICS = METRIC_OPTIONS.map((m) => m.value);
/** The subset the daily-trend endpoint has a per-day series for. */
const TREND_METRICS = METRIC_OPTIONS.filter((m) => m.trendKey).map((m) => m.value);
const TREND_GRANULARITIES = ["day", "week", "month"] as const;
/** The two totals the platform breakdown can sum. */
const PLATFORM_BREAKDOWN_METRICS = ["spend", "conversions"] as const;

const NOTE_TEXT_MAX = 2000;

/** `z.enum` wants a non-empty tuple; these lists are derived, so assert it. */
function enumOf(values: readonly string[]) {
  return z.enum(values as [string, ...string[]]);
}

/** Widgets that read `config.filters` (registry `supportsFilters`). */
const filters = { filters: widgetFiltersSchema.optional() };

// UNKNOWN keys are what these schemas exist to reject — a hallucinated field
// would be stored and then quietly ignored by the widget forever. A MISSING key
// is not a hazard: every one of these widgets substitutes its own default for
// an absent setting, so the fields are optional. That also means the schemas
// accept the configs already sitting on saved views, which is what keeps those
// widgets editable rather than demoting them to read-only.

const kpiConfigSchema = z.object({ metric: enumOf(KPI_METRICS).optional(), ...filters }).strict();

const trendConfigSchema = z
  .object({
    metrics: enumOf(TREND_METRICS).array().min(1).max(TREND_METRICS.length).optional(),
    granularity: z.enum(TREND_GRANULARITIES).optional(),
    ...filters,
  })
  .strict();

const platformBreakdownConfigSchema = z
  .object({ metric: z.enum(PLATFORM_BREAKDOWN_METRICS).optional(), ...filters })
  .strict();

const campaignTableConfigSchema = z
  .object({
    limit: z
      .number()
      .refine((n) => (CAMPAIGN_TABLE_LIMITS as readonly number[]).includes(n), {
        message: `must be one of ${CAMPAIGN_TABLE_LIMITS.join(", ")}`,
      })
      .optional(),
    sortBy: enumOf(CAMPAIGN_TABLE_SORT_BYS).optional(),
    ...filters,
  })
  .strict();

const topMoversConfigSchema = z
  .object({
    metric: z.enum(QUERY_METRICS).optional(),
    groupBy: z.enum(TOP_MOVERS_GROUP_BYS).optional(),
    limit: z.number().int().min(1).max(TOP_MOVERS_MAX_LIMIT).optional(),
    direction: z.enum(TOP_MOVERS_DIRECTIONS).optional(),
    ...filters,
  })
  .strict();

/** Two widgets that take no settings of their own — only the shared filters. */
const noSettingsConfigSchema = z.object({ ...filters }).strict();

/** Layout widgets: no data query, so no filters either. */
const noteConfigSchema = z.object({ text: z.string().max(NOTE_TEXT_MAX).optional() }).strict();

const sectionConfigSchema = z
  .object({
    title: z.string().max(SECTION_TITLE_MAX).optional(),
    subtitle: z.string().max(SECTION_SUBTITLE_MAX).optional(),
    divider: z.boolean().optional(),
  })
  .strict();

// --- The table -------------------------------------------------------------

interface BuilderWidgetKind<TSchema extends z.ZodType<Record<string, unknown>>> {
  schema: TSchema;
  /** One clause for the prompt table: what this widget is for. */
  blurb: string;
  /**
   * The config the prompt shows as an example. Typed against the schema, so a
   * field renamed in the schema is a type error here rather than a suggestion
   * the model will faithfully copy into a rejected tool call.
   */
  example: z.input<TSchema>;
  /** The one-line spec the assistant panel prints under a widget card. */
  describe: (config: Record<string, unknown>) => string;
  /** The title the grid gives it, when that is derived from the config. */
  title?: (config: Record<string, unknown>) => string;
}

function kind<TSchema extends z.ZodType<Record<string, unknown>>>(
  k: BuilderWidgetKind<TSchema>
): BuilderWidgetKind<z.ZodType<Record<string, unknown>>> {
  return k as unknown as BuilderWidgetKind<z.ZodType<Record<string, unknown>>>;
}

function metricLabel(value: unknown): string {
  return getMetricOption(String(value)).label;
}

/** "Bar chart · Spend, Clicks · by Platform · by Day" */
function describeCustomSpec(config: Record<string, unknown>): string {
  const cfg = normalizeCustomConfig(config);
  const parts = [
    VISUALIZATION_LABELS[cfg.visualization],
    cfg.metrics.map((m) => QUERY_METRIC_META[m].label).join(", "),
  ];
  if (cfg.groupBy !== "none") parts.push(`by ${GROUP_BY_LABELS[cfg.groupBy]}`);
  if (cfg.timeBucket !== "none") parts.push(`by ${TIME_BUCKET_LABELS[cfg.timeBucket]}`);
  return parts.join(" · ");
}

const BUILDER_WIDGET_KINDS: Record<
  BuilderWidgetType,
  BuilderWidgetKind<z.ZodType<Record<string, unknown>>>
> = {
  custom: kind({
    schema: customWidgetConfigSchema as unknown as z.ZodType<Record<string, unknown>>,
    blurb: "the flexible chart builder — any metric, any split, nine shapes",
    example: {},
    describe: describeCustomSpec,
    title: (c) => {
      const cfg = normalizeCustomConfig(c);
      return cfg.title ?? describeCustomWidget(cfg);
    },
  }),
  kpi: kind({
    schema: kpiConfigSchema,
    blurb: "one headline metric with its change on the period before",
    example: { metric: "spend" },
    describe: (c) => `KPI tile · ${metricLabel(c.metric)} vs the period before`,
    // Same label list the widget's own title map uses (METRIC_OPTIONS).
    title: (c) => metricLabel(c.metric),
  }),
  trend: kind({
    schema: trendConfigSchema,
    blurb: "several metrics plotted over time on one line chart",
    example: { metrics: ["spend", "conversions"], granularity: "day" },
    describe: (c) => {
      // Same fallbacks the widget itself applies to a config missing these keys.
      const list = Array.isArray(c.metrics) && c.metrics.length > 0 ? c.metrics : ["spend"];
      return `Trend line · ${list.map(metricLabel).join(", ")} · by ${
        typeof c.granularity === "string" ? c.granularity : "day"
      }`;
    },
  }),
  "platform-breakdown": kind({
    schema: platformBreakdownConfigSchema,
    blurb: "spend or conversions split across Google, Meta and TikTok",
    example: { metric: "spend" },
    describe: (c) => `Platform split · ${metricLabel(c.metric)}`,
  }),
  "campaign-table": kind({
    schema: campaignTableConfigSchema,
    blurb: "the ranked campaign table (spend, conversions, CTR, CPA)",
    example: { limit: CAMPAIGN_TABLE_DEFAULT_LIMIT, sortBy: CAMPAIGN_TABLE_DEFAULT_SORT_BY },
    describe: (c) => {
      const limit = typeof c.limit === "number" ? c.limit : CAMPAIGN_TABLE_DEFAULT_LIMIT;
      const sortBy = (c.sortBy ?? CAMPAIGN_TABLE_DEFAULT_SORT_BY) as CampaignTableSortBy;
      return `Campaign table · top ${limit} by ${campaignTableSortLabel(sortBy)}`;
    },
  }),
  "top-movers": kind({
    schema: topMoversConfigSchema,
    blurb: "the biggest risers and fallers against the period before",
    example: { ...DEFAULT_TOP_MOVERS_CONFIG },
    describe: (c) => `Ranked by absolute change · top ${normalizeTopMoversConfig(c).limit}`,
    title: (c) => describeTopMovers(normalizeTopMoversConfig(c)),
  }),
  funnel: kind({
    schema: noSettingsConfigSchema,
    blurb: "impressions → clicks → conversions with the rate at each step",
    example: {},
    describe: () => "Impressions → clicks → conversions",
  }),
  "health-gauge": kind({
    schema: noSettingsConfigSchema,
    blurb: "the account health score, its grade and the top fixes",
    example: {},
    describe: () => "Account health score, grade and top fixes",
  }),
  note: kind({
    schema: noteConfigSchema,
    blurb: "a block of Markdown text — context, goals, a caveat",
    example: { text: "**Q3 focus:** shift budget to brand search." },
    describe: (c) => {
      const line = (String(c.text ?? "").split("\n")[0] ?? "").trim();
      return line.length > 70 ? `${line.slice(0, 70)}…` : line || "Empty note";
    },
  }),
  section: kind({
    schema: sectionConfigSchema,
    blurb: "a labelled band header that splits a long dashboard into parts",
    example: { title: "Paid search", divider: true },
    describe: (c) => readSectionConfig(c).subtitle || "Band header",
    title: (c) => readSectionConfig(c).title,
  }),
};

// --- What the route and the panel call -------------------------------------

export type BuilderConfigParse =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

/**
 * Holds a config the assistant produced (or one already on the view) to this
 * type's strict schema. Nothing is repaired: a normalizing pass would silently
 * hand back a different widget than the one that was asked for, so a config
 * that breaks a rule comes back as issues the model can fix and call again.
 */
export function parseBuilderConfig(type: string, raw: unknown): BuilderConfigParse {
  if (!isBuilderWidgetType(type)) {
    return { ok: false, issues: [`the builder cannot configure a "${type}" widget`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: ["config: expected an object"] };
  }
  const parsed = BUILDER_WIDGET_KINDS[type].schema.safeParse(raw);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

/**
 * The title the grid will print for this widget — the registry's own rule, so
 * a card in the assistant panel is never named differently from the widget it
 * just built.
 */
export function builderWidgetTitle(
  type: BuilderWidgetType,
  config: Record<string, unknown>
): string {
  return BUILDER_WIDGET_KINDS[type].title?.(config) ?? WIDGET_META[type].title;
}

/** The one-line spec under a widget card in the panel. */
export function describeBuilderConfig(
  type: BuilderWidgetType,
  config: Record<string, unknown>
): string {
  return BUILDER_WIDGET_KINDS[type].describe(config);
}

// --- Prompt block ----------------------------------------------------------

/**
 * True while the KPI catalog and the chart-query catalog hold the same metric
 * ids, which lets the rules below point at the prompt's existing metric list
 * instead of printing a second copy of it.
 */
const sameMetricSet =
  KPI_METRICS.length === QUERY_METRICS.length &&
  KPI_METRICS.every((m) => (QUERY_METRICS as readonly string[]).includes(m));

/** Enum lines, generated from the very lists the schemas above are built on. */
function fieldRules(): string {
  return [
    sameMetricSet
      ? "kpi.metric / top-movers.metric: any metric id from Metrics above"
      : `kpi.metric: ${KPI_METRICS.join("|")}; top-movers.metric: any metric id from Metrics above`,
    `trend.metrics (1+): ${TREND_METRICS.join("|")}; trend.granularity: ${TREND_GRANULARITIES.join("|")}`,
    `platform-breakdown.metric: ${PLATFORM_BREAKDOWN_METRICS.join("|")}`,
    `campaign-table.limit: ${CAMPAIGN_TABLE_LIMITS.join("|")}; sortBy: ${CAMPAIGN_TABLE_SORT_BYS.join("|")}`,
    `top-movers.groupBy: ${TOP_MOVERS_GROUP_BYS.join("|")}; limit: 1-${TOP_MOVERS_MAX_LIMIT}; direction: ${TOP_MOVERS_DIRECTIONS.join("|")}`,
    `note.text: markdown, max ${NOTE_TEXT_MAX} chars`,
    `section.title (max ${SECTION_TITLE_MAX}), optional subtitle (max ${SECTION_SUBTITLE_MAX}) and divider (boolean)`,
  ].join("\n");
}

/**
 * Which of the fixed types also take the shared `filters` object — established
 * by asking each schema, so the sentence in the prompt cannot claim a filter a
 * widget would reject.
 */
const FILTERABLE = BUILDER_WIDGET_TYPES.filter((t) => {
  if (t === "custom") return false;
  const k = BUILDER_WIDGET_KINDS[t];
  return k.schema.safeParse({ ...(k.example as object), filters: { platforms: ["google"] } })
    .success;
});

/**
 * The fixed widgets, for the system prompt. Everything here is generated from
 * BUILDER_WIDGET_KINDS, so a new type or a renamed field reaches the model
 * without a second edit. Kept to compact one-liners: this block is paid for on
 * every request.
 */
export function builderTypesPromptBlock(): string {
  const rows = BUILDER_WIDGET_TYPES.filter((t) => t !== "custom").map((t) => {
    const k = BUILDER_WIDGET_KINDS[t];
    return `- ${t} — ${k.blurb} — ${JSON.stringify(k.example)}`;
  });
  return `## Fixed widget types
create_widget's "type" defaults to "custom", the chart builder above — still the right answer for most asks. Use a fixed type only when it is exactly what was asked for; each takes ONLY the keys shown, nothing else.
${rows.join("\n")}
${fieldRules()}
${FILTERABLE.join(", ")} also accept the same optional "filters" object as a chart; note and section never do (they show no data).
update_widget changes a widget's settings, not its kind — send a config for the type the widget already has.`;
}
