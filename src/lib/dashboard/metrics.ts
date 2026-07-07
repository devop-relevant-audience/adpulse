// Shared metric catalog + formatters for dashboard widgets (KPI, trend, config
// forms). Keys line up with the ComparisonResult summary/delta shape from
// src/lib/data/queries.ts and the daily-trend row shape.
import type { PeriodSummary } from "@/lib/data/queries";

export type MetricFormat = "currency" | "number" | "percent";

export interface MetricOption {
  value: string;
  label: string;
  /** Key into ComparisonResult.current / .previous (PeriodSummary). */
  summaryKey: keyof PeriodSummary;
  /** Key into the daily-trend row (getDailyTrend). */
  trendKey: "spend" | "conversions" | "clicks" | "impressions" | "ctr" | "cpc" | "cpa";
  format: MetricFormat;
  /** For metrics where lower is better (CPA/CPC/CPM), a decrease is "good". */
  invert: boolean;
  /** Chart line color. */
  color: string;
}

export const METRIC_OPTIONS: MetricOption[] = [
  { value: "spend", label: "Spend", summaryKey: "totalSpend", trendKey: "spend", format: "currency", invert: false, color: "#0075de" },
  { value: "conversions", label: "Conversions", summaryKey: "totalConversions", trendKey: "conversions", format: "number", invert: false, color: "#16a34a" },
  { value: "cpa", label: "CPA", summaryKey: "avgCpa", trendKey: "cpa", format: "currency", invert: true, color: "#f59e0b" },
  { value: "ctr", label: "CTR", summaryKey: "avgCtr", trendKey: "ctr", format: "percent", invert: false, color: "#8b5cf6" },
  { value: "cpc", label: "CPC", summaryKey: "avgCpc", trendKey: "cpc", format: "currency", invert: true, color: "#ec4899" },
  { value: "clicks", label: "Clicks", summaryKey: "totalClicks", trendKey: "clicks", format: "number", invert: false, color: "#06b6d4" },
  { value: "impressions", label: "Impressions", summaryKey: "totalImpressions", trendKey: "impressions", format: "number", invert: false, color: "#64748b" },
  { value: "cpm", label: "CPM", summaryKey: "avgCpm", trendKey: "cpc", format: "currency", invert: true, color: "#f97316" },
];

export function getMetricOption(value: string): MetricOption {
  return METRIC_OPTIONS.find((m) => m.value === value) ?? METRIC_OPTIONS[0];
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 100_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatMetric(value: number, format: MetricFormat): string {
  switch (format) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return `${value.toFixed(2)}%`;
    case "number":
      return formatNumber(value);
  }
}
