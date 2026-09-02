"use client";

// Presentational visualizations for a MetricQueryResult: number, line, area,
// bar, combo, pie/donut, table and pivot. Pure props in, chart out — no data
// hooks, no store reads.
//
// Two callers share these: the live custom widget (CustomWidget fetches through
// useMetricQuery and hands the result down) and the read-only view-report
// renderer (which hands down the frozen result stored in the report snapshot).
// Keeping them here is what makes a report look like the dashboard it came from.

import { useCallback, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import { BiTrendingUp, BiTrendingDown, BiChevronUp, BiChevronDown } from "react-icons/bi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMetric } from "@/lib/dashboard/metrics";
import { formatCurrencyCompact, formatNumber } from "@/lib/format";
import {
  PLATFORM_COLORS,
  SERIES_PALETTE,
  CHART_GRID,
  CHART_AXIS_TEXT,
} from "@/lib/dashboard/chart-theme";
import {
  QUERY_METRIC_META,
  GROUP_BY_LABELS,
  TIME_BUCKET_LABELS,
} from "@/lib/dashboard/custom-widget";
import type {
  CustomWidgetConfig,
  MetricFormat,
  MetricQueryResult,
  MetricQueryRow,
  QueryMetric,
  QueryTimeBucket,
} from "@/lib/dashboard/custom-widget";

// --- Formatting helpers ----------------------------------------------------

export const NOT_TRACKED = "Revenue not tracked";

export function formatValue(
  metric: QueryMetric,
  value: number | null | undefined,
  currency: string
): string {
  if (value == null) return "—";
  return formatMetric(value, QUERY_METRIC_META[metric].format, currency);
}

/** Short axis tick. `format` null = mixed metrics on one axis, plain number. */
function axisTick(fmt: MetricFormat | null, v: number, currency: string): string {
  switch (fmt) {
    case "currency":
      return formatCurrencyCompact(v, currency);
    case "percent":
      return `${v.toFixed(1)}%`;
    case "ratio":
      return `${v.toFixed(1)}x`;
    default:
      return formatNumber(v);
  }
}

/** Shared format across metrics, or null when they differ. */
function sharedFormat(metrics: QueryMetric[]): MetricFormat | null {
  const fmts = new Set(metrics.map((m) => QUERY_METRIC_META[m].format));
  return fmts.size === 1 ? QUERY_METRIC_META[metrics[0]].format : null;
}

function formatBucketDate(d: string, bucket: QueryTimeBucket, long = false): string {
  const day = format(parseISO(d), long ? "MMM d, yyyy" : "MMM d");
  return bucket === "week" ? `Wk of ${day}` : day;
}

function truncate(s: string, n = 18): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Platform brand color only when the breakdown IS by platform. Any other
 * grouping (campaigns) walks the categorical palette by index — otherwise ten
 * campaigns on one platform would all draw in the same brand blue.
 */
function seriesColor(
  group: MetricQueryResult["groups"][number],
  index: number,
  groupBy: CustomWidgetConfig["groupBy"]
): string {
  return groupBy === "platform" && group.platform
    ? PLATFORM_COLORS[group.platform]
    : SERIES_PALETTE[index % SERIES_PALETTE.length];
}

const AXIS_TICK = { fontSize: 10, fill: CHART_AXIS_TEXT };
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: "1px solid #ececec" };

export interface VizProps {
  cfg: CustomWidgetConfig;
  result: MetricQueryResult;
  currency: string;
}

/** The three time-bucketed charts, which can also draw an earlier window. */
export type TimeVizProps = VizProps & { compare?: CompareSeries | null };

// --- Trend fit (line / area / combo) ---------------------------------------

const TREND_KEY = "__trend";

/**
 * Least-squares fit of `values`, evaluated at EVERY index — including the ones
 * the series itself has no point for, so the fit still reaches the end of the
 * range when the data stops short. Null when there is nothing to fit.
 */
export function fitTrend(values: (number | null | undefined)[]): number[] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      xs.push(i);
      ys.push(v);
    }
  });
  if (xs.length < 2) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    covariance += dx * (ys[i] - meanY);
    variance += dx * dx;
  }
  if (variance === 0) return null;

  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  return values.map((_, i) => slope * i + intercept);
}

/** Adds the fitted series to a copy of the chart data under TREND_KEY. */
function withTrend(
  data: Record<string, unknown>[],
  key: string
): { data: Record<string, unknown>[]; hasTrend: boolean } {
  const fit = fitTrend(data.map((d) => d[key] as number | null));
  if (!fit) return { data, hasTrend: false };
  return { data: data.map((d, i) => ({ ...d, [TREND_KEY]: fit[i] })), hasTrend: true };
}

/** The dashed fit itself. Kept out of the tooltip — it is not a measurement. */
function TrendLine({ color, yAxisId }: { color: string; yAxisId?: string }) {
  return (
    <Line
      type="linear"
      dataKey={TREND_KEY}
      name="Trend"
      {...(yAxisId ? { yAxisId } : {})}
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray="5 4"
      strokeOpacity={0.65}
      dot={false}
      isAnimationActive={false}
      tooltipType="none"
      legendType="none"
    />
  );
}

