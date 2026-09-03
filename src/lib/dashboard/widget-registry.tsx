"use client";

import { BiHash, BiLineChart, BiBarChartAlt2, BiNote, BiTable, BiPulse, BiFilterAlt, BiDollar, BiGitBranch, BiGroup, BiSliderAlt, BiTransferAlt, BiHeading, BiArea, BiChart, BiPieChartAlt2, BiDoughnutChart, BiGridAlt, BiImage, BiIdCard, BiBot } from "react-icons/bi";
import type {
  GridSurface,
  WidgetSurface,
  WidgetType,
  WidgetRenderProps,
  WidgetConfigFormProps,
} from "@/lib/dashboard/types";
import { surfaceAllows } from "@/lib/dashboard/types";
import { WIDGET_META, type WidgetFootprint } from "@/lib/dashboard/widget-meta";
import { KpiWidget, KpiConfigForm, KpiTitleForm, kpiTitle } from "@/components/dashboard/widgets/kpi-widget";
import { TrendWidget, TrendConfigForm } from "@/components/dashboard/widgets/trend-widget";
import { PlatformBreakdownWidget } from "@/components/dashboard/widgets/platform-breakdown-widget";
import { NoteWidget, NoteConfigForm } from "@/components/dashboard/widgets/note-widget";
import {
  CampaignTableWidget,
  CampaignTableConfigForm,
} from "@/components/dashboard/widgets/campaign-table-widget";
import { HealthGaugeWidget } from "@/components/dashboard/widgets/health-gauge-widget";
import { FunnelWidget } from "@/components/dashboard/widgets/funnel-widget";
import { RevenueRoasWidget } from "@/components/dashboard/widgets/revenue-roas-widget";
import { AttributionMiniWidget } from "@/components/dashboard/widgets/attribution-mini-widget";
import { LtvCacWidget } from "@/components/dashboard/widgets/ltv-cac-widget";
import {
  CustomWidget,
  CustomWidgetConfigForm,
  CustomWidgetTitleForm,
} from "@/components/dashboard/widgets/custom-widget";
import {
  TopMoversWidget,
  TopMoversConfigForm,
} from "@/components/dashboard/widgets/top-movers-widget";
import {
  SectionWidget,
  SectionConfigForm,
} from "@/components/dashboard/widgets/section-widget";
import { DEFAULT_SECTION_CONFIG, readSectionConfig } from "@/lib/dashboard/section";
import {
  DEFAULT_TOP_MOVERS_CONFIG,
  describeTopMovers,
  normalizeTopMoversConfig,
} from "@/lib/dashboard/top-movers";
import { CoverWidget, CoverConfigForm } from "@/components/dashboard/widgets/cover-widget";
import { DEFAULT_COVER_CONFIG, readCoverConfig } from "@/lib/dashboard/report-blocks";
import {
  AiSummaryWidget,
  AiSummaryConfigForm,
} from "@/components/dashboard/widgets/ai-summary-widget";
import {
  ImageWidget,
  ImageConfigForm,
  DEFAULT_IMAGE_CONFIG,
  readImageConfig,
} from "@/components/dashboard/widgets/image-widget";
import {
  DEFAULT_CUSTOM_CONFIG,
  VISUALIZATION_FAMILIES,
  VISUALIZATION_LABELS,
  describeCustomWidget,
  normalizeCustomConfig,
  type CustomVisualization,
  type CustomWidgetConfig,
} from "@/lib/dashboard/custom-widget";

/**
 * Which rail of the "Add a widget" catalog a widget is offered under. This is a
 * BROWSING aid only — it says nothing about what the widget may become once it
 * is on the grid (every chart type is the same `custom` widget).
 */
export type CatalogGroup = "charts" | "metrics" | "attribution" | "layout";

