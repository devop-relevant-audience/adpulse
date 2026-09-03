"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format, parseISO, startOfISOWeek, startOfMonth } from "date-fns";
import { useDailyTrend, type TrendRow } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { useClientCurrency } from "@/hooks/use-currency-format";
import { useAppStore } from "@/store/app-store";
import { getCompareRange, COMPARE_MODE_LABELS } from "@/lib/dashboard/date-presets";
import { useRegisterWidgetData, type WidgetData } from "@/lib/dashboard/widget-data";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { METRIC_OPTIONS, getMetricOption, formatMetric, type MetricOption } from "@/lib/dashboard/metrics";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfigSection, ConfigField, ChipRow, ChipToggle } from "@/components/dashboard/config-ui";
import { Switch } from "@/components/ui/switch";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

// Trend uses the daily-trend row keys, so only metrics with a real per-day
// series are offered (excludes CPM/revenue/ROAS, which the trend endpoint doesn't return).
const TREND_METRICS = METRIC_OPTIONS.filter((m) => m.trendKey);

/** X-axis bucket. The endpoint always returns days; week/month roll up client-side. */
type Granularity = "day" | "week" | "month";

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** Prefix for the compare-period copy of a metric's series in the chart rows. */
const CMP = "cmp_";

function readMetrics(config: Record<string, unknown>): string[] {
  const raw = config.metrics;
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  const valid = list.filter((v) => TREND_METRICS.some((m) => m.value === v));
  return valid.length > 0 ? valid : ["spend"];
}

function readGranularity(config: Record<string, unknown>): Granularity {
  const g = config.granularity;
  return GRANULARITIES.some((o) => o.value === g) ? (g as Granularity) : "day";
}

/**
 * Second axis: metrics after the first are plotted against a right-hand scale,
 * so conversions stay readable next to spend instead of flattening into the
 * baseline. Off by default — configs saved before the option existed keep
 * drawing on one scale.
 */
function readSecondaryAxis(config: Record<string, unknown>): boolean {
  return config.secondaryAxis === true;
}

/** ISO week (Monday) / calendar month start, as the bucket's `yyyy-MM-dd` key. */
function bucketStart(date: string, granularity: Granularity): string {
  if (granularity === "day") return date;
  const d = parseISO(date);
  return format(granularity === "week" ? startOfISOWeek(d) : startOfMonth(d), "yyyy-MM-dd");
}

function formatBucket(date: string, granularity: Granularity, long = false): string {
  const d = parseISO(date);
  if (granularity === "month") return format(d, long ? "MMMM yyyy" : "MMM yyyy");
  if (granularity === "week") {
    return long ? `Week of ${format(d, "MMM d, yyyy")}` : format(d, "MMM d");
  }
  return format(d, long ? "MMM d, yyyy" : "MMM d");
}

/**
 * Rolls daily rows up to the chosen bucket. Additive metrics are summed; the
 * ratios are recomputed from the summed parts (averaging daily CTR/CPC/CPA
 * would weight a 10-impression day the same as a 10,000-impression one).
 */