// --- Comparison series (line / area / combo) -------------------------------

const PREV_KEY = "__prev";
const PREV_DATE_KEY = "__prevDate";

/** Muted and dashed: the earlier window is background, not a peer series. */
const PREV_COLOR = "#94a3b8";

/** The earlier window a time-bucketed chart draws behind its own series. */
export interface CompareSeries {
  result: MetricQueryResult;
  /** The window `result` covers. */
  range: { start: string; end: string };
  /** The window the chart itself covers — the other half of the alignment. */
  baseRange: { start: string; end: string };
  /** What the earlier window IS, in words ("previous period"). */
  label: string;
}

/**
 * Bucket index of `date` inside a window. Two equally long windows share an
 * index for the same relative position — day 1 against day 1 — which is the
 * only alignment that means anything once the calendar dates differ. Week
 * buckets are Mondays (SQL date_trunc('week')), so the origin is truncated the
 * same way before the difference is taken.
 */
function bucketOffset(date: string, start: string, bucket: QueryTimeBucket): number {
  const origin = bucket === "week" ? startOfWeek(parseISO(start), { weekStartsOn: 1 }) : parseISO(start);
  const days = differenceInCalendarDays(parseISO(date), origin);
  return bucket === "week" ? Math.floor(days / 7) : days;
}

/**
 * Folds the earlier window into the chart data under PREV_KEY, carrying its
 * REAL date along in PREV_DATE_KEY so the tooltip can say which day it is —
 * the x axis belongs to the current period and cannot show both.
 *
 * Offsets, not row order: a bucket with no spend produces no row at all, and an
 * index-based pairing would slide every later point by one.
 */
function withCompare(
  data: Record<string, unknown>[],
  cfg: CustomWidgetConfig,
  metric: QueryMetric,
  compare: CompareSeries | null | undefined
): { data: Record<string, unknown>[]; hasCompare: boolean } {
  if (!compare || cfg.timeBucket === "none") return { data, hasCompare: false };

  const byOffset = new Map<number, MetricQueryRow>();
  for (const row of compare.result.rows) {
    if (row.date) byOffset.set(bucketOffset(row.date, compare.range.start, cfg.timeBucket), row);
  }
  if (byOffset.size === 0) return { data, hasCompare: false };

  let matched = false;
  const merged = data.map((point) => {
    const date = typeof point.date === "string" ? point.date : null;
    const prev = date
      ? byOffset.get(bucketOffset(date, compare.baseRange.start, cfg.timeBucket))
      : undefined;
    if (prev) matched = true;
    return { ...point, [PREV_KEY]: prev ? prev[metric] : null, [PREV_DATE_KEY]: prev?.date ?? null };
  });
  // Nothing lined up (an empty earlier window): draw no ghost series rather
  // than a flat line of nulls with a legend chip promising data.
  return matched ? { data: merged, hasCompare: true } : { data, hasCompare: false };
}

/** Legend chip naming the earlier window and the actual dates it covers. */
function compareLegend(
  metric: QueryMetric,
  compare: CompareSeries
): { key: string; label: string; color: string } {
  const span = `${format(parseISO(compare.range.start), "MMM d")} – ${format(parseISO(compare.range.end), "MMM d")}`;
  return {
    key: PREV_KEY,
    label: `${QUERY_METRIC_META[metric].label} · ${compare.label} (${span})`,
    color: PREV_COLOR,
  };
}

interface CompareLayer {
  data: Record<string, unknown>[];
  legend: { key: string; label: string; color: string }[];
  hasCompare: boolean;
  /** Series name the tooltip starts from; empty when there is no comparison. */
  name: string;
}

/**
 * The whole comparison layer for one chart: merged data, the extra legend chip
 * and the series name. One helper so line, area and combo cannot end up
 * aligning or naming the earlier window differently from each other.
 */
function compareLayer(
  cfg: CustomWidgetConfig,
  data: Record<string, unknown>[],
  legend: { key: string; label: string; color: string }[],
  metric: QueryMetric,
  compare: CompareSeries | null | undefined
): CompareLayer {
  const merged = withCompare(data, cfg, metric, compare);
  if (!merged.hasCompare || !compare) return { data, legend, hasCompare: false, name: "" };
  return {
    data: merged.data,
    legend: [...legend, compareLegend(metric, compare)],
    hasCompare: true,
    name: `${QUERY_METRIC_META[metric].label} · ${compare.label}`,
  };
}

function CompareLine({ name, yAxisId }: { name: string; yAxisId?: string }) {
  return (
    <Line
      type="monotone"
      dataKey={PREV_KEY}
      name={name}
      {...(yAxisId ? { yAxisId } : {})}
      stroke={PREV_COLOR}
      strokeWidth={2}
      strokeDasharray="4 3"
      dot={false}
      isAnimationActive={false}
      connectNulls
    />
  );
}