export interface WidgetDefinition {
  type: WidgetType;
  /** From `WIDGET_META` — spread in, never written inline (see widget-meta.ts). */
  title: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  group: CatalogGroup;
  /**
   * Which grid this widget may be added to. Omitted = `"both"`. Mirrors
   * `widgetSurface()` in `@/lib/dashboard/types`, which is the server-safe
   * source of truth the PUT validators use — set both when adding a
   * surface-restricted widget.
   */
  surface?: WidgetSurface;
  /** From `WIDGET_META` too, so the grid, the catalog and the server agree. */
  defaultSize: WidgetFootprint;
  defaultConfig: Record<string, unknown>;
  Render: React.ComponentType<WidgetRenderProps>;
  /** Optional per-widget settings form shown in the config dialog. */
  ConfigForm?: React.ComponentType<WidgetConfigFormProps>;
  /** Optional extra card(s) the wide dialog places in its right column. */
  ConfigFormAside?: React.ComponentType<WidgetConfigFormProps>;
  /** Optional dynamic panel title derived from the widget's config. */
  getTitle?: (config: Record<string, unknown>) => string;
  /** Widget reads config.filters via useWidgetScope; the config dialog shows the shared filter form. */
  supportsFilters?: boolean;
  /**
   * Render without the Panel card chrome (no border, no title row). For a
   * widget that is page furniture rather than a card — a section header labels
   * the band below it, so a titled box would print its heading twice.
   */
  chromeless?: boolean;
  /**
   * Overrides the config dialog's size tier. Only set this when the SETTINGS
   * are heavier than the widget's output (a builder), because the tier is
   * otherwise derived from `defaultSize` — see `getWidgetConfigSize`.
   */
  configSize?: WidgetConfigSize;
  /**
   * Config-dependent tier, for a widget whose output size is chosen by the user
   * rather than fixed by its type (the custom builder: a number and a table are
   * the same widget). Takes precedence over `configSize`.
   */
  getConfigSize?: (config: Record<string, unknown>) => WidgetConfigSize;
}

/**
 * How much room a widget's config dialog — and above all its live preview —
 * deserves. A KPI showing one number and a nine-row trend chart do not need the
 * same preview, and giving the small ones the big one wastes most of the dialog.
 */
export type WidgetConfigSize = "sm" | "md" | "lg" | "xl";

/**
 * The tier for a widget, derived from the grid footprint it asks for by
 * default: that footprint is already the honest statement of how much content
 * the widget has, and deriving keeps the two from drifting apart. Cells are
 * `w` (of 12 columns) × `h` rows.
 *
 * - `sm` (≤16 cells) — KPI stat, Revenue & ROAS, Note: a number or a few lines.
 * - `md` (≤42) — Platform Breakdown, Health Score, Funnel, LTV:CAC.
 * - `lg` (>42) — Trend Chart, Campaign Table, Attribution Models.
 * - `xl` — opt-in only, for a widget whose FORM needs the room (Custom widget).
 *
 * `config` is only needed for widgets whose tier depends on what the user
 * picked; omitting it falls back to the type-level tier.
 */
export function getWidgetConfigSize(
  def: WidgetDefinition,
  config?: Record<string, unknown>
): WidgetConfigSize {
  if (config && def.getConfigSize) return def.getConfigSize(config);
  if (def.configSize) return def.configSize;
  const cells = def.defaultSize.w * def.defaultSize.h;
  if (cells <= 16) return "sm";
  if (cells <= 42) return "md";
  return "lg";
}

/** Config-dialog tier per custom-widget visualization — see the `custom` entry. */
const CUSTOM_CONFIG_SIZE: Record<CustomVisualization, WidgetConfigSize> = {
  number: "md",
  bar: "lg",
  pie: "lg",
  donut: "lg",
  line: "xl",
  area: "xl",
  combo: "xl",
  table: "xl",
  pivot: "xl",
};

