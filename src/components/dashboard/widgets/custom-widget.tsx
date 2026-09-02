"use client";

import { Fragment, useMemo, useState } from "react";
import {
  BiHash,
  BiLineChart,
  BiArea,
  BiBarChartAlt2,
  BiChart,
  BiPieChartAlt2,
  BiDoughnutChart,
  BiTable,
  BiBorderAll,
} from "react-icons/bi";
import { useMetricQuery } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { useClientCurrency } from "@/hooks/use-currency-format";
import { useAppStore } from "@/store/app-store";
import {
  COMPARE_MODE_LABELS,
  getCompareRange,
  previousPeriodRange,
} from "@/lib/dashboard/date-presets";
import { useRegisterWidgetData, type WidgetData } from "@/lib/dashboard/widget-data";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfigSection,
  ConfigField,
  ChipRow,
  ChipToggle,
} from "@/components/dashboard/config-ui";
import { cn } from "@/lib/utils";
import {
  NumberViz,
  LineViz,
  AreaViz,
  BarViz,
  ComboViz,
  PieViz,
  TableViz,
  PivotViz,
} from "@/components/dashboard/widgets/custom-viz";
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
  VISUALIZATION_FAMILIES,
  VISUALIZATION_OPTIONS,
  DISPLAY_OPTIONS,
  DISPLAY_OPTION_DEFAULTS,
  BAR_MODES,
  BAR_MODE_LABELS,
  QUERY_MAX_LIMIT,
  normalizeCustomConfig,
  describeCustomWidget,
  describeThresholdEmpty,
  toMetricQueryParams,
  QUERY_METRICS as ALL_QUERY_METRICS,
  THRESHOLD_OPS,
  THRESHOLD_OP_LABELS,
} from "@/lib/dashboard/custom-widget";
import type {
  CustomWidgetConfig,
  CustomVisualization,
  DisplayOption,
  MetricQueryResult,
  QueryMetric,
  ThresholdOp,
} from "@/lib/dashboard/custom-widget";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

// --- Widget ----------------------------------------------------------------