/**
 * Tooltip entry for the comparison line: its own date, not the axis label's.
 * Reading "Aug 12" twice in one tooltip is exactly the confusion this avoids.
 */
function compareTooltipName(name: unknown, payload: unknown, bucket: QueryTimeBucket): string {
  const date = (payload as Record<string, unknown> | undefined)?.[PREV_DATE_KEY];
  return typeof date === "string" ? `${String(name)} · ${formatBucketDate(date, bucket, true)}` : String(name);
}

// --- Heat cells (table / pivot) --------------------------------------------

/**
 * Cell shading for `heatCells`. Intensity runs from the column's worst value to
 * its best — `invert` flips it — so darker always means "more of what you want"
 * whichever metric the column holds. A translucent tint over the row's own
 * background keeps the text contrast the table already had.
 */
function heatStyle(
  value: number | null | undefined,
  range: { min: number; max: number } | null,
  invert: boolean
): React.CSSProperties | undefined {
  if (value == null || !range || range.max <= range.min) return undefined;
  const t = (value - range.min) / (range.max - range.min);
  const strength = invert ? 1 - t : t;
  return { backgroundColor: `rgba(0, 117, 222, ${(0.04 + strength * 0.26).toFixed(3)})` };
}

/** Min/max of the non-null values in one column. */
function heatRange(values: (number | null | undefined)[]): { min: number; max: number } | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// --- Number ----------------------------------------------------------------