// Registered widgets. Stage 2 appends the remaining catalog entries
// (campaign table, health gauge, funnel, revenue/ROAS, attribution, LTV).
export const WIDGET_LIST: WidgetDefinition[] = [
  {
    type: "custom",
    ...WIDGET_META.custom,
    description: "Pick metrics, split by platform, campaign, ad account or campaign type, show as number, line, bar or table.",
    icon: BiSliderAlt,
    group: "charts",
    defaultConfig: { ...DEFAULT_CUSTOM_CONFIG },
    Render: CustomWidget,
    ConfigForm: CustomWidgetConfigForm,
    ConfigFormAside: CustomWidgetTitleForm,
    supportsFilters: true,
    // The one widget whose output size is the user's choice, so the tier
    // follows the chosen visualization rather than the 6×7 default footprint.
    // A "number" is one figure and needs no more room than a KPI's dialog; a
    // table of up to six metric columns needs every inch, and the builder form
    // itself — metrics, group-by, buckets, sort — is what keeps that top tier
    // wide. Grouped bars sit between the two.
    getConfigSize: (c) => CUSTOM_CONFIG_SIZE[normalizeCustomConfig(c).visualization],
    getTitle: (c) => {
      const cfg = normalizeCustomConfig(c);
      return cfg.title ?? describeCustomWidget(cfg);
    },
  },
  {
    type: "kpi",
    ...WIDGET_META.kpi,
    description: "A single headline metric with period-over-period change.",
    icon: BiHash,
    group: "metrics",
    defaultConfig: { metric: "spend" },
    Render: KpiWidget,
    ConfigForm: KpiConfigForm,
    ConfigFormAside: KpiTitleForm,
    supportsFilters: true,
    getTitle: kpiTitle,
  },
  {
    type: "trend",
    ...WIDGET_META.trend,
    description: "Daily line chart for one or more metrics over the date range.",
    icon: BiLineChart,
    group: "charts",
    defaultConfig: { metrics: ["spend", "conversions"] },
    Render: TrendWidget,
    ConfigForm: TrendConfigForm,
    supportsFilters: true,
  },
  {
    type: "platform-breakdown",
    ...WIDGET_META["platform-breakdown"],
    description: "Spend or conversions split across Google, Meta and TikTok.",
    icon: BiBarChartAlt2,
    group: "charts",
    defaultConfig: { metric: "spend" },
    Render: PlatformBreakdownWidget,
    supportsFilters: true,
  },
  {
    type: "note",
    ...WIDGET_META.note,
    description: "Freeform Markdown text — context, goals, reminders.",
    icon: BiNote,
    group: "layout",
    defaultConfig: { text: "" },
    Render: NoteWidget,
    ConfigForm: NoteConfigForm,
  },
  {
    type: "campaign-table",
    ...WIDGET_META["campaign-table"],
    description: "Top campaigns by spend/conversions with CTR and CPA.",
    icon: BiTable,
    group: "metrics",
    defaultConfig: { limit: 8, sortBy: "spend" },
    Render: CampaignTableWidget,
    ConfigForm: CampaignTableConfigForm,
    supportsFilters: true,
  },
  {
    type: "health-gauge",
    ...WIDGET_META["health-gauge"],
    description: "Overall account health gauge, grade and top fixes.",
    icon: BiPulse,
    group: "metrics",
    defaultConfig: {},
    Render: HealthGaugeWidget,
    supportsFilters: true,
  },
  {
    type: "funnel",
    ...WIDGET_META.funnel,
    description: "Impressions → clicks → conversions with step rates.",
    icon: BiFilterAlt,
    group: "charts",
    defaultConfig: {},
    Render: FunnelWidget,
    supportsFilters: true,
  },
  {
    type: "revenue-roas",
    ...WIDGET_META["revenue-roas"],
    description: "Blended ROAS, real revenue and AOV (deduplicated).",
    icon: BiDollar,
    group: "attribution",
    defaultConfig: {},
    Render: RevenueRoasWidget,
  },
  {
    type: "attribution-mini",
    ...WIDGET_META["attribution-mini"],
    description: "First-touch vs last-touch credit across platforms.",
    icon: BiGitBranch,
    group: "attribution",
    defaultConfig: { modelA: "first_touch", modelB: "last_touch" },
    Render: AttributionMiniWidget,
  },
  {
    type: "ltv-cac",
    ...WIDGET_META["ltv-cac"],
    description: "Lifetime value vs acquisition cost by channel.",
    icon: BiGroup,
    group: "attribution",
    defaultConfig: {},
    Render: LtvCacWidget,
  },
  {
    type: "top-movers",
    ...WIDGET_META["top-movers"],
    description: "Biggest risers and fallers versus the period before.",
    icon: BiTransferAlt,
    group: "metrics",
    defaultConfig: { ...DEFAULT_TOP_MOVERS_CONFIG },
    Render: TopMoversWidget,
    ConfigForm: TopMoversConfigForm,
    supportsFilters: true,
    getTitle: (c) => describeTopMovers(normalizeTopMoversConfig(c)),
  },
  {
    type: "section",
    ...WIDGET_META.section,
    description: "A labelled band separator for long dashboards. No data.",
    icon: BiHeading,
    group: "layout",
    defaultConfig: { ...DEFAULT_SECTION_CONFIG },
    Render: SectionWidget,
    ConfigForm: SectionConfigForm,
    chromeless: true,
    getTitle: (c) => readSectionConfig(c).title,
  },
  {
    type: "image",
    ...WIDGET_META.image,
    description: "A logo, screenshot or diagram, uploaded and scaled to the tile.",
    icon: BiImage,
    group: "layout",
    defaultConfig: { ...DEFAULT_IMAGE_CONFIG },
    Render: ImageWidget,
    ConfigForm: ImageConfigForm,
    // A logo or a screenshot is not a card, and the title row would print the
    // alt text as a caption — alt text is for screen readers, not for display.
    chromeless: true,
    // Not shown on the grid (chromeless), but it still names the widget in the
    // config dialog and the save-to-library prompt.
    getTitle: (c) => readImageConfig(c).alt || "Image",
  },
  {
    type: "cover",
    ...WIDGET_META.cover,
    description: "Report title page: client name, title and the reporting period.",
    icon: BiIdCard,
    group: "layout",
    surface: "report",
    defaultConfig: { ...DEFAULT_COVER_CONFIG },
    Render: CoverWidget,
    ConfigForm: CoverConfigForm,
    // A cover is the page's own heading, not a card sitting on the page.
    chromeless: true,
    getTitle: (c) => readCoverConfig(c).title,
  },
  {
    type: "ai-summary",
    ...WIDGET_META["ai-summary"],
    description: "A written analysis of the period, generated with the report.",
    icon: BiBot,
    group: "layout",
    surface: "report",
    defaultConfig: {},
    Render: AiSummaryWidget,
    ConfigForm: AiSummaryConfigForm,
    // The generated prose is the page's own body copy, not a card sitting on
    // the page — a bordered box titled "AI summary" is exactly what a report
    // reader should not see. On the editor canvas the frame's own dashed
    // outline and floating actions take over, same as a cover or a section.
    chromeless: true,
  },
];

