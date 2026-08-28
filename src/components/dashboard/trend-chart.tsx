"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDailyTrend } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useState, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { SERIES_PALETTE, CHART_GRID, CHART_AXIS_TEXT } from "@/lib/dashboard/chart-theme";
import { useCurrencyFormat } from "@/hooks/use-currency-format";

// Colors are drawn deterministically from the canonical SERIES_PALETTE (blue,
// violet, cyan, pink, teal, indigo, fuchsia) — one entry per metric, by index.
// The palette deliberately excludes red/green/amber, so no metric line ever
// reads as a good/bad semantic signal (CTR isn't red, CPA isn't an alarm).
const METRICS = [
  { key: "spend", label: "Spend", color: SERIES_PALETTE[0], isCurrency: true, yAxisId: "left" },
  { key: "conversions", label: "Conversions", color: SERIES_PALETTE[1], isCurrency: false, yAxisId: "right" },
  { key: "clicks", label: "Clicks", color: SERIES_PALETTE[2], isCurrency: false, yAxisId: "right" },
  { key: "impressions", label: "Impressions", color: SERIES_PALETTE[3], isCurrency: false, yAxisId: "right" },
  { key: "ctr", label: "CTR", color: SERIES_PALETTE[4], isCurrency: false, suffix: "%", yAxisId: "right" },
  { key: "cpc", label: "CPC", color: SERIES_PALETTE[5], isCurrency: true, yAxisId: "right" },
  { key: "cpa", label: "CPA", color: SERIES_PALETTE[6], isCurrency: true, yAxisId: "right" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

export function TrendChart() {
  const { symbol } = useCurrencyFormat();
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["spend", "conversions"]);

  const { data: trend, isLoading } = useDailyTrend({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const handleChartClick = useCallback((nextState: unknown, event: unknown) => {
    // Recharts sometimes passes the event as the first argument if clicked outside the active area
    const state = (nextState as { activePayload?: unknown })?.activePayload ? nextState : event;
    const typedState = state as {
      activePayload?: Array<{ payload: Record<string, unknown> }>;
      activeLabel?: string;
      chartX?: number;
      chartY?: number;
    } | null;
    const typedNextState = nextState as {
      activeLabel?: string;
      chartX?: number;
      chartY?: number;
    } | null;
    
    let point = null;
    if (typedState?.activePayload?.[0]?.payload) {
      point = typedState.activePayload[0].payload;
    } else if (typedState?.activeLabel && trend) {
      point = trend.find((t) => t.date === typedState.activeLabel);
    } else if (typedNextState?.activeLabel && trend) {
      point = trend.find((t) => t.date === typedNextState.activeLabel);
    }

    if (!point) {
      // If we still don't have a point, we might have clicked outside the active area.
      return;
    }

    const date = point.date as string;

    setReferenceContext({
      metric: activeMetrics[0],
      dateRange: { start: date, end: date },
      platform,
      value: point[activeMetrics[0]] as number,
    });
  }, [activeMetrics, platform, setReferenceContext, trend]);

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== key);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), key];
      }
      return [...prev, key];
    });
  };

  if (!clientId) {
    return (
      <Panel className="p-5">
        <Skeleton className="h-[320px] w-full" />
      </Panel>
    );
  }

  if (isLoading) {
    return (
      <Panel className="p-5">
        <Skeleton className="h-[320px] w-full" />
      </Panel>
    );
  }

  const primaryMetric = METRICS.find((m) => m.key === activeMetrics[0])!;

  const formatYValue = (value: number, metric: (typeof METRICS)[number]) => {
    const prefix = metric.isCurrency ? symbol : "";
    const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
    if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M${suffix}`;
    if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(0)}K${suffix}`;
    return `${prefix}${value.toLocaleString()}${suffix}`;
  };

  return (
    <Panel>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-ink">Performance over time</h3>
      </div>

      {/* Metric Toggles */}
      <div className="flex items-center gap-1.5 px-5 pb-3 flex-wrap">
        {METRICS.map((metric) => {
          const isActive = activeMetrics.includes(metric.key);
          return (
            <button
              key={metric.key}
              onClick={() => toggleMetric(metric.key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all border outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive
                  ? "border-transparent shadow-sm"
                  : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
              )}
              style={isActive ? { backgroundColor: `${metric.color}10`, color: metric.color, borderColor: `${metric.color}30` } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: isActive ? metric.color : "#6b6b6b" }}
              />
              {metric.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div
        className="px-2 pb-4 relative"
        role="group"
        aria-label="Trend chart — click a point to add it to the AI assistant"
      >
        <ResponsiveContainer width="100%" height={300} style={{ outline: "none" }}>
          <ComposedChart
            data={trend}
            onClick={handleChartClick}
            className="cursor-crosshair focus:outline-none"
            style={{ outline: "none", userSelect: "none" }}
          >
            <defs>
              {activeMetrics.map((key) => {
                const metric = METRICS.find((m) => m.key === key)!;
                return (
                  <linearGradient key={`grad-${key}`} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={metric.color} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="none" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(parseISO(v), "MMM d")}
              tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }}
              axisLine={false}
              tickLine={false}
              dy={8}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(v) => formatYValue(v, primaryMetric)}
            />
            {activeMetrics.length > 1 && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }}
                axisLine={false}
                tickLine={false}
                width={55}
                tickFormatter={(v) => {
                  const secondMetric = METRICS.find((m) => m.key === activeMetrics[1])!;
                  return formatYValue(v, secondMetric);
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e6e6e6",
                borderRadius: "10px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                padding: "10px 14px",
              }}
              labelFormatter={(v) => format(parseISO(v as string), "EEE, MMM d, yyyy")}
              formatter={(value, name) => {
                const metric = METRICS.find((m) => m.key === name);
                if (!metric) return [String(value), String(name)];
                const prefix = metric.isCurrency ? symbol : "";
                const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
                return [`${prefix}${Number(value).toLocaleString()}${suffix}`, metric.label];
              }}
            />

            {activeMetrics.map((key, idx) => {
              const metric = METRICS.find((m) => m.key === key)!;
              const yAxisId = idx === 0 ? "left" : "right";

              if (idx === 0) {
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    yAxisId={yAxisId}
                    stroke={metric.color}
                    strokeWidth={2}
                    fill={`url(#grad-${key})`}
                    dot={false}
                    activeDot={{ r: 4, fill: metric.color, stroke: "white", strokeWidth: 2 }}
                    animationDuration={300}
                    name={key}
                  />
                );
              }

              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  yAxisId={yAxisId}
                  stroke={metric.color}
                  strokeWidth={2}
                  strokeDasharray={idx > 1 ? "6 3" : undefined}
                  dot={false}
                  activeDot={{ r: 4, fill: metric.color, stroke: "white", strokeWidth: 2 }}
                  animationDuration={300}
                  name={key}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
