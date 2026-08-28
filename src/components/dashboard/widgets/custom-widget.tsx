"use client";

import { useMemo } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  BiTrendingUp,
  BiTrendingDown,
  BiHash,
  BiLineChart,
  BiBarChartAlt2,
  BiTable,
  BiSortDown,
  BiSortUp,
} from "react-icons/bi";
import { useMetricQuery } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { useClientCurrency } from "@/hooks/use-currency-format";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  QUERY_METRICS,
  QUERY_METRIC_META,
  QUERY_GROUP_BYS,
  QUERY_TIME_BUCKETS,
  GROUP_BY_LABELS,
  TIME_BUCKET_LABELS,
  CUSTOM_VISUALIZATIONS,
  VISUALIZATION_LABELS,
  VISUALIZATION_RULES,
  normalizeCustomConfig,
  describeCustomWidget,
  toMetricQueryParams,
} from "@/lib/dashboard/custom-widget";
import type {
  CustomWidgetConfig,
  CustomVisualization,
  MetricFormat,
  MetricQueryResult,
  MetricQueryRow,
  QueryMetric,
  QueryTimeBucket,
} from "@/lib/dashboard/custom-widget";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

// --- Formatting helpers ----------------------------------------------------

const NOT_TRACKED = "Revenue not tracked";

function formatValue(metric: QueryMetric, value: number | null | undefined, currency: string): string {
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

function seriesColor(group: MetricQueryResult["groups"][number], index: number): string {
  return group.platform ? PLATFORM_COLORS[group.platform] : SERIES_PALETTE[index % SERIES_PALETTE.length];
}

const AXIS_TICK = { fontSize: 10, fill: CHART_AXIS_TEXT };
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: "1px solid #ececec" };

