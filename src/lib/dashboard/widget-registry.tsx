"use client";

import type { LucideIcon } from "lucide-react";
import { Hash, LineChart, PieChart, StickyNote } from "lucide-react";
import type {
  WidgetType,
  WidgetRenderProps,
  WidgetConfigFormProps,
} from "@/lib/dashboard/types";
import { KpiWidget, KpiConfigForm } from "@/components/dashboard/widgets/kpi-widget";
import { TrendWidget, TrendConfigForm } from "@/components/dashboard/widgets/trend-widget";
import { PlatformBreakdownWidget } from "@/components/dashboard/widgets/platform-breakdown-widget";
import { NoteWidget, NoteConfigForm } from "@/components/dashboard/widgets/note-widget";

export type WidgetCategory = "metrics" | "charts" | "attribution" | "other";

export interface WidgetDefinition {
  type: WidgetType;
  title: string;
  description: string;
  icon: LucideIcon;
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
    icon: Hash,
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
    icon: LineChart,
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
    icon: PieChart,
    category: "charts",
    defaultSize: { w: 4, h: 7, minW: 3, minH: 5 },
    defaultConfig: { metric: "spend" },
    Render: PlatformBreakdownWidget,
  },
  {
    type: "note",
    title: "Note",
    description: "Freeform Markdown text — context, goals, reminders.",
    icon: StickyNote,
    category: "other",
    defaultSize: { w: 4, h: 4, minW: 2, minH: 2 },
    defaultConfig: { text: "" },
    Render: NoteWidget,
    ConfigForm: NoteConfigForm,
  },
];

export const WIDGETS: Partial<Record<WidgetType, WidgetDefinition>> = Object.fromEntries(
  WIDGET_LIST.map((w) => [w.type, w])
);

export function getWidget(type: WidgetType): WidgetDefinition | undefined {
  return WIDGETS[type];
}