export function CustomWidget({ config, instanceId }: WidgetRenderProps) {
  const cfg = useMemo(() => normalizeCustomConfig(config), [config]);
  const scope = useWidgetScope(config);
  const currency = useClientCurrency();
  const compareMode = useAppStore((s) => s.compareMode);
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

  // The page's Compare selector picks the earlier window for both readers below.
  const compareRange = useMemo(() => getCompareRange(dateRange, compareMode), [dateRange, compareMode]);

  // A number's change figure is part of the number, not an opt-in: with the
  // selector on "None" it falls back to the immediately preceding period rather
  // than disappearing. Same rule as KpiWidget, so the two never disagree.
  //
  // The table below deliberately does NOT get this fallback — its change
  // COLUMNS are an explicit comparison feature and correctly vanish on "None".
  // That asymmetry is intended; it is the difference between a readout that
  // always states its change and a feature the user switched on.
  const comparisonRange = useMemo(
    () => compareRange ?? previousPeriodRange(dateRange),
    [compareRange, dateRange]
  );

  // What the delta is measured against, so a year-over-year change can't read
  // as a period-over-period one. "None" falls back to the preceding period, so
  // that is what it is named.
  const comparisonLabel =
    COMPARE_MODE_LABELS[compareMode === "none" ? "previous_period" : compareMode].toLowerCase();

  // Only a number draws the delta, and only while its own option is on —
  // independent of the selector. `!== false` rather than `=== true` because the
  // option defaults to on for configs written before it existed
  // (DISPLAY_OPTION_DEFAULTS), matching NumberViz's own guard.
  // A time chart's second series reads the SAME earlier window the number's
  // delta does, so it rides the one `previous` query instead of adding another.
  // The flag only survives normalization on an ungrouped line/area/combo.
  const compareSeriesEnabled = cfg.compareSeries === true;
  const comparisonEnabled = (isNumber && cfg.showComparison !== false) || compareSeriesEnabled;
  const previous = useMetricQuery({
    ...params,
    clientId,
    startDate: comparisonRange.start,
    endDate: comparisonRange.end,
    enabled: comparisonEnabled,
  });

  // A number's headline must stay a whole-range total, so its own query has no
  // time bucket and carries no shape. The sparkline therefore needs a second
  // pass over the same range and scope, bucketed by day — and only when the
  // toggle is on, so a plain number widget still costs exactly one query.
  const sparklineEnabled = isNumber && cfg.sparkline === true;
  const sparkline = useMetricQuery({
    ...params,
    clientId,
    timeBucket: "day",
    enabled: sparklineEnabled,
  });

  // Change columns: tables only, and only when rows are one-per-group (a
  // time-bucketed table has no single earlier row to join against). Ask for the
  // widest top-N the server allows so a group that ranked lower in the earlier
  // window still has a row to join to.
  const compareEnabled = cfg.visualization === "table" && cfg.timeBucket === "none" && !!compareRange;
  const compare = useMetricQuery({
    ...params,
    clientId,
    startDate: compareRange?.start ?? dateRange.start,
    endDate: compareRange?.end ?? dateRange.end,
    limit: cfg.groupBy === "none" ? undefined : QUERY_MAX_LIMIT,
    // No threshold here for the same reason the limit is widened: this pass
    // exists to look up the earlier value of a row the CURRENT period already
    // selected, and a group that failed the test back then still has one.
    threshold: undefined,
    enabled: compareEnabled,
  });
  const compareResult = compareEnabled ? (compare.data ?? null) : undefined;

  const compareSeries = useMemo(
    () =>
      compareSeriesEnabled && previous.data
        ? {
            result: previous.data,
            range: comparisonRange,
            baseRange: dateRange,
            label: comparisonLabel,
          }
        : null,
    [compareSeriesEnabled, previous.data, comparisonRange, dateRange, comparisonLabel]
  );

  const widgetData = useMemo<WidgetData | null>(
    () => (current.data ? toWidgetData(cfg, current.data, compareResult ?? null) : null),
    [cfg, current.data, compareResult]
  );
  useRegisterWidgetData(instanceId, widgetData);

  if (
    !clientId ||
    current.isLoading ||
    (comparisonEnabled && previous.isLoading) ||
    (sparklineEnabled && sparkline.isLoading) ||
    (compareEnabled && compare.isLoading)
  ) {
    return <LoadingState viz={cfg.visualization} />;
  }
  if (current.isError) return <QueryError compact onRetry={() => current.refetch()} />;
  if (!current.data || current.data.rows.length === 0) {
    return (
      <div className="h-full grid place-items-center px-3 text-center text-xs text-ink-muted">
        {describeThresholdEmpty(cfg) ?? "No data for this selection"}
      </div>
    );
  }

  switch (cfg.visualization) {
    case "number":
      return (
        <NumberViz
          cfg={cfg}
          result={current.data}
          previous={previous.data}
          compareLabel={comparisonLabel}
          series={sparklineEnabled ? sparkline.data : null}
          currency={currency}
        />
      );
    case "line":
      return <LineViz cfg={cfg} result={current.data} currency={currency} compare={compareSeries} />;
    case "area":
      return <AreaViz cfg={cfg} result={current.data} currency={currency} compare={compareSeries} />;
    case "bar":
      return <BarViz cfg={cfg} result={current.data} currency={currency} />;
    case "combo":
      return <ComboViz cfg={cfg} result={current.data} currency={currency} compare={compareSeries} />;
    case "pie":
    case "donut":
      return <PieViz cfg={cfg} result={current.data} currency={currency} />;
    case "pivot":
      return <PivotViz cfg={cfg} result={current.data} currency={currency} />;
    case "table":
      return (
        <TableViz
          cfg={cfg}
          result={current.data}
          previous={compareResult}
          compareLabel={compareMode === "none" ? undefined : COMPARE_MODE_LABELS[compareMode]}
          currency={currency}
        />
      );
  }
}

/** Raw number for CSV, trimmed of float noise. */
function num(value: number | null | undefined): number | null {
  return value == null ? null : Number(value.toFixed(4));
}