/** Same previous-period arithmetic as KpiWidget / useComparison callers. */
function previousPeriod(dateRange: { start: string; end: string }) {
  const daysDiff = Math.round(
    (new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const previousEnd = format(subDays(new Date(dateRange.start), 1), "yyyy-MM-dd");
  const previousStart = format(subDays(new Date(dateRange.start), daysDiff + 1), "yyyy-MM-dd");
  return { previousStart, previousEnd };
}

// --- Widget ----------------------------------------------------------------

export function CustomWidget({ config }: WidgetRenderProps) {
  const cfg = useMemo(() => normalizeCustomConfig(config), [config]);
  const scope = useWidgetScope(config);
  const currency = useClientCurrency();
  const { clientId, dateRange } = scope;
  const isNumber = cfg.visualization === "number";

  const params = toMetricQueryParams(cfg, {
    clientId: clientId ?? "",
    startDate: dateRange.start,
    endDate: dateRange.end,
    platforms: scope.platforms,
    campaignIds: scope.campaignIds,
  });
  const current = useMetricQuery({ ...params, clientId });

  const { previousStart, previousEnd } = previousPeriod(dateRange);
  const previous = useMetricQuery({
    ...params,
    clientId,
    startDate: previousStart,
    endDate: previousEnd,
    enabled: isNumber,
  });

  if (!clientId || current.isLoading || (isNumber && previous.isLoading)) {
    return <LoadingState viz={cfg.visualization} />;
  }
  if (current.isError) return <QueryError compact onRetry={() => current.refetch()} />;
  if (!current.data || current.data.rows.length === 0) {
    return (
      <div className="h-full grid place-items-center text-xs text-ink-muted">
        No data for this selection
      </div>
    );
  }

  switch (cfg.visualization) {
    case "number":
      return <NumberViz cfg={cfg} result={current.data} previous={previous.data} currency={currency} />;
    case "line":
      return <LineViz cfg={cfg} result={current.data} currency={currency} />;
    case "bar":
      return <BarViz cfg={cfg} result={current.data} currency={currency} />;
    case "table":
      return <TableViz cfg={cfg} result={current.data} currency={currency} />;
  }
}

function LoadingState({ viz }: { viz: CustomVisualization }) {
  if (viz === "number") {
    return (
      <div className="h-full flex flex-col justify-center gap-2 px-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }
  if (viz === "table") {
    return (
      <div className="h-full w-full space-y-2 px-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  return <Skeleton className="h-full w-full" />;
}

interface VizProps {
  cfg: CustomWidgetConfig;
  result: MetricQueryResult;
  currency: string;
}

// --- Number ----------------------------------------------------------------

function NumberViz({ cfg, result, previous, currency }: VizProps & { previous?: MetricQueryResult }) {
  const metric = cfg.metrics[0];
  const meta = QUERY_METRIC_META[metric];
  const value = result.rows[0]?.[metric] ?? null;
  const prev = previous?.rows[0]?.[metric] ?? null;

  const hasPrev = value != null && prev != null && prev !== 0;
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
          <span className="text-[11px] text-ink-muted truncate">
            vs {formatValue(metric, prev, currency)}
          </span>
        </div>
      )}
    </div>
  );
}

// --- Legend chips ----------------------------------------------------------

function LegendChips({ items }: { items: { key: string; label: string; color: string }[] }) {
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

interface LineSeries {
  key: string;
  label: string;
  color: string;
  metric: QueryMetric;
}

function LineViz({ cfg, result, currency }: VizProps) {
  const grouped = cfg.groupBy !== "none";

  const { data, series } = useMemo(() => {
    if (!grouped) {
      const series: LineSeries[] = cfg.metrics.map((m) => ({
        key: m,
        label: QUERY_METRIC_META[m].label,
        color: QUERY_METRIC_META[m].color,
        metric: m,
      }));
      const data = result.rows.map((r): Record<string, unknown> => ({ ...r }));
      return { data, series };
    }
    // Pivot "<group>|<date>" rows into one point per date with a column per
    // group. Columns are index keys ("s0", "s1") so campaign ids containing
    // dots never get read as nested recharts paths.
    const metric = cfg.metrics[0];
    const keyOf = new Map<string, string>();
    const series: LineSeries[] = result.groups.map((g, i) => {
      const key = `s${i}`;
      keyOf.set(g.group, key);
      return { key, label: g.label, color: seriesColor(g, i), metric };
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
  }, [grouped, cfg.metrics, result]);

  const axisFmt = sharedFormat(cfg.metrics);
  const metricByKey = new Map(series.map((s) => [s.key, s.metric]));

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips items={series} />
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
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
              formatter={(value, _name, item) => {
                const metric = metricByKey.get(String(item?.dataKey)) ?? cfg.metrics[0];
                return formatValue(metric, typeof value === "number" ? value : null, currency);
              }}
            />
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Bar -------------------------------------------------------------------

function BarViz({ cfg, result, currency }: VizProps) {
  const metrics = cfg.metrics.slice(0, 2);
  const dual = metrics.length === 2;
  const colorByPlatform = !dual && cfg.groupBy === "platform";
  const rows = result.rows;

  return (
    <div className="h-full w-full flex flex-col">
      <LegendChips
        items={
          colorByPlatform
            ? result.groups.map((g, i) => ({ key: g.group, label: g.label, color: seriesColor(g, i) }))
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
              tickFormatter={(v) => axisTick(QUERY_METRIC_META[metrics[0]].format, Number(v), currency)}
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
                const metric = (String(item?.dataKey) as QueryMetric) in QUERY_METRIC_META
                  ? (String(item?.dataKey) as QueryMetric)
                  : metrics[0];
                return formatValue(metric, typeof value === "number" ? value : null, currency);
              }}
            />
            {metrics.map((m, i) => (
              <Bar
                key={m}
                dataKey={m}
                name={QUERY_METRIC_META[m].label}
                yAxisId={i === 1 ? "right" : "left"}
                fill={QUERY_METRIC_META[m].color}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              >
                {colorByPlatform &&
                  rows.map((r) => (
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

// --- Table -----------------------------------------------------------------

function TableViz({ cfg, result, currency }: VizProps) {
  const showLabel = cfg.groupBy !== "none";
  const showDate = cfg.timeBucket !== "none";
  const headClass = "h-7 px-2 text-[11px] font-medium text-ink-muted bg-white";
  const cellClass = "py-1 px-2 text-xs";

  return (
    <div className="h-full w-full min-h-0 [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 z-10 bg-white">
          <TableRow className="hover:bg-transparent">
            {showLabel && <TableHead className={headClass}>{GROUP_BY_LABELS[cfg.groupBy]}</TableHead>}
            {showDate && <TableHead className={headClass}>{TIME_BUCKET_LABELS[cfg.timeBucket]}</TableHead>}
            {cfg.metrics.map((m) => (
              <TableHead key={m} className={cn(headClass, "text-right")}>
                {QUERY_METRIC_META[m].label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((r) => (
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
                <MetricCell key={m} row={r} metric={m} currency={currency} emphasize={i === 0} className={cellClass} />
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
}: {
  row: MetricQueryRow;
  metric: QueryMetric;
  currency: string;
  emphasize: boolean;
  className: string;
}) {
  const value = row[metric];
  const untracked = value == null && QUERY_METRIC_META[metric].requiresRevenue;
  return (
    <TableCell
      className={cn(className, "text-right tabular-nums", emphasize ? "font-medium text-ink" : "text-ink-secondary")}
      title={untracked ? NOT_TRACKED : undefined}
    >
      {formatValue(metric, value, currency)}
    </TableCell>
  );
}

// --- Config form (builder + live preview) ----------------------------------

const VIZ_ICONS: Record<CustomVisualization, React.ComponentType<{ className?: string }>> = {
  number: BiHash,
  line: BiLineChart,
  bar: BiBarChartAlt2,
  table: BiTable,
};

const LIMIT_OPTIONS = [5, 10, 20, 50];

const CHIP =
  "text-xs px-2.5 py-1 rounded-md border transition-colors inline-flex items-center gap-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 disabled:cursor-not-allowed";
const CHIP_ON = "border-primary bg-primary/8 text-primary font-medium";
const CHIP_OFF = "border-hairline text-ink-muted hover:text-ink disabled:hover:text-ink-muted";

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label className="text-xs font-medium text-ink-secondary">{children}</label>
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </div>
  );
}

export function CustomWidgetConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const cfg = useMemo(() => normalizeCustomConfig(config), [config]);
  const scope = useWidgetScope(config);
  const rule = VISUALIZATION_RULES[cfg.visualization];
  const maxMetrics = cfg.groupBy === "none" ? rule.maxMetrics : rule.maxMetricsWhenGrouped;

  // Tiny availability probe: are revenue / ROAS tracked for this client + scope?
  const availability = useMetricQuery({
    clientId: scope.clientId,
    startDate: scope.dateRange.start,
    endDate: scope.dateRange.end,
    groupBy: "none",
    timeBucket: "none",
    platforms: scope.platforms,
    campaignIds: scope.campaignIds,
  });
  const revenueTracked = availability.data ? availability.data.rows[0]?.revenue != null : true;

  /** Apply a patch, re-normalize so the preview never sees an invalid combo, keep unrelated keys (filters). */
  function update(patch: Partial<CustomWidgetConfig>) {
    const next = normalizeCustomConfig({ ...cfg, ...patch });
    const merged: Record<string, unknown> = { ...config, ...next };
    if (!next.title) delete merged.title;
    onChange(merged);
  }

  // Title bypasses normalize while typing (normalize trims, which would eat spaces).
  const rawTitle = typeof config.title === "string" ? config.title : "";
  function setTitle(value: string) {
    const merged: Record<string, unknown> = { ...config };
    if (value.length > 0) merged.title = value;
    else delete merged.title;
    onChange(merged);
  }

  function toggleMetric(m: QueryMetric) {
    const active = cfg.metrics.includes(m);
    if (active) {
      if (cfg.metrics.length === 1) return;
      const metrics = cfg.metrics.filter((x) => x !== m);
      update({ metrics, sortBy: cfg.sortBy === m ? metrics[0] : cfg.sortBy });
    } else {
      if (cfg.metrics.length >= maxMetrics) return;
      update({ metrics: [...cfg.metrics, m] });
    }
  }

  const limitOptions = LIMIT_OPTIONS.includes(cfg.limit)
    ? LIMIT_OPTIONS
    : [...LIMIT_OPTIONS, cfg.limit].sort((a, b) => a - b);
  const sortOptions: QueryMetric[] = cfg.metrics.includes(cfg.sortBy) ? cfg.metrics : [...cfg.metrics, cfg.sortBy];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(0,1.1fr)] gap-4">
      <div className="space-y-4 min-w-0">
        <div className="space-y-1.5">
          <FieldLabel>Title</FieldLabel>
          <Input
            value={rawTitle}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={describeCustomWidget(cfg)}
            aria-label="Widget title"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Visualization</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {CUSTOM_VISUALIZATIONS.map((v) => {
              const Icon = VIZ_ICONS[v];
              const active = cfg.visualization === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ visualization: v })}
                  className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {VISUALIZATION_LABELS[v]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel hint={`Up to ${maxMetrics} ${maxMetrics === 1 ? "metric" : "metrics"} for this chart`}>
            Metrics
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            {QUERY_METRICS.map((m) => {
              const meta = QUERY_METRIC_META[m];
              const active = cfg.metrics.includes(m);
              const untracked = meta.requiresRevenue && !revenueTracked;
              const atMax = !active && cfg.metrics.length >= maxMetrics;
              const last = active && cfg.metrics.length === 1;
              const disabled = (untracked && !active) || atMax || last;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  title={untracked ? "Revenue is not tracked for this client" : last ? "At least one metric is required" : undefined}
                  onClick={() => toggleMetric(m)}
                  className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Break down by</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {QUERY_GROUP_BYS.map((g) => {
              const active = cfg.groupBy === g;
              const allowed = rule.groupBy.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={active}
                  disabled={!allowed}
                  title={allowed ? undefined : `Not available for ${VISUALIZATION_LABELS[cfg.visualization].toLowerCase()}`}
                  onClick={() => update({ groupBy: g })}
                  className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
                >
                  {GROUP_BY_LABELS[g]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Over time</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {QUERY_TIME_BUCKETS.map((t) => {
              const active = cfg.timeBucket === t;
              const allowed = rule.timeBucket.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  disabled={!allowed}
                  title={allowed ? undefined : `Not available for ${VISUALIZATION_LABELS[cfg.visualization].toLowerCase()}`}
                  onClick={() => update({ timeBucket: t })}
                  className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
                >
                  {TIME_BUCKET_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        {cfg.groupBy !== "none" && (
          <div className="space-y-1.5">
            <FieldLabel>Top N &amp; sort</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(cfg.limit)} onValueChange={(v) => update({ limit: Number(v) })}>
                <SelectTrigger size="sm" className="text-xs" aria-label="Number of groups">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {limitOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Top {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-ink-muted">by</span>
              <Select value={cfg.sortBy} onValueChange={(v) => update({ sortBy: v as QueryMetric })}>
                <SelectTrigger size="sm" className="text-xs" aria-label="Sort metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {QUERY_METRIC_META[m].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => update({ sortDir: cfg.sortDir === "desc" ? "asc" : "desc" })}
                aria-label={cfg.sortDir === "desc" ? "Sorted highest first" : "Sorted lowest first"}
                className={cn(CHIP, CHIP_OFF, "h-7")}
              >
                {cfg.sortDir === "desc" ? <BiSortDown className="w-3.5 h-3.5" /> : <BiSortUp className="w-3.5 h-3.5" />}
                {cfg.sortDir === "desc" ? "Highest first" : "Lowest first"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="h-64 rounded-lg border border-hairline p-3 flex flex-col">
          <p className="text-[11px] font-medium text-ink-muted mb-2 truncate">
            Preview · {cfg.title ?? describeCustomWidget(cfg)}
          </p>
          <div className="flex-1 min-h-0">
            <CustomWidget config={config} instanceId="preview" />
          </div>
        </div>
      </div>
    </div>
  );
}
