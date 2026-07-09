"use client";

import { BiHash, BiLineChart, BiBarChartAlt2, BiNote, BiTable, BiPulse, BiFilterAlt, BiDollar, BiGitBranch, BiGroup } from "react-icons/bi";
import type {
  WidgetType,
  WidgetRenderProps,
  WidgetConfigFormProps,
} from "@/lib/dashboard/types";
import { KpiWidget, KpiConfigForm } from "@/components/dashboard/widgets/kpi-widget";
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

export type WidgetCategory = "metrics" | "charts" | "attribution" | "other";

export interface WidgetDefinition {
  type: WidgetType;
  title: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  category: WidgetCategory;
  defaultSize: { w: number; h: number; minW: number; minH: number };
  defaultConfig: Record<string, unknown>;
  Render: React.ComponentType<WidgetRenderProps>;
  /** Optional per-widget settings form shown in the config dialog. */
  ConfigForm?: React.ComponentType<WidgetConfigFormProps>;
  /** Optional dynamic panel title derived from the widget's config. */
  getTitle?: (config: Record<string, unknown>) => string;
}

// Registered widgets. Stage 2 appends the remaining catalog entries
// (campaign table, health gauge, funnel, revenue/ROAS, attribution, LTV).
export const WIDGET_LIST: WidgetDefinition[] = [
  {
    type: "kpi",
    title: "KPI Stat",
    description: "A single headline metric with period-over-period change.",
    icon: BiHash,
    category: "metrics",
    defaultSize: { w: 3, h: 3, minW: 2, minH: 3 },
    defaultConfig: { metric: "spend" },
    Render: KpiWidget,
    ConfigForm: KpiConfigForm,
    getTitle: (c) => {
      const map: Record<string, string> = {
        spend: "Spend", conversions: "Conversions", cpa: "CPA", ctr: "CTR",
        cpc: "CPC", clicks: "Clicks", impressions: "Impressions", cpm: "CPM",
      };
      return map[String(c.metric)] ?? "KPI";
    },
  },
  {
    type: "trend",
    title: "Trend Chart",
    description: "Daily line chart for one or more metrics over the date range.",
    icon: BiLineChart,
    category: "charts",
    defaultSize: { w: 8, h: 9, minW: 4, minH: 6 },
    defaultConfig: { metrics: ["spend", "conversions"] },
    Render: TrendWidget,
    ConfigForm: TrendConfigForm,
  },
  {
    type: "platform-breakdown",
    title: "Platform Breakdown",
    description: "Spend or conversions split across Google, Meta and TikTok.",
    icon: BiBarChartAlt2,
    category: "charts",
    defaultSize: { w: 4, h: 7, minW: 3, minH: 5 },
    defaultConfig: { metric: "spend" },
    Render: PlatformBreakdownWidget,
  },
  {
    type: "note",
    title: "Note",
    description: "Freeform Markdown text — context, goals, reminders.",
    icon: BiNote,
    category: "other",
    defaultSize: { w: 4, h: 4, minW: 2, minH: 2 },
    defaultConfig: { text: "" },
    Render: NoteWidget,
    ConfigForm: NoteConfigForm,
  },
  {
    type: "campaign-table",
    title: "Campaign Table",
    description: "Top campaigns by spend/conversions with CTR and CPA.",
    icon: BiTable,
    category: "metrics",
    defaultSize: { w: 6, h: 8, minW: 4, minH: 5 },
    defaultConfig: { limit: 8, sortBy: "spend" },
    Render: CampaignTableWidget,
    ConfigForm: CampaignTableConfigForm,
  },
  {
    type: "health-gauge",
    title: "Health Score",
    description: "Overall account health gauge, grade and top fixes.",
    icon: BiPulse,
    category: "metrics",
    defaultSize: { w: 4, h: 8, minW: 3, minH: 6 },
    defaultConfig: {},
    Render: HealthGaugeWidget,
  },
  {
    type: "funnel",
    title: "Conversion Funnel",
    description: "Impressions → clicks → conversions with step rates.",
    icon: BiFilterAlt,
    category: "charts",
    defaultSize: { w: 6, h: 7, minW: 4, minH: 5 },
    defaultConfig: {},
    Render: FunnelWidget,
  },
  {
    type: "revenue-roas",
    title: "Revenue & ROAS",
    description: "Blended ROAS, real revenue and AOV (deduplicated).",
    icon: BiDollar,
    category: "attribution",
    defaultSize: { w: 3, h: 3, minW: 3, minH: 3 },
    defaultConfig: {},
    Render: RevenueRoasWidget,
  },
  {
    type: "attribution-mini",
    title: "Attribution Models",
    description: "First-touch vs last-touch credit across platforms.",
    icon: BiGitBranch,
    category: "attribution",
    defaultSize: { w: 6, h: 8, minW: 4, minH: 6 },
    defaultConfig: { modelA: "first_touch", modelB: "last_touch" },
    Render: AttributionMiniWidget,
  },
  {
    type: "ltv-cac",
    title: "LTV : CAC",
    description: "Lifetime value vs acquisition cost by channel.",
    icon: BiGroup,
    category: "attribution",
    defaultSize: { w: 6, h: 7, minW: 4, minH: 5 },
    defaultConfig: {},
    Render: LtvCacWidget,
  },
];

export const WIDGETS: Partial<Record<WidgetType, WidgetDefinition>> = Object.fromEntries(
  WIDGET_LIST.map((w) => [w.type, w])
);

export function getWidget(type: WidgetType): WidgetDefinition | undefined {
  return WIDGETS[type];
}
