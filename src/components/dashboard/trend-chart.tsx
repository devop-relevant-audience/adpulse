"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDailyTrend } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const METRICS = [
  { key: "spend", label: "Spend", color: "#0075de", prefix: "$", yAxisId: "left" },
  { key: "conversions", label: "Conversions", color: "#16a34a", prefix: "", yAxisId: "right" },
  { key: "clicks", label: "Clicks", color: "#f59e0b", prefix: "", yAxisId: "right" },
  { key: "impressions", label: "Impressions", color: "#8b5cf6", prefix: "", yAxisId: "right" },
  { key: "ctr", label: "CTR", color: "#ef4444", prefix: "", suffix: "%", yAxisId: "right" },
  { key: "cpc", label: "CPC", color: "#06b6d4", prefix: "$", yAxisId: "right" },
  { key: "cpa", label: "CPA", color: "#ec4899", prefix: "$", yAxisId: "right" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

export function TrendChart() {
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
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  const primaryMetric = METRICS.find((m) => m.key === activeMetrics[0])!;

  const formatYValue = (value: number, metric: (typeof METRICS)[number]) => {
    const prefix = metric.prefix || "";
    const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
    if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M${suffix}`;
    if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(0)}K${suffix}`;
    return `${prefix}${value.toLocaleString()}${suffix}`;
  };

  return (
    <div className="bg-white rounded-xl border border-hairline">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-ink">Performance Over Time</h3>
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
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all border",
                isActive
                  ? "border-transparent shadow-sm"
                  : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
              )}
              style={isActive ? { backgroundColor: `${metric.color}10`, color: metric.color, borderColor: `${metric.color}30` } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: isActive ? metric.color : "#a39e98" }}
              />
              {metric.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={trend}
            onClick={(e: unknown) => {
              const event = e as { activePayload?: Array<{ payload: Record<string, unknown> }> } | null;
              if (event?.activePayload?.[0]) {
                const point = event.activePayload[0].payload;
                setReferenceContext({
                  metric: activeMetrics[0],
                  dateRange: { start: point.date as string, end: point.date as string },
                  platform,
                  value: point[activeMetrics[0]] as number,
                });
              }
            }}
            className="cursor-crosshair"
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
            <CartesianGrid stroke="#f0f0f0" strokeDasharray="none" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(parseISO(v), "MMM d")}
              tick={{ fontSize: 11, fill: "#a39e98" }}
              axisLine={false}
              tickLine={false}
              dy={8}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: "#a39e98" }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(v) => formatYValue(v, primaryMetric)}
            />
            {activeMetrics.length > 1 && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#a39e98" }}
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
                const prefix = metric.prefix || "";
                const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
                return [`${prefix}${Number(value).toLocaleString()}${suffix}`, metric.label];
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={0}
              wrapperStyle={{ display: "none" }}
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
                  name={key}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