/**
 * The rows as displayed, for the frame's CSV download: the same columns the
 * table draws, plus previous/Δ% per metric while a comparison is on.
 */
function toWidgetData(
  cfg: CustomWidgetConfig,
  result: MetricQueryResult,
  previous: MetricQueryResult | null
): WidgetData {
  const showLabel = cfg.groupBy !== "none";
  const showDate = cfg.timeBucket !== "none";
  const prevByGroup = previous ? new Map(previous.rows.map((r) => [r.group, r])) : null;

  const columns: string[] = [];
  if (showLabel) columns.push(GROUP_BY_LABELS[cfg.groupBy]);
  if (showDate) columns.push(TIME_BUCKET_LABELS[cfg.timeBucket]);
  for (const m of cfg.metrics) {
    const label = QUERY_METRIC_META[m].label;
    columns.push(label);
    if (prevByGroup) columns.push(`${label} (prev)`, `${label} Δ%`);
  }

  const rows = result.rows.map((r) => {
    const cells: (string | number | null)[] = [];
    if (showLabel) cells.push(r.label);
    if (showDate) cells.push(r.date);
    const prev = prevByGroup?.get(r.group) ?? null;
    for (const m of cfg.metrics) {
      const value = r[m];
      cells.push(num(value));
      if (prevByGroup) {
        const prevValue = prev ? prev[m] : null;
        cells.push(num(prevValue));
        cells.push(
          value != null && prevValue != null && prevValue !== 0
            ? Number((((value - prevValue) / Math.abs(prevValue)) * 100).toFixed(2))
            : null
        );
      }
    }
    return cells;
  });

  return { columns, rows };
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
  if (viz === "table" || viz === "pivot") {
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

// --- Config form (builder) -------------------------------------------------

const VIZ_ICONS: Record<CustomVisualization, React.ComponentType<{ className?: string }>> = {
  number: BiHash,
  line: BiLineChart,
  area: BiArea,
  bar: BiBarChartAlt2,
  combo: BiChart,
  pie: BiPieChartAlt2,
  donut: BiDoughnutChart,
  table: BiTable,
  // A grid of bordered cells, which is what a pivot actually is.
  pivot: BiBorderAll,
};

/** One line under each tile: what question the chart type answers. */
const VIZ_BLURBS: Record<CustomVisualization, string> = {
  number: "One figure for the range",
  line: "Trend, point by point",
  area: "Trend, with the volume filled",
  bar: "Groups side by side",
  combo: "Bars and a line together",
  pie: "Share of the total",
  donut: "Share, with the total in the middle",
  table: "Every figure, in rows",
  pivot: "Groups down, time across",
};

/** Article-led name for the warning prose, without the labels' parentheticals. */
const VIZ_PROSE: Record<CustomVisualization, string> = {
  number: "A number",
  line: "A line chart",
  area: "An area chart",
  bar: "A bar chart",
  combo: "A combo chart",
  pie: "A pie chart",
  donut: "A donut chart",
  table: "A table",
  pivot: "A pivot table",
};

/** Plain-English reason a chart type restricts the breakdown / time options. */
const GROUP_BY_NOTE: Record<CustomVisualization, string | undefined> = {
  number: "A number is always one total",
  line: undefined,
  area: undefined,
  bar: "Bars need groups to compare",
  combo: "A combo chart plots one total over time",
  pie: "A share chart needs something to split",
  donut: "A share chart needs something to split",
  table: undefined,
  pivot: "Pivot rows are the breakdown",
};

const TIME_BUCKET_NOTE: Record<CustomVisualization, string | undefined> = {
  number: "A number is always one total",
  line: "A line always runs over time",
  area: "An area always runs over time",
  bar: "Bars compare groups, not days",
  combo: "A combo chart always runs over time",
  pie: "A share chart is one point in time",
  donut: "A share chart is one point in time",
  table: undefined,
  pivot: "Pivot columns are the time buckets",
};

/** Label + one-line explanation for each display toggle. */
const DISPLAY_OPTION_META: Record<DisplayOption, { label: string; hint: string }> = {
  sparkline: { label: "Sparkline", hint: "Day-by-day shape under the figure" },
  showComparison: { label: "Comparison", hint: "Previous period and change" },
  barMode: { label: "Bars", hint: "How two metrics share a category" },
  areaStacked: { label: "Stack areas", hint: "Read as a composition" },
  trendLine: { label: "Trend line", hint: "Straight-line fit over the first series" },
  heatCells: { label: "Heat cells", hint: "Shade each number within its column" },
  compareSeries: { label: "Compare period", hint: "Draw the earlier window behind this one" },
};

/** "Clicks, CTR and CPA" — an Oxford-comma-free list for the warning prose. */
function listAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What switching chart type costs, in plain sentences. Two kinds of loss:
 * the ARITHMETIC changing meaning (whether the range is split into buckets,
 * whether the rows are combined or broken down) and metrics the new type has no
 * room for — which are simply gone, and do not come back by switching away
 * again. Present tense describing the target, so the same string serves as a
 * tile tooltip before the click and as the inline note after it. Null when
 * nothing was snapped.
 */
function describeSnap(from: CustomWidgetConfig, to: CustomWidgetConfig): string | null {
  const name = VIZ_PROSE[to.visualization];
  const parts: string[] = [];

  if (from.timeBucket !== to.timeBucket) {
    const was = TIME_BUCKET_LABELS[from.timeBucket].toLowerCase();
    parts.push(
      to.timeBucket === "none"
        ? `${name} isn't split over time, so each figure is one total for the whole range, not one per ${was}.`
        : `${name} always runs over time, so each figure is one per ${TIME_BUCKET_LABELS[
            to.timeBucket
          ].toLowerCase()}, not one total for the whole range.`
    );
  }

  if (from.groupBy !== to.groupBy) {
    parts.push(
      to.groupBy === "none"
        ? `The ${GROUP_BY_LABELS[from.groupBy].toLowerCase()} breakdown is gone, so everything is combined into one row.`
        : `The breakdown is by ${GROUP_BY_LABELS[to.groupBy].toLowerCase()}, which ${name.toLowerCase()} needs.`
    );
  }

  const dropped = from.metrics.filter((m) => !to.metrics.includes(m));
  if (dropped.length > 0) {
    const kept = to.metrics.length === 1 ? "one metric" : `${to.metrics.length} metrics`;
    parts.push(
      `${name} takes ${kept}, so ${listAnd(dropped.map((m) => QUERY_METRIC_META[m].label))} ${
        dropped.length === 1 ? "is" : "are"
      } dropped.`
    );
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Every key `normalizeCustomConfig` can leave OUT of its result: the title, the
 * six per-type display options, and filters that normalize to nothing. Those
 * are exactly the conditional spreads in its return — the other eight keys are
 * always present. A merge that starts from the previous config has to clear
 * these explicitly; see `update`.
 */
const OMITTABLE_CONFIG_KEYS: readonly string[] = ["title", "filters", "threshold", ...DISPLAY_OPTIONS];

const LIMIT_OPTIONS = [5, 10, 20, 50];

/**
 * "Only groups where CPA is over 50". Shown for a grouped chart only, because
 * an ungrouped one has a single row and nothing to select between — the
 * normalizer drops the key there.
 */
function ThresholdField({
  cfg,
  update,
}: {
  cfg: CustomWidgetConfig;
  update: (patch: Partial<CustomWidgetConfig>) => void;
}) {
  const threshold = cfg.threshold;
  return (
    <ConfigField
      label="Only groups where"
      hint="Applied before the top-N cut"
      className="pt-3 border-t border-hairline/60"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Switch
          checked={!!threshold}
          onCheckedChange={(checked) =>
            update({
              // Seeded from the ranking metric: "top 10 campaigns by CPA" is
              // almost always followed by a threshold on that same metric.
              threshold: checked ? { metric: cfg.sortBy, op: "gt", value: 0 } : undefined,
            })
          }
          aria-label="Filter groups by a metric threshold"
        />
        {threshold && (
          <>
            <Select
              value={threshold.metric}
              onValueChange={(v) => update({ threshold: { ...threshold, metric: v as QueryMetric } })}
            >
              <SelectTrigger size="sm" className="w-28 text-xs" aria-label="Threshold metric">
                <SelectValue>{QUERY_METRIC_META[threshold.metric].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ALL_QUERY_METRICS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {QUERY_METRIC_META[m].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={threshold.op}
              onValueChange={(v) => update({ threshold: { ...threshold, op: v as ThresholdOp } })}
            >
              <SelectTrigger size="sm" className="w-24 text-xs" aria-label="Threshold comparison">
                <SelectValue>{THRESHOLD_OP_LABELS[threshold.op]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {THRESHOLD_OP_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              value={String(threshold.value)}
              onChange={(e) => {
                const next = Number(e.target.value);
                update({
                  threshold: { ...threshold, value: Number.isFinite(next) ? next : 0 },
                });
              }}
              aria-label="Threshold value"
              className="h-8 w-24 text-xs bg-white"
            />
          </>
        )}
      </div>
    </ConfigField>
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

  // What each chart type would do to the arithmetic, precomputed so a tile can
  // warn on hover and reuse the same sentence once it is clicked.
  const snapPreview = useMemo(() => {
    const out = {} as Record<CustomVisualization, string | null>;
    for (const v of CUSTOM_VISUALIZATIONS) {
      out[v] =
        v === cfg.visualization
          ? null
          : describeSnap(cfg, normalizeCustomConfig({ ...cfg, visualization: v }));
    }
    return out;
  }, [cfg]);

  // Set only by the interaction that actually caused a snap, and cleared by the
  // next change of any kind — it explains one click, it is not a standing badge.
  const [snapNote, setSnapNote] = useState<string | null>(null);

  /** Apply a patch, re-normalize so the preview never sees an invalid combo, keep unrelated keys. */
  function update(patch: Partial<CustomWidgetConfig>, note: string | null = null) {
    const next = normalizeCustomConfig({ ...cfg, ...patch });
    const merged: Record<string, unknown> = { ...config, ...next };
    // normalizeCustomConfig OMITS a key that doesn't apply rather than setting
    // it to undefined, so the spread above would resurrect the outgoing chart
    // type's value from `config` — and customWidgetConfigSchema is strict about
    // an option its type can't use, which 400s the whole dashboard PUT rather
    // than just this widget. Deleting them is what keeps the view saveable.
    for (const key of OMITTABLE_CONFIG_KEYS) if (!(key in next)) delete merged[key];
    setSnapNote(note);
    onChange(merged);
  }

  /** Every type is always clickable; the normalizer snaps whatever won't fit. */
  function chooseVisualization(v: CustomVisualization) {
    update({ visualization: v }, snapPreview[v]);
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
  const grouped = cfg.groupBy !== "none";
  const displayOptions = VISUALIZATION_OPTIONS[cfg.visualization];

  return (
    <>
      <ConfigSection title="Chart type">
        {/* All nine types, always, in the same order — a widget's chart type is
            never hidden behind an overflow or filtered by how it was created.
            One grid rather than a grid per family so every tile is the same
            width; the family label is a full-width row inside it.
            `@[…]` variants size against the dialog's settings rail (its
            `@container`), not the viewport: the rail runs 19.5–31.5rem wide, so
            three tiles per row is the most that still fits a readable label. */}
        <div className="grid grid-cols-2 @[19rem]:grid-cols-3 gap-2">
          {VISUALIZATION_FAMILIES.map((family) => (
            <Fragment key={family.label}>
              <p className="col-span-full mt-1 first:mt-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                {family.label}
              </p>
              {family.types.map((v) => {
                const Icon = VIZ_ICONS[v];
                const active = cfg.visualization === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={active}
                    // Never disabled: the normalizer snaps whatever the type
                    // can't take, and the tooltip says what that costs.
                    title={snapPreview[v] ?? undefined}
                    onClick={() => chooseVisualization(v)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active ? "border-primary bg-primary/8" : "border-hairline bg-white hover:border-ink-faint"
                    )}
                  >
                    <span
                      className={cn(
                        "w-7 h-7 rounded-md grid place-items-center",
                        active ? "bg-primary text-white" : "bg-canvas-soft text-ink-muted"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className={cn("text-xs font-medium", active ? "text-primary" : "text-ink")}>
                      {VISUALIZATION_LABELS[v]}
                    </span>
                    <span className="text-[11px] text-ink-muted leading-tight">{VIZ_BLURBS[v]}</span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>

        {/* The trap this warns about: line/area/combo/pivot force a time bucket
            and number/bar/pie/donut force it off, so switching between those
            groups silently turns per-day figures into one whole-range total (or
            back), and the same widget answers a different question. */}
        {snapNote && (
          <p
            role="status"
            className="text-[11px] leading-snug text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2"
          >
            {snapNote}
          </p>
        )}
      </ConfigSection>

      <ConfigSection title="Data">
        <ConfigField label="Metrics" hint={`${cfg.metrics.length} of ${maxMetrics} selected`}>
          <div className="grid grid-cols-2 @[19rem]:grid-cols-3 @[24rem]:grid-cols-4 @[30rem]:grid-cols-5 gap-1.5">
            {QUERY_METRICS.map((m) => {
              const meta = QUERY_METRIC_META[m];
              const active = cfg.metrics.includes(m);
              const untracked = meta.requiresRevenue && !revenueTracked;
              const atMax = !active && cfg.metrics.length >= maxMetrics;
              const last = active && cfg.metrics.length === 1;
              const disabled = (untracked && !active) || atMax || last;
              return (
                <ChipToggle
                  key={m}
                  active={active}
                  disabled={disabled}
                  title={
                    untracked
                      ? "Revenue is not tracked for this client"
                      : last
                        ? "Keep at least one metric"
                        : atMax
                          ? `This chart type takes at most ${maxMetrics}`
                          : undefined
                  }
                  onClick={() => toggleMetric(m)}
                  className="justify-center px-1"
                >
                  {meta.label}
                </ChipToggle>
              );
            })}
          </div>
          {!revenueTracked && (
            <p className="text-[11px] text-ink-faint">
              Revenue and ROAS need value tracking, which this client doesn&apos;t have.
            </p>
          )}
        </ConfigField>

        <div className="grid grid-cols-1 @[26rem]:grid-cols-2 gap-x-4 gap-y-4">
          <ConfigField label="Break down by">
            <ChipRow>
              {QUERY_GROUP_BYS.map((g) => {
                const allowed = rule.groupBy.includes(g);
                return (
                  <ChipToggle
                    key={g}
                    active={cfg.groupBy === g}
                    disabled={!allowed}
                    title={allowed ? undefined : GROUP_BY_NOTE[cfg.visualization]}
                    onClick={() => update({ groupBy: g })}
                  >
                    {GROUP_BY_LABELS[g]}
                  </ChipToggle>
                );
              })}
            </ChipRow>
            {GROUP_BY_NOTE[cfg.visualization] && (
              <p className="text-[11px] text-ink-faint">{GROUP_BY_NOTE[cfg.visualization]}</p>
            )}
          </ConfigField>

          <ConfigField label="Over time">
            <ChipRow>
              {QUERY_TIME_BUCKETS.map((t) => {
                const allowed = rule.timeBucket.includes(t);
                return (
                  <ChipToggle
                    key={t}
                    active={cfg.timeBucket === t}
                    disabled={!allowed}
                    title={allowed ? undefined : TIME_BUCKET_NOTE[cfg.visualization]}
                    onClick={() => update({ timeBucket: t })}
                  >
                    {TIME_BUCKET_LABELS[t]}
                  </ChipToggle>
                );
              })}
            </ChipRow>
            {TIME_BUCKET_NOTE[cfg.visualization] && (
              <p className="text-[11px] text-ink-faint">{TIME_BUCKET_NOTE[cfg.visualization]}</p>
            )}
          </ConfigField>
        </div>

        {grouped && (
          <div className="grid grid-cols-3 gap-3 pt-1 border-t border-hairline/60 [&>*]:pt-3">
            <ConfigField label="Show">
              <Select value={String(cfg.limit)} onValueChange={(v) => update({ limit: Number(v) })}>
                <SelectTrigger size="sm" className="w-full text-xs" aria-label="Number of groups">
                  <SelectValue>{`Top ${cfg.limit}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {limitOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Top {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigField>
            <ConfigField label="Ranked by">
              <Select value={cfg.sortBy} onValueChange={(v) => update({ sortBy: v as QueryMetric })}>
                <SelectTrigger size="sm" className="w-full text-xs" aria-label="Sort metric">
                  <SelectValue>{QUERY_METRIC_META[cfg.sortBy].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {QUERY_METRIC_META[m].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigField>
            <ConfigField label="Order">
              <Select
                value={cfg.sortDir}
                onValueChange={(v) => update({ sortDir: v as CustomWidgetConfig["sortDir"] })}
              >
                <SelectTrigger size="sm" className="w-full text-xs" aria-label="Sort order">
                  <SelectValue>{cfg.sortDir === "desc" ? "Highest first" : "Lowest first"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Highest first</SelectItem>
                  <SelectItem value="asc">Lowest first</SelectItem>
                </SelectContent>
              </Select>
            </ConfigField>
          </div>
        )}

        {grouped && <ThresholdField cfg={cfg} update={update} />}
      </ConfigSection>

      {/* Driven entirely by VISUALIZATION_OPTIONS, so a type that gains or loses
          an option needs no change here — and one with none shows no card. */}
      {displayOptions.length > 0 && (
        <ConfigSection title="Display">
          {displayOptions.map((opt) => {
            const meta = DISPLAY_OPTION_META[opt];

            if (opt === "barMode") {
              // BarViz draws a single metric grouped whatever the mode says:
              // there is nothing to stack it against.
              const stackable = cfg.metrics.length > 1;
              const mode = cfg.barMode ?? DISPLAY_OPTION_DEFAULTS.barMode;
              return (
                <ConfigField key={opt} label={meta.label} hint={meta.hint}>
                  <ChipRow>
                    {BAR_MODES.map((m) => (
                      <ChipToggle
                        key={m}
                        active={mode === m}
                        disabled={!stackable && m !== "grouped"}
                        title={stackable ? undefined : "Stacking needs a second metric"}
                        onClick={() => update({ barMode: m })}
                      >
                        {BAR_MODE_LABELS[m]}
                      </ChipToggle>
                    ))}
                  </ChipRow>
                </ConfigField>
              );
            }

            // The normalizer drops compareSeries on a grouped chart, so the
            // toggle has to say why rather than silently refuse to stay on.
            const blocked =
              opt === "compareSeries" && grouped ? "Needs a chart with no breakdown" : null;

            return (
              <ConfigField key={opt} label={meta.label} hint={blocked ?? meta.hint}>
                <Switch
                  checked={cfg[opt] === true}
                  disabled={!!blocked}
                  onCheckedChange={(checked) => {
                    // Written through a typed patch rather than a computed
                    // literal so the key stays checked against the config type.
                    const patch: Partial<CustomWidgetConfig> = {};
                    patch[opt] = checked;
                    update(patch);
                  }}
                  aria-label={meta.label}
                />
              </ConfigField>
            );
          })}
        </ConfigSection>
      )}
    </>
  );
}

/** "Title" card, placed by the dialog in the right column next to Size/Preview. */
export function CustomWidgetTitleForm({ config, onChange }: WidgetConfigFormProps) {
  const cfg = useMemo(() => normalizeCustomConfig(config), [config]);
  // Raw value bypasses normalize while typing (normalize trims, which would eat spaces).
  const rawTitle = typeof config.title === "string" ? config.title : "";
  function setTitle(value: string) {
    const merged: Record<string, unknown> = { ...config };
    if (value.length > 0) merged.title = value;
    else delete merged.title;
    onChange(merged);
  }
  return (
    <ConfigSection title="Title" hint="Auto-named if left empty">
      <Input
        value={rawTitle}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={describeCustomWidget(cfg)}
        aria-label="Widget title"
        className="h-8 text-xs bg-white"
      />
    </ConfigSection>
  );
}