export const WIDGETS: Partial<Record<WidgetType, WidgetDefinition>> = Object.fromEntries(
  WIDGET_LIST.map((w) => [w.type, w])
);

export function getWidget(type: WidgetType): WidgetDefinition | undefined {
  return WIDGETS[type];
}

// --- Catalog entries -------------------------------------------------------
//
// A tile in "Add a widget". NOT one per widget type: the nine chart types are
// all the same `custom` widget with a different `visualization`, and each one
// gets its own tile so a user can see that "Pie" exists without opening a
// builder first. Nothing about the tile survives the add — the widget it
// creates is an ordinary `custom` widget that can still become any other chart.

export interface CatalogEntry {
  /** Stable tile key: the widget type, or `chart-<visualization>`. */
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  group: CatalogGroup;
  type: WidgetType;
  /** Inherited from the widget definition — see `catalogForSurface`. */
  surface: WidgetSurface;
  defaultSize: { w: number; h: number; minW: number; minH: number };
  defaultConfig: Record<string, unknown>;
  /**
   * Extra search terms — the words people type that the tile does not print:
   * synonyms ("share", "ranking"), and the vocabulary the UI used to use. Never
   * rendered; the catalog matches against them alongside title and description.
   */
  keywords?: string[];
}

type Size = WidgetDefinition["defaultSize"];

