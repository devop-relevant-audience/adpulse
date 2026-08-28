"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format } from "date-fns";
import { useDailyTrend } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { METRIC_OPTIONS, getMetricOption } from "@/lib/dashboard/metrics";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

// Trend uses the daily-trend row keys, so only metrics with a real per-day
// series are offered (excludes CPM, which the trend endpoint doesn't return).
const TREND_METRICS = METRIC_OPTIONS.filter((m) => m.value !== "cpm");

function readMetrics(config: Record<string, unknown>): string[] {
  const raw = config.metrics;
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  const valid = list.filter((v) => TREND_METRICS.some((m) => m.value === v));
  return valid.length > 0 ? valid : ["spend"];
}

export function TrendWidget({ config }: WidgetRenderProps) {
  const { clientId, dateRange, platforms, campaignIds } = useWidgetScope(config);

  const metrics = readMetrics(config).map(getMetricOption);

  const { data, isLoading, isError, refetch } = useDailyTrend({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platforms,
    campaignIds,
  });

  if (!clientId || isLoading) return <Skeleton className="h-full w-full" />;
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (!data || data.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No trend data</div>;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        {metrics.map((m) => (
          <span key={m.value} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color }} />
            {m.label}
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a39e98" }}
              tickFormatter={(d) => format(new Date(d), "MMM d")}
              minTickGap={24}
            />
            <YAxis tick={{ fontSize: 10, fill: "#a39e98" }} width={40} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #ececec" }}
              labelFormatter={(d) => format(new Date(d as string), "MMM d, yyyy")}
            />
            {metrics.map((m) => (
              <Line
                key={m.value}
                type="monotone"
                dataKey={m.trendKey}
                name={m.label}
                stroke={m.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const selected = readMetrics(config);
  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange({ ...config, metrics: next.length > 0 ? next : ["spend"] });
  }
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-ink-secondary">Metrics to plot</label>
      <div className="flex flex-wrap gap-2">
        {TREND_METRICS.map((m) => {
          const active = selected.includes(m.value);
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => toggle(m.value)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md border transition-colors",
                active
                  ? "border-primary bg-primary/8 text-primary font-medium"
                  : "border-hairline text-ink-muted hover:text-ink"
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