function rollup(rows: TrendRow[], granularity: Granularity): TrendRow[] {
  if (granularity === "day") return rows;

  const buckets = new Map<string, TrendRow>();
  for (const row of rows) {
    const key = bucketStart(row.date, granularity);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.impressions += row.impressions;
      bucket.clicks += row.clicks;
      bucket.spend += row.spend;
      bucket.conversions += row.conversions;
    } else {
      buckets.set(key, {
        date: key,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        conversions: row.conversions,
        ctr: 0,
        cpc: 0,
        cpa: 0,
      });
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({
      ...b,
      // CTR is a percentage (0-100), matching getDailyTrend.
      ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
      cpc: b.clicks > 0 ? b.spend / b.clicks : 0,
      cpa: b.conversions > 0 ? b.spend / b.conversions : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

type ChartRow = {
  date: string;
  /** Bucket of the compare period drawn at this x position, or null. */
  compareDate: string | null;
} & Record<string, string | number | null>;

export function TrendWidget({ config, instanceId }: WidgetRenderProps) {
  const { clientId, dateRange, platforms, campaignIds } = useWidgetScope(config);
  const currency = useClientCurrency();
  const compareMode = useAppStore((s) => s.compareMode);

  // The pills are a local override of the saved default, so switching bucket in
  // view mode never dirties the dashboard; the config form owns what persists.
  const [override, setOverride] = useState<Granularity | null>(null);
  const granularity = override ?? readGranularity(config);

  const metrics = useMemo(
    () => readMetrics(config).map(getMetricOption).filter((m) => m.trendKey),
    [config]
  );
  // One metric has nothing to split against, so the right axis only appears
  // once there is a second series to put on it.
  const dual = readSecondaryAxis(config) && metrics.length >= 2;
  const axisOf = (index: number) => (dual ? (index === 0 ? "left" : "right") : undefined);

  // Compare always follows the widget's effective range, which may be pinned.
  const compareRange = useMemo(
    () => getCompareRange(dateRange, compareMode),
    [dateRange, compareMode]
  );

  const { data, isLoading, isError, refetch } = useDailyTrend({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platforms,
    campaignIds,
  });

  const { data: compareData } = useDailyTrend({
    clientId,
    startDate: compareRange?.start ?? dateRange.start,
    endDate: compareRange?.end ?? dateRange.end,
    platforms,
    campaignIds,
    enabled: !!compareRange,
  });

  const compareLabel = compareRange ? COMPARE_MODE_LABELS[compareMode] : null;
  const compareSeries = compareRange ? compareData ?? null : null;

  // Periods are overlaid by bucket index (not by date), so the two windows line
  // up horizontally even when they are a year apart.
  const chartData = useMemo<ChartRow[]>(() => {
    const current = rollup(data ?? [], granularity);
    const previous = compareSeries ? rollup(compareSeries, granularity) : null;

    return current.map((row, i) => {
      const point: ChartRow = { date: row.date, compareDate: previous?.[i]?.date ?? null };
      for (const m of metrics) {
        const key = m.trendKey!;
        point[key] = row[key];
        if (previous) point[`${CMP}${key}`] = previous[i]?.[key] ?? null;
      }
      return point;
    });
  }, [data, compareSeries, granularity, metrics]);

  /** Series name → metric, so the tooltip formats the compare lines too. */
  const seriesMeta = useMemo(() => {
    const map = new Map<string, MetricOption>();
    for (const m of metrics) {
      map.set(m.label, m);
      if (compareLabel) map.set(`${m.label} · ${compareLabel}`, m);
    }
    return map;
  }, [metrics, compareLabel]);

  const widgetData = useMemo<WidgetData | null>(() => {
    if (chartData.length === 0) return null;
    const columns = ["Date", ...metrics.map((m) => m.label)];
    if (compareLabel) {
      columns.push(`Date (${compareLabel})`, ...metrics.map((m) => `${m.label} (${compareLabel})`));
    }
    const rows = chartData.map((point) => {
      const row: (string | number | null)[] = [point.date];
      for (const m of metrics) row.push(point[m.trendKey!] as number);
      if (compareLabel) {
        row.push(point.compareDate);
        for (const m of metrics) row.push(point[`${CMP}${m.trendKey!}`] as number | null);
      }
      return row;
    });
    return { columns, rows };
  }, [chartData, metrics, compareLabel]);

  useRegisterWidgetData(instanceId, widgetData);

  if (!clientId || isLoading) return <Skeleton className="h-full w-full" />;
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (chartData.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No trend data</div>;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        {metrics.map((m, i) => (
          <span key={m.value} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color }} />
            {axisOf(i) === "right" ? `${m.label} (right)` : m.label}
          </span>
        ))}
        {compareLabel && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="w-2.5 border-t-2 border-dashed border-ink-faint" aria-hidden />
            vs {compareLabel.toLowerCase()}
          </span>
        )}
        <div
          role="group"
          aria-label="Chart granularity"
          className="ml-auto flex items-center gap-px rounded-md border border-hairline p-px"
        >
          {GRANULARITIES.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={granularity === g.value}
              onClick={() => setOverride(g.value)}
              className={cn(
                "px-1.5 py-0.5 rounded-[5px] text-[10px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                granularity === g.value
                  ? "bg-canvas-soft text-ink"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: dual ? 0 : 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a39e98" }}
              tickFormatter={(d) => formatBucket(String(d), granularity)}
              minTickGap={24}
            />
            {/* Recharts resolves a series' `yAxisId` against a declared axis, so
                the ids only exist when the chart is actually split. */}
            {!dual && (
              <YAxis
                tick={{ fontSize: 10, fill: "#a39e98" }}
                width={40}
                tickFormatter={(v) => formatNumber(Number(v))}
              />
            )}
            {dual && (
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: "#a39e98" }}
                width={40}
                tickFormatter={(v) => formatNumber(Number(v))}
              />
            )}
            {dual && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: "#a39e98" }}
                width={40}
                tickFormatter={(v) => formatNumber(Number(v))}
              />
            )}
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #ececec" }}
              labelFormatter={(d, payload) => {
                const current = formatBucket(String(d), granularity, true);
                const compare = (payload?.[0]?.payload as ChartRow | undefined)?.compareDate;
                return compare
                  ? `${current} vs ${formatBucket(compare, granularity, true)}`
                  : current;
              }}
              formatter={(value, name) => {
                const meta = seriesMeta.get(String(name));
                // A compare bucket with no counterpart comes through as null.
                if ((value as unknown) == null) return ["—", String(name)];
                return [
                  meta
                    ? formatMetric(Number(value), meta.format, currency)
                    : formatNumber(Number(value)),
                  String(name),
                ];
              }}
            />
            {metrics.map((m, i) => (
              <Line
                key={m.value}
                type="monotone"
                dataKey={m.trendKey ?? m.value}
                name={m.label}
                {...(dual ? { yAxisId: axisOf(i) } : {})}
                stroke={m.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
            {compareLabel &&
              metrics.map((m, i) => (
                <Line
                  key={`${CMP}${m.value}`}
                  type="monotone"
                  dataKey={`${CMP}${m.trendKey ?? m.value}`}
                  name={`${m.label} · ${compareLabel}`}
                  {...(dual ? { yAxisId: axisOf(i) } : {})}
                  stroke={m.color}
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls={false}
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
  const granularity = readGranularity(config);
  const secondaryAxis = readSecondaryAxis(config);
  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange({ ...config, metrics: next.length > 0 ? next : ["spend"] });
  }
  return (
    <>
      <ConfigSection title="Metrics" hint={`${selected.length} plotted`}>
        <ChipRow>
          {TREND_METRICS.map((m) => {
            const active = selected.includes(m.value);
            return (
              <ChipToggle key={m.value} active={active} onClick={() => toggle(m.value)}>
                {m.label}
              </ChipToggle>
            );
          })}
        </ChipRow>
      </ConfigSection>
      <ConfigSection title="Granularity" hint="Default bucket">
        <ChipRow>
          {GRANULARITIES.map((g) => (
            <ChipToggle
              key={g.value}
              active={granularity === g.value}
              onClick={() => onChange({ ...config, granularity: g.value })}
            >
              {g.label}
            </ChipToggle>
          ))}
        </ChipRow>
      </ConfigSection>
      <ConfigSection title="Display">
        <ConfigField
          label="Second axis"
          hint={selected.length < 2 ? "Needs a second metric" : "Metrics after the first get a right-hand scale"}
        >
          <Switch
            checked={secondaryAxis}
            disabled={selected.length < 2}
            onCheckedChange={(checked) => onChange({ ...config, secondaryAxis: checked })}
            aria-label="Second axis"
          />
        </ConfigField>
      </ConfigSection>
    </>
  );
}