/**
 * Per-visualization tile trimmings. All three are PARTIAL on purpose: a tenth
 * chart type added to CUSTOM_VISUALIZATIONS gets a tile with no catalog edit —
 * it just inherits the `custom` widget's icon, size and a generated blurb until
 * someone gives it better ones.
 */
const CHART_ICONS: Partial<Record<CustomVisualization, WidgetDefinition["icon"]>> = {
  number: BiHash,
  line: BiLineChart,
  area: BiArea,
  combo: BiChart,
  bar: BiBarChartAlt2,
  pie: BiPieChartAlt2,
  donut: BiDoughnutChart,
  table: BiTable,
  pivot: BiGridAlt,
};

const CHART_DESCRIPTIONS: Partial<Record<CustomVisualization, string>> = {
  number: "One headline figure and its change on the period before.",
  line: "How one or more metrics move over time.",
  area: "The same shape filled in — stack it to show composition.",
  combo: "Bars for one metric against a line for another.",
  bar: "Compare platforms or campaigns side by side.",
  pie: "Share of a total across platforms or campaigns.",
  donut: "Share of a total, with the total in the middle.",
  table: "Rows of platforms, campaigns or dates; metrics as columns.",
  pivot: "One metric as a grid: groups down, time across.",
};

/**
 * The footprint each shape actually needs. A number is a KPI-sized stat and
 * must not drop a 6×7 block on the grid; a table or a pivot is mostly columns,
 * so it starts wide; a pie is square-ish and starts narrow.
 */
const CHART_SIZES: Partial<Record<CustomVisualization, Size>> = {
  number: { w: 3, h: 3, minW: 2, minH: 3 },
  line: { w: 6, h: 7, minW: 4, minH: 5 },
  area: { w: 6, h: 7, minW: 4, minH: 5 },
  combo: { w: 6, h: 7, minW: 4, minH: 5 },
  bar: { w: 6, h: 7, minW: 3, minH: 4 },
  pie: { w: 4, h: 7, minW: 3, minH: 5 },
  donut: { w: 4, h: 7, minW: 3, minH: 5 },
  table: { w: 8, h: 8, minW: 4, minH: 5 },
  pivot: { w: 8, h: 8, minW: 4, minH: 5 },
};

/**
 * The footprint a chart type asks for, with the `custom` widget's own default
 * (WIDGET_META) as the fallback for a visualization nobody has sized yet. Every
 * caller that drops a chart on the grid — the catalog tile AND the Builder
 * Assistant — goes through here, so a number never lands as a 6×7 block.
 */
export function chartDefaultSize(viz: CustomVisualization): Size {
  return CHART_SIZES[viz] ?? WIDGET_META.custom.defaultSize;
}

/**
 * Seeds for the shapes whose point is lost with the default single metric: a
 * combo is bars *against* a line, and a one-column table is not a table.
 */
const CHART_SEEDS: Partial<Record<CustomVisualization, Partial<CustomWidgetConfig>>> = {
  combo: { metrics: ["spend", "conversions"] },
  table: { metrics: ["spend", "clicks", "conversions", "cpa"] },
};

/**
 * Terms every chart tile answers to. "custom" above all: that was the name of
 * the single tile these nine replaced, and someone who learned it must not hit
 * a dead end. A tenth visualization gets these for free.
 */
const CHART_BASE_KEYWORDS = ["custom", "chart", "build"];