export function NumberViz({
  cfg,
  result,
  previous,
  compareLabel,
  series,
  currency,
}: VizProps & {
  previous?: MetricQueryResult | null;
  /**
   * What `previous` is, in words ("previous year"). Without it the readout says
   * only "vs <value>", which reads identically whichever window it compared.
   */
  compareLabel?: string;
  /**
   * Day-bucketed pass over the SAME range and scope, for the sparkline. The
   * number's own query is one undated whole-range total, so it can never carry
   * a shape — the caller runs this second query only when `cfg.sparkline` is on.
   */
  series?: MetricQueryResult | null;
}) {
  const metric = cfg.metrics[0];
  const meta = QUERY_METRIC_META[metric];
  const value = result.rows[0]?.[metric] ?? null;
  const prev = previous?.rows[0]?.[metric] ?? null;

  // Without a series (toggle off, still loading, or a report frozen before the
  // series was captured) the sparkline stays off rather than inventing a shape.
  const spark = useMemo(() => {
    if (!cfg.sparkline || !series) return null;
    const points = series.rows
      .filter((r) => r.date != null && r[metric] != null)
      .map((r) => ({ date: r.date, value: r[metric] as number }));
    return points.length >= 2 ? points : null;
  }, [cfg.sparkline, series, metric]);

  const hasPrev = cfg.showComparison !== false && value != null && prev != null && prev !== 0;
  const delta = hasPrev ? ((value - prev) / Math.abs(prev)) * 100 : 0;
  const isNeutral = delta === 0;
  const isPositive = delta > 0;
  const isGood = isNeutral ? true : (isPositive && !meta.invert) || (!isPositive && meta.invert);

  return (
    <div className="h-full w-full flex flex-col justify-center text-left px-1">
      <p className="text-[12px] font-medium text-ink-muted">{meta.label}</p>
      <p
        className="text-2xl font-semibold tracking-tight text-ink leading-tight truncate mt-1"
        title={value == null && meta.requiresRevenue ? NOT_TRACKED : undefined}
      >
        {formatValue(metric, value, currency)}
      </p>
      {hasPrev && (
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
          {/* Truncates on a narrow tile, so the full phrase lives in `title`
              too — the same way TableViz names its compare window. */}
          <span
            className="text-[11px] text-ink-muted truncate"
            title={
              compareLabel
                ? `vs ${compareLabel}: ${formatValue(metric, prev, currency)}`
                : undefined
            }
          >
            vs {formatValue(metric, prev, currency)}
            {compareLabel ? ` · ${compareLabel}` : ""}
          </span>
        </div>
      )}
      {spark && (
        <div className="h-7 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={meta.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// --- Legend chips ----------------------------------------------------------

export function LegendChips({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3 mb-1 flex-wrap">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted min-w-0">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
          <span className="truncate max-w-[160px]" title={it.label}>
            {it.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// --- Line ------------------------------------------------------------------

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  metric: QueryMetric;
}

/**
 * Pure pivot behind the line chart. Ungrouped: rows are already one point per
 * bucket, one series per metric. Grouped: fold the "<group>|<date>" rows into
 * one point per date with a column per group. Columns are index keys ("s0",
 * "s1") so campaign ids containing dots never read as nested recharts paths.
 */
export function pivotLineData(
  cfg: CustomWidgetConfig,
  result: MetricQueryResult
): { data: Record<string, unknown>[]; series: LineSeries[] } {
  if (cfg.groupBy === "none") {
    const series: LineSeries[] = cfg.metrics.map((m) => ({
      key: m,
      label: QUERY_METRIC_META[m].label,
      color: QUERY_METRIC_META[m].color,
      metric: m,
    }));
    const data = result.rows.map((r): Record<string, unknown> => ({ ...r }));
    return { data, series };
  }

  const metric = cfg.metrics[0];
  const keyOf = new Map<string, string>();
  const series: LineSeries[] = result.groups.map((g, i) => {
    const key = `s${i}`;
    keyOf.set(g.group, key);
    return { key, label: g.label, color: seriesColor(g, i, cfg.groupBy), metric };
  });
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of result.rows) {
    if (!r.date) continue;
    const key = keyOf.get(r.group);
    if (!key) continue;
    let point = byDate.get(r.date);
    if (!point) {
      point = { date: r.date };
      byDate.set(r.date, point);
    }
    point[key] = r[metric];
  }
  const data = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  return { data, series };
}

/**
 * The trend fit tracks the FIRST series only — one dashed line stays readable
 * where four would just add noise — plus the legend chip that names it.
 */
function trendFor(
  cfg: CustomWidgetConfig,
  data: Record<string, unknown>[],
  series: LineSeries[]
): { data: Record<string, unknown>[]; hasTrend: boolean; legend: { key: string; label: string; color: string }[] } {
  const base = { data, hasTrend: false, legend: series };
  if (!cfg.trendLine || series.length === 0) return base;
  const fitted = withTrend(data, series[0].key);
  if (!fitted.hasTrend) return base;
  return {
    ...fitted,
    legend: [...series, { key: TREND_KEY, label: `Trend · ${series[0].label}`, color: series[0].color }],
  };
}

export function LineViz({ cfg, result, currency, compare }: TimeVizProps) {
  const { data, series } = useMemo(() => pivotLineData(cfg, result), [cfg, result]);
  const trend = useMemo(() => trendFor(cfg, data, series), [cfg, data, series]);
  // Like the trend fit, the comparison tracks the FIRST series only: one ghost
  // line reads, four are noise. Grouped charts never get here — the normalizer
  // drops `compareSeries` unless the chart is ungrouped.
  const prev = useMemo(
    () => compareLayer(cfg, trend.data, trend.legend, cfg.metrics[0], compare),
    [cfg, trend, compare]
  );

  const axisFmt = sharedFormat(cfg.metrics);
  const metricByKey = new Map(series.map((s) => [s.key, s.metric]));

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips items={prev.legend} />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={prev.data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket)}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS_TICK}
              width={44}
              tickFormatter={(v) => axisTick(axisFmt, Number(v), currency)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket, true)}
              formatter={(value, name, item) => {
                const key = String(item?.dataKey);
                const metric = metricByKey.get(key) ?? cfg.metrics[0];
                const text = formatValue(metric, typeof value === "number" ? value : null, currency);
                return key === PREV_KEY
                  ? [text, compareTooltipName(name, item?.payload, cfg.timeBucket)]
                  : text;
              }}
            />
            {prev.hasCompare && <CompareLine name={prev.name} />}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
            {trend.hasTrend && <TrendLine color={series[0].color} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Area ------------------------------------------------------------------

export function AreaViz({ cfg, result, currency, compare }: TimeVizProps) {
  const { data, series } = useMemo(() => pivotLineData(cfg, result), [cfg, result]);
  const trend = useMemo(() => trendFor(cfg, data, series), [cfg, data, series]);
  const prev = useMemo(
    () => compareLayer(cfg, trend.data, trend.legend, cfg.metrics[0], compare),
    [cfg, trend, compare]
  );

  const axisFmt = sharedFormat(cfg.metrics);
  const metricByKey = new Map(series.map((s) => [s.key, s.metric]));
  // Stacked areas are read as a composition, so they need solid-ish fills;
  // overlaid ones have to stay see-through to keep the lower series visible.
  const stacked = cfg.areaStacked === true;

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips items={prev.legend} />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {/* ComposedChart, not AreaChart: it is the one that draws the fit's Line next to Areas. */}
          <ComposedChart data={prev.data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket)}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS_TICK}
              width={44}
              tickFormatter={(v) => axisTick(axisFmt, Number(v), currency)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket, true)}
              formatter={(value, name, item) => {
                const key = String(item?.dataKey);
                const metric = metricByKey.get(key) ?? cfg.metrics[0];
                const text = formatValue(metric, typeof value === "number" ? value : null, currency);
                return key === PREV_KEY
                  ? [text, compareTooltipName(name, item?.payload, cfg.timeBucket)]
                  : text;
              }}
            />
            {prev.hasCompare && <CompareLine name={prev.name} />}
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                {...(stacked ? { stackId: "a" } : {})}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={stacked ? 0.65 : 0.18}
              />
            ))}
            {trend.hasTrend && <TrendLine color={series[0].color} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Combo (bars + line) ----------------------------------------------------

export function ComboViz({ cfg, result, currency, compare }: TimeVizProps) {
  const metrics = cfg.metrics.slice(0, 2);
  const dual = metrics.length === 2;
  const [barMetric, lineMetric] = metrics;

  const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));
  const trend = cfg.trendLine ? withTrend(rows, barMetric) : { data: rows, hasTrend: false };

  const legend: { key: string; label: string; color: string }[] = metrics.map((m) => ({
    key: m,
    label: QUERY_METRIC_META[m].label,
    color: QUERY_METRIC_META[m].color,
  }));
  if (trend.hasTrend) {
    legend.push({
      key: TREND_KEY,
      label: `Trend · ${QUERY_METRIC_META[barMetric].label}`,
      color: QUERY_METRIC_META[barMetric].color,
    });
  }
  // The bars' metric is the one the comparison shadows, so the ghost line
  // shares their left axis.
  const prev = compareLayer(cfg, trend.data, legend, barMetric, compare);

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips items={prev.legend} />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={prev.data} margin={{ top: 4, right: dual ? 0 : 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket)}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={AXIS_TICK}
              width={44}
              tickFormatter={(v) => axisTick(QUERY_METRIC_META[barMetric].format, Number(v), currency)}
            />
            {dual && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={AXIS_TICK}
                width={44}
                tickFormatter={(v) => axisTick(QUERY_METRIC_META[lineMetric].format, Number(v), currency)}
              />
            )}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
              labelFormatter={(d) => formatBucketDate(String(d), cfg.timeBucket, true)}
              formatter={(value, name, item) => {
                const key = String(item?.dataKey);
                const metric = (key in QUERY_METRIC_META ? key : barMetric) as QueryMetric;
                const text = formatValue(metric, typeof value === "number" ? value : null, currency);
                return key === PREV_KEY
                  ? [text, compareTooltipName(name, item?.payload, cfg.timeBucket)]
                  : text;
              }}
            />
            {prev.hasCompare && <CompareLine name={prev.name} yAxisId="left" />}
            <Bar
              yAxisId="left"
              dataKey={barMetric}
              name={QUERY_METRIC_META[barMetric].label}
              fill={QUERY_METRIC_META[barMetric].color}
              radius={[3, 3, 0, 0]}
              maxBarSize={32}
            />
            {/* One metric selected: the combo degrades to the bars alone. */}
            {dual && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={lineMetric}
                name={QUERY_METRIC_META[lineMetric].label}
                stroke={QUERY_METRIC_META[lineMetric].color}
                strokeWidth={2}
                dot={false}
              />
            )}
            {trend.hasTrend && <TrendLine color={QUERY_METRIC_META[barMetric].color} yAxisId="left" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Pie / donut ------------------------------------------------------------

/** Past this many slices the wedges get too thin to read, so the tail folds up. */
const MAX_SLICES = 6;
const OTHER_COLOR = "#94a3b8";

interface Slice {
  key: string;
  label: string;
  color: string;
  value: number;
  share: number;
}

function buildSlices(cfg: CustomWidgetConfig, result: MetricQueryResult): Slice[] {
  const metric = cfg.metrics[0];
  const byGroup = new Map(result.rows.map((r) => [r.group, r]));
  // Only positive shares make sense in a part-to-whole chart; a null (revenue
  // not tracked) or zero group is simply not part of the whole.
  const all = result.groups
    .map((g, i) => ({
      key: g.group,
      label: g.label,
      color: seriesColor(g, i, cfg.groupBy),
      value: byGroup.get(g.group)?.[metric] ?? 0,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const head =
    all.length > MAX_SLICES
      ? [
          ...all.slice(0, MAX_SLICES - 1),
          {
            key: "__other",
            label: `Other (${all.length - MAX_SLICES + 1})`,
            color: OTHER_COLOR,
            value: all.slice(MAX_SLICES - 1).reduce((sum, s) => sum + s.value, 0),
          },
        ]
      : all;

  const total = head.reduce((sum, s) => sum + s.value, 0);
  return head.map((s) => ({ ...s, share: total > 0 ? (s.value / total) * 100 : 0 }));
}

/** Percent inside the wedge, skipped where the wedge is too small to hold it. */
function sliceLabel(props: PieLabelRenderProps) {
  const { cx, cy, midAngle, innerRadius, outerRadius, index } = props;
  const slice = (props as { payload?: Slice }).payload;
  if (!slice || slice.share < 7) return null;
  const radius = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.58;
  const radians = (-Number(midAngle ?? 0) * Math.PI) / 180;
  return (
    <text
      key={index}
      x={Number(cx) + radius * Math.cos(radians)}
      y={Number(cy) + radius * Math.sin(radians)}
      fill="#ffffff"
      fontSize={11}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {slice.share.toFixed(0)}%
    </text>
  );
}

export function PieViz({ cfg, result, currency }: VizProps) {
  const metric = cfg.metrics[0];
  const slices = useMemo(() => buildSlices(cfg, result), [cfg, result]);
  const donut = cfg.visualization === "donut";

  if (slices.length === 0) {
    return <div className="h-full grid place-items-center text-xs text-ink-muted">Nothing to split</div>;
  }

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips items={slices} />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={donut ? "52%" : 0}
              outerRadius="82%"
              paddingAngle={donut ? 2 : 0}
              strokeWidth={0}
              labelLine={false}
              label={sliceLabel}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name, item) => {
                const share = (item?.payload as Slice | undefined)?.share ?? 0;
                return [
                  `${formatValue(metric, typeof value === "number" ? value : null, currency)} · ${share.toFixed(1)}%`,
                  name,
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Bar -------------------------------------------------------------------

/** Absolute value kept beside the share so a 100% stack can still name its numbers. */
const ABS_PREFIX = "__abs_";

export function BarViz({ cfg, result, currency }: VizProps) {
  const metrics = cfg.metrics.slice(0, 2);
  const mode = cfg.barMode ?? "grouped";
  // A single metric has nothing to stack against, so it always draws grouped.
  const stacked = metrics.length > 1 && mode !== "grouped";
  const normalized = metrics.length > 1 && mode === "stacked100";
  const dual = metrics.length === 2 && !stacked;
  const colorByPlatform = metrics.length === 1 && cfg.groupBy === "platform";

  const rows: Record<string, unknown>[] = normalized
    ? result.rows.map((r) => {
        const total = metrics.reduce((sum, m) => sum + (r[m] ?? 0), 0);
        const out: Record<string, unknown> = { ...r };
        for (const m of metrics) {
          out[`${ABS_PREFIX}${m}`] = r[m];
          out[m] = total > 0 ? ((r[m] ?? 0) / total) * 100 : 0;
        }
        return out;
      })
    : result.rows.map((r) => ({ ...r }));

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips
        items={
          colorByPlatform
            ? result.groups.map((g, i) => ({ key: g.group, label: g.label, color: seriesColor(g, i, cfg.groupBy) }))
            : metrics.map((m) => ({ key: m, label: QUERY_METRIC_META[m].label, color: QUERY_METRIC_META[m].color }))
        }
      />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: dual ? 0 : 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickFormatter={(v) => truncate(String(v))}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tick={AXIS_TICK}
              width={44}
              domain={normalized ? [0, 100] : undefined}
              tickFormatter={(v) =>
                normalized ? `${Number(v).toFixed(0)}%` : axisTick(QUERY_METRIC_META[metrics[0]].format, Number(v), currency)
              }
            />
            {dual && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={AXIS_TICK}
                width={44}
                tickFormatter={(v) => axisTick(QUERY_METRIC_META[metrics[1]].format, Number(v), currency)}
              />
            )}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
              formatter={(value, _name, item) => {
                const key = String(item?.dataKey);
                const metric = (key in QUERY_METRIC_META ? key : metrics[0]) as QueryMetric;
                if (!normalized) return formatValue(metric, typeof value === "number" ? value : null, currency);
                const abs = (item?.payload as Record<string, unknown> | undefined)?.[`${ABS_PREFIX}${metric}`];
                return `${formatValue(metric, typeof abs === "number" ? abs : null, currency)} · ${Number(value).toFixed(1)}%`;
              }}
            />
            {metrics.map((m, i) => (
              <Bar
                key={m}
                dataKey={m}
                name={QUERY_METRIC_META[m].label}
                yAxisId={dual && i === 1 ? "right" : "left"}
                {...(stacked ? { stackId: "a" } : {})}
                fill={QUERY_METRIC_META[m].color}
                // Only the top segment of a stack gets the rounded cap.
                radius={stacked && i < metrics.length - 1 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                maxBarSize={48}
              >
                {colorByPlatform &&
                  result.rows.map((r) => (
                    <Cell
                      key={r.key}
                      fill={r.platform ? PLATFORM_COLORS[r.platform] : QUERY_METRIC_META[m].color}
                    />
                  ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Table sorting (shared with the campaign-table widget) -----------------

export type SortDir = "asc" | "desc";

export interface TableSort {
  /** Active column key, or null while the table shows its natural order. */
  key: string | null;
  dir: SortDir;
  /** Click a header: same column flips direction, a new column starts at `firstDir`. */
  toggle: (key: string, firstDir?: SortDir) => void;
  ariaSort: (key: string) => "ascending" | "descending" | "none";
}

/**
 * View-only column sort. Purely local: nothing is persisted to the widget
 * config, and until a header is clicked the rows keep the order the query
 * returned them in (so a report snapshot renders exactly as it was built).
 */
export function useTableSort(): TableSort {
  const [state, setState] = useState<{ key: string | null; dir: SortDir }>({ key: null, dir: "desc" });

  const toggle = useCallback((key: string, firstDir: SortDir = "desc") => {
    setState((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir }));
  }, []);

  // Memoized so callers can keep it in a useMemo dependency list (sorted rows,
  // registered CSV data) without recomputing on every render.
  return useMemo<TableSort>(
    () => ({
      key: state.key,
      dir: state.dir,
      toggle,
      ariaSort: (key) => (state.key !== key ? "none" : state.dir === "asc" ? "ascending" : "descending"),
    }),
    [state, toggle]
  );
}

/** Numeric-aware sort; missing values always sink to the bottom. */
export function applySort<T>(
  rows: T[],
  sort: { key: string | null; dir: SortDir },
  getValue: (row: T, key: string) => number | string | null | undefined
): T[] {
  const key = sort.key;
  if (!key) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getValue(a, key);
    const bv = getValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

/** Header label + active-direction arrow. Wrap it in a `th` carrying aria-sort. */
export function SortButton({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 w-full min-w-0 cursor-pointer select-none rounded-sm transition-colors hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        align === "right" ? "justify-end" : "justify-start",
        active && "text-ink"
      )}
    >
      <span className="truncate">{label}</span>
      {active &&
        (dir === "asc" ? (
          <BiChevronUp className="w-3 h-3 shrink-0" aria-hidden />
        ) : (
          <BiChevronDown className="w-3 h-3 shrink-0" aria-hidden />
        ))}
    </button>
  );
}

// --- Compare captions (shared with the campaign-table widget) --------------

/**
 * The compact stacked change line Google Ads uses when a table has several
 * metric columns: the previous value and the percent change, muted, under the
 * current value. Colour follows the metric's polarity (`invert` = lower is
 * better). A group absent from the earlier window renders a plain em dash.
 */
export function ChangeCaption({
  current,
  previous,
  invert,
  format: formatFn,
  compareLabel,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  invert: boolean;
  format: (value: number) => string;
  compareLabel?: string;
}) {
  const base = "block text-[10px] leading-tight tabular-nums text-ink-faint";
  if (previous == null) return <span className={base}>—</span>;

  const pct = current != null && previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
  const good = pct == null || pct === 0 ? null : (pct > 0 && !invert) || (pct < 0 && invert);

  return (
    <span className={base} title={compareLabel ? `${compareLabel}: ${formatFn(previous)}` : undefined}>
      {formatFn(previous)}
      {pct != null && (
        <>
          {" · "}
          <span className={cn(good === null ? "text-ink-faint" : good ? "text-emerald-600" : "text-red-600")}>
            {pct > 0 ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        </>
      )}
    </span>
  );
}

// --- Table -----------------------------------------------------------------

export function TableViz({
  cfg,
  result,
  previous,
  compareLabel,
  currency,
}: VizProps & {
  /** Same query over the compare window. Ignored for time-bucketed tables. */
  previous?: MetricQueryResult | null;
  compareLabel?: string;
}) {
  const showLabel = cfg.groupBy !== "none";
  const showDate = cfg.timeBucket !== "none";
  const headClass = "h-7 px-2 text-[11px] font-medium text-ink-muted bg-white";
  const cellClass = "py-1 px-2 text-xs";

  const sort = useTableSort();
  const rows = useMemo(
    () =>
      applySort(result.rows, sort, (row, key) =>
        key === "label" ? row.label : key === "date" ? row.date : row[key as QueryMetric]
      ),
    [result.rows, sort]
  );

  const prevByGroup = useMemo(() => {
    if (!previous || cfg.timeBucket !== "none") return null;
    return new Map(previous.rows.map((r) => [r.group, r]));
  }, [previous, cfg.timeBucket]);

  // One range per metric column, over the whole result — sorting reorders the
  // rows but never changes what a column's darkest cell is.
  const heat = useMemo(() => {
    if (!cfg.heatCells) return null;
    return new Map(cfg.metrics.map((m) => [m, heatRange(result.rows.map((r) => r[m]))]));
  }, [cfg.heatCells, cfg.metrics, result.rows]);

  return (
    <div className="h-full w-full min-h-0 [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 z-10 bg-white">
          <TableRow className="hover:bg-transparent">
            {showLabel && (
              <TableHead className={headClass} aria-sort={sort.ariaSort("label")}>
                <SortButton
                  label={GROUP_BY_LABELS[cfg.groupBy]}
                  active={sort.key === "label"}
                  dir={sort.dir}
                  onClick={() => sort.toggle("label", "asc")}
                />
              </TableHead>
            )}
            {showDate && (
              <TableHead className={headClass} aria-sort={sort.ariaSort("date")}>
                <SortButton
                  label={TIME_BUCKET_LABELS[cfg.timeBucket]}
                  active={sort.key === "date"}
                  dir={sort.dir}
                  onClick={() => sort.toggle("date", "asc")}
                />
              </TableHead>
            )}
            {cfg.metrics.map((m) => (
              <TableHead key={m} className={cn(headClass, "text-right")} aria-sort={sort.ariaSort(m)}>
                <SortButton
                  label={QUERY_METRIC_META[m].label}
                  active={sort.key === m}
                  dir={sort.dir}
                  align="right"
                  onClick={() => sort.toggle(m)}
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} className="border-hairline/60 hover:bg-canvas-soft/50">
              {showLabel && (
                <TableCell className={cn(cellClass, "max-w-[180px]")}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {cfg.groupBy === "platform" && r.platform && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: PLATFORM_COLORS[r.platform] }}
                      />
                    )}
                    <span className="text-ink truncate" title={r.label}>
                      {r.label}
                    </span>
                  </div>
                </TableCell>
              )}
              {showDate && (
                <TableCell className={cn(cellClass, "text-ink-secondary")}>
                  {r.date ? formatBucketDate(r.date, cfg.timeBucket) : "—"}
                </TableCell>
              )}
              {cfg.metrics.map((m, i) => (
                <MetricCell
                  key={m}
                  row={r}
                  metric={m}
                  currency={currency}
                  emphasize={i === 0}
                  className={cellClass}
                  previousRow={prevByGroup ? (prevByGroup.get(r.group) ?? null) : undefined}
                  compareLabel={compareLabel}
                  heat={heat ? (heat.get(m) ?? null) : null}
                />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MetricCell({
  row,
  metric,
  currency,
  emphasize,
  className,
  previousRow,
  compareLabel,
  heat,
}: {
  row: MetricQueryRow;
  metric: QueryMetric;
  currency: string;
  emphasize: boolean;
  className: string;
  /** undefined = comparison off; null = this group is absent from the earlier window. */
  previousRow?: MetricQueryRow | null;
  compareLabel?: string;
  /** This column's value range when heat shading is on. */
  heat?: { min: number; max: number } | null;
}) {
  const value = row[metric];
  const untracked = value == null && QUERY_METRIC_META[metric].requiresRevenue;
  return (
    <TableCell
      className={cn(className, "text-right tabular-nums", emphasize ? "font-medium text-ink" : "text-ink-secondary")}
      style={heat ? heatStyle(value, heat, QUERY_METRIC_META[metric].invert) : undefined}
      title={untracked ? NOT_TRACKED : undefined}
    >
      {formatValue(metric, value, currency)}
      {previousRow !== undefined && (
        <ChangeCaption
          current={value}
          previous={previousRow ? previousRow[metric] : null}
          invert={QUERY_METRIC_META[metric].invert}
          format={(v) => formatValue(metric, v, currency)}
          compareLabel={compareLabel}
        />
      )}
    </TableCell>
  );
}

// --- Pivot -----------------------------------------------------------------

/** Rows = groups, columns = time buckets, one metric in the cells. */
export function PivotViz({ cfg, result, currency }: VizProps) {
  const metric = cfg.metrics[0];

  const { dates, rows } = useMemo(() => {
    const dates = Array.from(
      new Set(result.rows.map((r) => r.date).filter((d): d is string => d != null))
    ).sort();
    const byGroup = new Map<string, Map<string, number | null>>();
    for (const r of result.rows) {
      if (!r.date) continue;
      let cells = byGroup.get(r.group);
      if (!cells) {
        cells = new Map();
        byGroup.set(r.group, cells);
      }
      cells.set(r.date, r[metric]);
    }
    const rows = result.groups.map((g) => ({
      group: g.group,
      label: g.label,
      platform: g.platform,
      // A group with no row in a bucket spent nothing there — an empty cell,
      // not a zero, so the heat shading doesn't invent a low value.
      cells: dates.map((d) => byGroup.get(g.group)?.get(d) ?? null),
    }));
    return { dates, rows };
  }, [result, metric]);

  const heat = useMemo(
    () => (cfg.heatCells ? dates.map((_, i) => heatRange(rows.map((r) => r.cells[i]))) : null),
    [cfg.heatCells, dates, rows]
  );

  const headClass = "h-7 px-2 text-[11px] font-medium text-ink-muted bg-white";
  const cellClass = "py-1 px-2 text-xs";
  const invert = QUERY_METRIC_META[metric].invert;

  return (
    <div className="h-full w-full min-h-0 [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 z-20 bg-white">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(headClass, "sticky left-0 z-30 min-w-[120px]")}>
              {GROUP_BY_LABELS[cfg.groupBy]}
            </TableHead>
            {dates.map((d) => (
              <TableHead key={d} className={cn(headClass, "text-right whitespace-nowrap")}>
                {formatBucketDate(d, cfg.timeBucket)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.group} className="border-hairline/60">
              <TableCell className={cn(cellClass, "sticky left-0 z-10 bg-white max-w-[180px]")}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {cfg.groupBy === "platform" && r.platform && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: PLATFORM_COLORS[r.platform] }}
                    />
                  )}
                  <span className="text-ink truncate" title={r.label}>
                    {r.label}
                  </span>
                </div>
              </TableCell>
              {r.cells.map((value, i) => (
                <TableCell
                  key={dates[i]}
                  className={cn(cellClass, "text-right tabular-nums text-ink-secondary whitespace-nowrap")}
                  style={heat ? heatStyle(value, heat[i], invert) : undefined}
                >
                  {formatValue(metric, value, currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
