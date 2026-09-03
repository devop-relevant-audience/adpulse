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
import { KPI_TITLE_MAX, METRIC_OPTIONS, getMetricOption } from "@/lib/dashboard/metrics";
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
import {
  AI_SUMMARY_INSTRUCTIONS_MAX,
  COVER_SUBTITLE_MAX,
  COVER_TITLE_MAX,
  DEFAULT_COVER_CONFIG,
  readAiSummaryConfig,
  readCoverConfig,
} from "@/lib/dashboard/report-blocks";
import { isAdpulseUploadUrl } from "@/lib/uploads/image-constraints";
import { surfaceAllows } from "@/lib/dashboard/types";
import type { WidgetSurface, WidgetType } from "@/lib/dashboard/types";
// Type-only: erased at compile time, so the client component it lives in is
// never pulled into this (React-free, server-side) module.
import type { ImageFit } from "@/components/dashboard/widgets/image-widget";

/**
 * The widget types the assistant may create and edit. `custom` (the chart
 * builder) is the default and covers most asks; the rest are the fixed widgets
 * whose config is small enough to be written from a sentence.
 *
 * `image` is here only because the panel can now upload one: its `url` must be
 * an image attached to the conversation, which the route checks (the schema
 * below only proves the URL is an AdPulse upload, not that it is one of THIS
 * conversation's).
 *
 * `cover` and `ai-summary` are the report-only blocks: they are in this list
 * because the assistant builds report layouts and report templates too, and
 * kept off a dashboard by SURFACE rather than by absence — every entry point
 * below takes the grid being edited and filters through `surfaceAllows`, the
 * same rule the PUT validators enforce.
 *
 * Deliberately absent: the three attribution widgets (demo-only data).
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
  "image",
  "cover",
  "ai-summary",
] as const satisfies readonly WidgetType[];

export type BuilderWidgetType = (typeof BUILDER_WIDGET_TYPES)[number];

/**
 * Whether the builder can configure `type` on `surface`. The surface defaults to
 * the "both" wildcard, which imposes no restriction — pass the grid being edited
 * so a report block is never offered on a dashboard (or the other way round).
 */
export function isBuilderWidgetType(
  type: string,
  surface: WidgetSurface = "both"
): type is BuilderWidgetType {
  return (
    (BUILDER_WIDGET_TYPES as readonly string[]).includes(type) && surfaceAllows(type, surface)
  );
}