/** Words users say for a shape that the tile itself never prints. */
const CHART_KEYWORDS: Partial<Record<CustomVisualization, string[]>> = {
  number: ["kpi", "scorecard", "stat", "total"],
  line: ["trend", "time series"],
  area: ["trend", "time series"],
  combo: ["dual axis", "two metrics"],
  bar: ["compare", "column", "ranking"],
  pie: ["share", "split", "breakdown", "percent"],
  donut: ["share", "split", "breakdown", "percent"],
  table: ["grid", "rows", "cross tab"],
  pivot: ["grid", "rows", "cross tab"],
};

/** Aliases for the tiles that are one fixed widget rather than a chart type. */
const ENTRY_KEYWORDS: Partial<Record<WidgetType, string[]>> = {
  section: ["heading", "divider", "title"],
  image: ["logo", "picture", "upload"],
  "top-movers": ["changes", "risers", "fallers", "biggest"],
};

/** Every chart type, in the same order the builder's type picker offers them. */
const CHART_ORDER: CustomVisualization[] = VISUALIZATION_FAMILIES.flatMap((f) => [...f.types]);

/** "Over time", "Part-to-whole"… — free search terms for any chart type. */
const CHART_FAMILY_LABEL = new Map<CustomVisualization, string>(
  VISUALIZATION_FAMILIES.flatMap((f) => f.types.map((t) => [t, f.label.toLowerCase()] as const))
);

function chartKeywords(viz: CustomVisualization): string[] {
  const terms = [
    ...CHART_BASE_KEYWORDS,
    CHART_FAMILY_LABEL.get(viz) ?? "",
    ...(CHART_KEYWORDS[viz] ?? []),
  ].filter(Boolean);
  return terms.filter((t, i) => terms.indexOf(t) === i);
}

function chartEntry(def: WidgetDefinition, viz: CustomVisualization): CatalogEntry {
  return {
    id: `chart-${viz}`,
    surface: def.surface ?? "both",
    keywords: chartKeywords(viz),
    title: VISUALIZATION_LABELS[viz],
    description: CHART_DESCRIPTIONS[viz] ?? `${VISUALIZATION_LABELS[viz]} of the metrics you pick.`,
    icon: CHART_ICONS[viz] ?? def.icon,
    group: "charts",
    type: def.type,
    defaultSize: CHART_SIZES[viz] ?? def.defaultSize,
    // normalizeCustomConfig snaps groupBy/timeBucket/metrics to what this chart
    // type allows, so no tile can add a widget its own rules would reject.
    defaultConfig: {
      ...normalizeCustomConfig({ ...DEFAULT_CUSTOM_CONFIG, ...CHART_SEEDS[viz], visualization: viz }),
    },
  };
}

/** Tiles, in registry order — the `custom` definition expanding into nine. */
export const CATALOG_LIST: CatalogEntry[] = WIDGET_LIST.flatMap((def) =>
  def.type === "custom"
    ? CHART_ORDER.map((viz) => chartEntry(def, viz))
    : [
        {
          id: def.type,
          title: def.title,
          description: def.description,
          icon: def.icon,
          group: def.group,
          type: def.type,
          surface: def.surface ?? "both",
          defaultSize: def.defaultSize,
          defaultConfig: def.defaultConfig,
          ...(ENTRY_KEYWORDS[def.type] ? { keywords: ENTRY_KEYWORDS[def.type] } : {}),
        },
      ]
);

/**
 * The tiles offered on one grid: a dashboard never lists report-only blocks (a
 * cover page, an AI summary), and a report layout lists them alongside
 * everything else. `surfaceAllows` is the same rule the PUT validators enforce,
 * so the catalog can never offer a tile the save would reject.
 */
export function catalogForSurface(surface: GridSurface): CatalogEntry[] {
  return CATALOG_LIST.filter((entry) => surfaceAllows(entry.type, surface));
}
