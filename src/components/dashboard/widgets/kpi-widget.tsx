"use client";

import { useMemo } from "react";
import { format, subDays } from "date-fns";
import { BiTrendingUp, BiTrendingDown } from "react-icons/bi";
import { useComparison } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { getCompareRange, COMPARE_MODE_LABELS } from "@/lib/dashboard/date-presets";
import { useRegisterWidgetData, type WidgetData } from "@/lib/dashboard/widget-data";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import {
  METRIC_OPTIONS,
  getMetricOption,
  formatMetric,
} from "@/lib/dashboard/metrics";
import { useClientCurrency } from "@/hooks/use-currency-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfigSection } from "@/components/dashboard/config-ui";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

function readMetric(config: Record<string, unknown>): string {
  const m = config.metric;
  return typeof m === "string" && METRIC_OPTIONS.some((o) => o.value === m) ? m : "spend";
}

export function KpiWidget({ config, instanceId }: WidgetRenderProps) {
  const currency = useClientCurrency();
  const scope = useWidgetScope(config);
  const { clientId, dateRange } = scope;
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const compareMode = useAppStore((s) => s.compareMode);

  const metric = getMetricOption(readMetric(config));

  // The page's comparison selector picks the earlier window, derived from the
  // widget's effective range (which may be pinned). With comparison off the
  // delta keeps its original meaning: the immediately preceding period.
  const compareRange = useMemo(
    () => getCompareRange(dateRange, compareMode),
    [dateRange, compareMode]
  );
  const daysDiff = Math.round(
    (new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const previousEnd =
    compareRange?.end ?? format(subDays(new Date(dateRange.start), 1), "yyyy-MM-dd");
  const previousStart =
    compareRange?.start ?? format(subDays(new Date(dateRange.start), daysDiff + 1), "yyyy-MM-dd");

  const { data: comparison, isLoading, isError, refetch } = useComparison({
    clientId,
    currentStart: dateRange.start,
    currentEnd: dateRange.end,
    previousStart,
    previousEnd,
    platforms: scope.platforms,
    campaignIds: scope.campaignIds,
  });

  const widgetData = useMemo<WidgetData | null>(() => {
    if (!comparison) return null;
    return {
      columns: ["Metric", "Value", "Previous", "Change %", "Period", "Previous period"],
      rows: [
        [
          metric.label,
          comparison.current[metric.summaryKey],
          comparison.previous[metric.summaryKey],
          Number((comparison.deltas[metric.summaryKey]?.percentage ?? 0).toFixed(2)),
          `${dateRange.start} to ${dateRange.end}`,
          `${previousStart} to ${previousEnd}`,
        ],
      ],
    };
  }, [comparison, metric, dateRange, previousStart, previousEnd]);

  useRegisterWidgetData(instanceId, widgetData);

  if (!clientId || isLoading) {
    return (
      <div className="h-full flex flex-col justify-center gap-2 px-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
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
        setReferenceContext({ metric: metric.value, dateRange, platform: scope.platform, value: delta })
      }
      className="h-full w-full flex flex-col justify-center text-left px-1 group"
    >
      <p className="text-[12px] font-medium text-ink-muted">{metric.label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink leading-tight truncate mt-1">
        {formatMetric(value, metric.format, currency)}
      </p>
      <div className="flex items-center gap-2 mt-2">
        {!isNeutral && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded",
              isGood ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
            )}
          >
            {isPositive ? <BiTrendingUp className="w-3 h-3" /> : <BiTrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {/* Always named, including on "No comparison": the delta is still
            measured against the immediately preceding period there (see the
            fallback above), and an unlabelled delta reads the same whichever
            window produced it. Matches the custom number widget's readout. */}
        <span className="text-[11px] text-ink-muted truncate">
          vs {formatMetric(prev, metric.format, currency)}
          {` · ${COMPARE_MODE_LABELS[compareMode === "none" ? "previous_period" : compareMode].toLowerCase()}`}
        </span>
      </div>
    </button>
  );
}

export function KpiConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const metric = readMetric(config);
  return (
    <ConfigSection title="Metric">
      <Select value={metric} onValueChange={(v) => onChange({ ...config, metric: v })}>
        <SelectTrigger className="w-full">
          <SelectValue>{getMetricOption(metric).label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {METRIC_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ConfigSection>
  );
}