/** The types the assistant may build on one grid, in prompt/tool-enum order. */
export function builderWidgetTypesFor(surface: WidgetSurface): BuilderWidgetType[] {
  return BUILDER_WIDGET_TYPES.filter((t) => surfaceAllows(t, surface));
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

/** Mirrors IMAGE_FITS in the widget; `satisfies` catches a rename over there. */
const IMAGE_FIT_VALUES = ["contain", "cover"] as const satisfies readonly ImageFit[];
const IMAGE_ALT_MAX = 140;

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

const kpiConfigSchema = z
  .object({
    metric: enumOf(KPI_METRICS).optional(),
    title: z.string().max(KPI_TITLE_MAX).optional(),
    ...filters,
  })
  .strict();

const trendConfigSchema = z
  .object({
    metrics: enumOf(TREND_METRICS).array().min(1).max(TREND_METRICS.length).optional(),
    granularity: z.enum(TREND_GRANULARITIES).optional(),
    /** Metrics after the first on a right-hand axis. */
    secondaryAxis: z.boolean().optional(),
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

/**
 * The URL is held to "an AdPulse upload" here so a config that reached the grid
 * can never point the browser at an arbitrary host. WHICH upload it may be is a
 * per-request question (the images attached to this conversation, plus the ones
 * already on the view), so the route answers that one — see `allowedImageUrls`.
 */
const imageConfigSchema = z
  .object({
    url: z
      .string()
      .refine(isAdpulseUploadUrl, {
        message: "must be the URL of an image uploaded in this conversation",
      })
      .optional(),
    alt: z.string().max(IMAGE_ALT_MAX).optional(),
    fit: z.enum(IMAGE_FIT_VALUES).optional(),
  })
  .strict();

const sectionConfigSchema = z
  .object({
    title: z.string().max(SECTION_TITLE_MAX).optional(),
    subtitle: z.string().max(SECTION_SUBTITLE_MAX).optional(),
    divider: z.boolean().optional(),
  })
  .strict();

/**
 * The report cover's WORDING only. The client name and the reporting period are
 * context — the page supplies them on the editor canvas and the generator
 * freezes them into the snapshot — so there is nothing here to set them with,
 * and a model that tries is told so by the strict schema.
 */
const coverConfigSchema = z
  .object({
    title: z.string().max(COVER_TITLE_MAX).optional(),
    subtitle: z.string().max(COVER_SUBTITLE_MAX).optional(),
  })
  .strict();

/**
 * The steer for the AI summary. The prose itself is written once, at generation
 * time (`src/lib/reports/ai-summary.ts`), so this block carries instructions and
 * never text.
 */
const aiSummaryConfigSchema = z
  .object({ instructions: z.string().max(AI_SUMMARY_INSTRUCTIONS_MAX).optional() })
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
    // The user's own title when set, else the same label list the widget's
    // title map uses (METRIC_OPTIONS).
    title: (c) => (typeof c.title === "string" && c.title.trim() ? c.title.trim() : metricLabel(c.metric)),
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
    blurb: "a labelled band header that splits a long page into named parts",
    example: { title: "Paid search", divider: true },
    describe: (c) => readSectionConfig(c).subtitle || "Band header",
    title: (c) => readSectionConfig(c).title,
  }),
  image: kind({
    schema: imageConfigSchema,
    blurb:
      "an image the user attached to this chat — a logo, a screenshot, a diagram — placed on the grid; \"url\" MUST be copied from the attached image URLs, never invented",
    example: { url: "<attached image url>", alt: "Client logo", fit: "contain" },
    describe: (c) => {
      const alt = typeof c.alt === "string" ? c.alt.trim() : "";
      const fit = c.fit === "cover" ? "cropped to fill" : "scaled to fit";
      return alt ? `Image · ${alt} · ${fit}` : `Uploaded image · ${fit}`;
    },
    // The registry's own rule for this widget, so the panel card and the grid
    // agree on the name.
    title: (c) => (typeof c.alt === "string" && c.alt.trim() ? c.alt.trim().slice(0, IMAGE_ALT_MAX) : "Image"),
  }),
  cover: kind({
    schema: coverConfigSchema,
    blurb:
      "the report's title page — a heading and an optional strap line; the client name and the reporting period are added automatically",
    example: { ...DEFAULT_COVER_CONFIG },
    describe: (c) => {
      const { title, subtitle } = readCoverConfig(c);
      return subtitle ? `Cover · ${title} · ${subtitle}` : `Cover · ${title}`;
    },
    title: (c) => readCoverConfig(c).title,
  }),
  "ai-summary": kind({
    schema: aiSummaryConfigSchema,
    blurb:
      "a written analysis of the period, composed when the report is generated; \"instructions\" steers what it covers",
    example: { instructions: "Lead with spend efficiency and call out the biggest mover." },
    describe: (c) => {
      const { instructions } = readAiSummaryConfig(c);
      if (!instructions) return "Written at generation time · no steer";
      return instructions.length > 70 ? `${instructions.slice(0, 70)}…` : instructions;
    },
  }),
};

// --- What the route and the panel call -------------------------------------

export type BuilderConfigParse =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

/**
 * Holds a config the assistant produced (or one already on the grid) to this
 * type's strict schema, refusing a type that does not belong on `surface`. Nothing is repaired: a normalizing pass would silently
 * hand back a different widget than the one that was asked for, so a config
 * that breaks a rule comes back as issues the model can fix and call again.
 */
