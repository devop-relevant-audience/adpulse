"use client";

import { format, subDays } from "date-fns";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useComparison } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  METRIC_OPTIONS,
  getMetricOption,
  formatMetric,
} from "@/lib/dashboard/metrics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

function readMetric(config: Record<string, unknown>): string {
  const m = config.metric;
  return typeof m === "string" && METRIC_OPTIONS.some((o) => o.value === m) ? m : "spend";
}

export function KpiWidget({ config }: WidgetRenderProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  const metric = getMetricOption(readMetric(config));

  const daysDiff = Math.round(
    (new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const previousEnd = format(subDays(new Date(dateRange.start), 1), "yyyy-MM-dd");
  const previousStart = format(subDays(new Date(dateRange.start), daysDiff + 1), "yyyy-MM-dd");

  const { data: comparison, isLoading } = useComparison({
    clientId,
    currentStart: dateRange.start,
    currentEnd: dateRange.end,
    previousStart,
    previousEnd,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className="h-full flex flex-col justify-center gap-2 px-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }
  if (!comparison) return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  const value = comparison.current[metric.summaryKey];
  const prev = comparison.previous[metric.summaryKey];
  const delta = comparison.deltas[metric.summaryKey]?.percentage ?? 0;
  const isNeutral = delta === 0;
  const isPositive = delta > 0;
  const isGood = isNeutral ? true : (isPositive && !metric.invert) || (!isPositive && metric.invert);

  return (
    <button
      type="button"
      onClick={() =>
        setReferenceContext({ metric: metric.value, dateRange, platform, value: delta })
      }
      className="h-full w-full flex flex-col justify-center text-left px-1 group"
    >
      <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">{metric.label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink leading-tight truncate mt-1">
        {formatMetric(value, metric.format)}
      </p>
      <div className="flex items-center gap-2 mt-2">
        {!isNeutral && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded",
              isGood ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
            )}
          >
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="text-[11px] text-ink-muted truncate">
          vs {formatMetric(prev, metric.format)}
        </span>
      </div>
    </button>
  );
}

export function KpiConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const metric = readMetric(config);
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-ink-secondary">Metric</label>
      <Select value={metric} onValueChange={(v) => onChange({ ...config, metric: v })}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {METRIC_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