export function parseBuilderConfig(
  type: string,
  raw: unknown,
  surface: WidgetSurface = "both"
): BuilderConfigParse {
  if (!isBuilderWidgetType(type, surface)) {
    // Two different refusals read the same way to the model: a type it cannot
    // configure at all, and one that exists but not on the grid being edited.
    const where = surfaceAllows(type, surface) ? "" : ` on a ${surface}`;
    return { ok: false, issues: [`the builder cannot configure a "${type}" widget${where}`] };
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

/**
 * The enum line for one type, generated from the very lists its schema is built
 * on. Keyed by type so the block can be filtered to the grid being edited — a
 * report block's rules must not be paid for on a dashboard turn, and a rule the
 * model cannot use is a rule it can get wrong.
 */
const FIELD_RULES: Partial<Record<BuilderWidgetType, string>> = {
  kpi: sameMetricSet
    ? "kpi.metric / top-movers.metric: any metric id from Metrics above"
    : `kpi.metric: ${KPI_METRICS.join("|")}; top-movers.metric: any metric id from Metrics above`,
  trend: `trend.metrics (1+): ${TREND_METRICS.join("|")}; trend.granularity: ${TREND_GRANULARITIES.join("|")}; trend.secondaryAxis: true puts metrics after the first on a right-hand axis (set it when the metrics differ in magnitude, e.g. spend with conversions)`,
  "platform-breakdown": `platform-breakdown.metric: ${PLATFORM_BREAKDOWN_METRICS.join("|")}`,
  "campaign-table": `campaign-table.limit: ${CAMPAIGN_TABLE_LIMITS.join("|")}; sortBy: ${CAMPAIGN_TABLE_SORT_BYS.join("|")}`,
  "top-movers": `top-movers.groupBy: ${TOP_MOVERS_GROUP_BYS.join("|")}; limit: 1-${TOP_MOVERS_MAX_LIMIT}; direction: ${TOP_MOVERS_DIRECTIONS.join("|")}`,
  note: `note.text: markdown, max ${NOTE_TEXT_MAX} chars`,
  section: `section.title (max ${SECTION_TITLE_MAX}), optional subtitle (max ${SECTION_SUBTITLE_MAX}) and divider (boolean)`,
  image: `image.url: one of the attached image URLs, verbatim; alt: short description (max ${IMAGE_ALT_MAX}); fit: ${IMAGE_FIT_VALUES.join("|")} (contain = whole image, cover = crop to fill)`,
  cover: `cover.title (max ${COVER_TITLE_MAX}) and optional subtitle (max ${COVER_SUBTITLE_MAX}). The client name and the period are added automatically — never write them into either field.`,
  "ai-summary": `ai-summary.instructions: optional steer for the writer, max ${AI_SUMMARY_INSTRUCTIONS_MAX} chars. Leave it out for a general summary of the period.`,
};

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
 *
 * `surface` narrows it to the grid being edited: on a dashboard the two
 * report-only blocks are not described at all, so they cannot be asked for and
 * then refused.
 */
export function builderTypesPromptBlock(surface: WidgetSurface): string {
  const types = builderWidgetTypesFor(surface).filter((t) => t !== "custom");
  const noun = surface === "report" ? "block" : "widget";
  const rows = types.map((t) => {
    const k = BUILDER_WIDGET_KINDS[t];
    return `- ${t} — ${k.blurb} — ${JSON.stringify(k.example)}`;
  });
  const rules = types.map((t) => FIELD_RULES[t]).filter(Boolean);
  const filterable = FILTERABLE.filter((t) => surfaceAllows(t, surface));
  const unfilterable = types.filter((t) => !filterable.includes(t));
  return `## Fixed ${noun} types
create_widget's "type" defaults to "custom", the chart builder above — still the right answer for most asks. Use a fixed type only when it is exactly what was asked for; each takes ONLY the keys shown, nothing else.
${rows.join("\n")}
${rules.join("\n")}
${filterable.join(", ")} also accept the same optional "filters" object as a chart; ${unfilterable.join(", ")} never do (they show no queried data).
update_widget changes a ${noun}'s settings, not its kind — send a config for the type the ${noun} already has.`;
}
