"use client";

import { useMemo } from "react";
import { BiTrendingUp, BiTrendingDown } from "react-icons/bi";
import { useMetricQuery } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { useClientCurrency } from "@/hooks/use-currency-format";
import { useRegisterWidgetData, type WidgetData } from "@/lib/dashboard/widget-data";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
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
import { formatValue } from "@/components/dashboard/widgets/custom-viz";
import { cn } from "@/lib/utils";
import { QUERY_METRICS, QUERY_METRIC_META } from "@/lib/dashboard/custom-widget";
import type { QueryMetric } from "@/lib/dashboard/custom-widget";
import {
  TOP_MOVERS_DIRECTIONS,
  TOP_MOVERS_DIRECTION_LABELS,
  TOP_MOVERS_GROUP_BYS,
  TOP_MOVERS_GROUP_BY_LABELS,
  TOP_MOVERS_LIMITS,
  TOP_MOVERS_QUERY_LIMIT,
  TOP_MOVERS_QUERY_SORT_BY,
  computeMovers,
  normalizeTopMoversConfig,
} from "@/lib/dashboard/top-movers";
import type { Mover, TopMoversConfig } from "@/lib/dashboard/top-movers";
import { getCompareRange, previousPeriodRange } from "@/lib/dashboard/date-presets";
import { useAppStore } from "@/store/app-store";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

/** What the secondary line says when there is no percentage to state. */
function secondaryLabel(mover: Mover): string {
  if (mover.status === "new") return "new";
  if (mover.status === "stopped") return "stopped";
  if (mover.changePct == null) return "from zero";
  return `${mover.changePct > 0 ? "+" : ""}${mover.changePct.toFixed(1)}%`;
}

/** Sign lives outside the formatter — `formatCurrency(-12)` reads "฿-12.00". */
function signedChange(mover: Mover, metric: QueryMetric, currency: string): string {
  return `${mover.change > 0 ? "+" : "-"}${formatValue(metric, Math.abs(mover.change), currency)}`;
}

/** Pure render half — also used by the frozen view-report renderer. */
export function TopMoversList({
  movers,
  metric,
  currency,
}: {
  movers: Mover[];
  metric: QueryMetric;
  currency: string;
}) {
  return (
    <ul className="h-full w-full overflow-auto space-y-2 px-1">
      {movers.map((mover) => {
        // Neutral grey for new/stopped: whether a campaign appearing or ending
        // is good news is not something the numbers can answer.
        const tone =
          mover.good === null
            ? "text-ink-muted"
            : mover.good
              ? "text-emerald-600"
              : "text-red-600";
        return (
          <li key={mover.group} className="flex items-start gap-2">
            <span className={cn("mt-0.5 shrink-0", tone)}>
              {mover.change > 0 ? (
                <BiTrendingUp className="w-3.5 h-3.5" />
              ) : (
                <BiTrendingDown className="w-3.5 h-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink truncate" title={mover.label}>
                {mover.label}
              </p>
              <p className="text-[10px] text-ink-faint tabular-nums truncate">
                {formatValue(metric, mover.previous, currency)} →{" "}
                {formatValue(metric, mover.current, currency)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-[12px] font-semibold tabular-nums", tone)}>
                {signedChange(mover, metric, currency)}
              </p>
              <p className="text-[10px] text-ink-faint tabular-nums">{secondaryLabel(mover)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TopMoversWidget({ config, instanceId }: WidgetRenderProps) {
  const cfg = useMemo(() => normalizeTopMoversConfig(config), [config]);
  const scope = useWidgetScope(config);
  const currency = useClientCurrency();
  const { clientId, dateRange } = scope;
  const compareMode = useAppStore((s) => s.compareMode);

  // Follows the page's Compare selector, falling back to the immediately
  // preceding period when it is "None" — a mover IS a change, so it always
  // needs an earlier window to be measured against. Same rule as the KPI and
  // custom-number readouts.
  const compareRange = useMemo(() => getCompareRange(dateRange, compareMode), [dateRange, compareMode]);
  const previousRange = useMemo(
    () => compareRange ?? previousPeriodRange(dateRange),
    [compareRange, dateRange]
  );

  // Both windows ask for the same wide slice, ranked by spend, so a group that
  // sits low in one of them still has a row to be joined against in the other.
  const params = {
    clientId,
    groupBy: cfg.groupBy,
    timeBucket: "none" as const,
    platforms: scope.platforms,
    campaignIds: scope.campaignIds,
    limit: TOP_MOVERS_QUERY_LIMIT,
    sortBy: TOP_MOVERS_QUERY_SORT_BY,
    sortDir: "desc" as const,
  };
  const current = useMetricQuery({ ...params, startDate: dateRange.start, endDate: dateRange.end });
  const previous = useMetricQuery({
    ...params,
    startDate: previousRange.start,
    endDate: previousRange.end,
  });

  const movers = useMemo(
    () => (current.data ? computeMovers(cfg, current.data, previous.data ?? null) : []),
    [cfg, current.data, previous.data]
  );

  const widgetData = useMemo<WidgetData | null>(
    () =>
      current.data && previous.data
        ? toWidgetData(cfg, movers, dateRange, previousRange)
        : null,
    [cfg, movers, current.data, previous.data, dateRange, previousRange]
  );
  useRegisterWidgetData(instanceId, widgetData);

  if (!clientId || current.isLoading || previous.isLoading) {
    return (
      <div className="h-full w-full space-y-2.5 px-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (current.isError || previous.isError) {
    return (
      <QueryError
        compact
        onRetry={() => {
          current.refetch();
          previous.refetch();
        }}
      />
    );
  }
  if (movers.length === 0) {
    return (
      <div className="h-full grid place-items-center text-xs text-ink-muted text-center px-2">
        {current.data && current.data.rows.length === 0
          ? "No data for this selection"
          : "Nothing moved in this period"}
      </div>
    );
  }

  return <TopMoversList movers={movers} metric={cfg.metric} currency={currency} />;
}

/** Raw numbers for CSV, trimmed of float noise. */
function num(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(4));
}

function toWidgetData(
  cfg: TopMoversConfig,
  movers: Mover[],
  dateRange: { start: string; end: string },
  previousRange: { start: string; end: string }
): WidgetData {
  const label = QUERY_METRIC_META[cfg.metric].label;
  return {
    columns: [
      TOP_MOVERS_GROUP_BY_LABELS[cfg.groupBy],
      `${label} (${dateRange.start} to ${dateRange.end})`,
      `${label} (${previousRange.start} to ${previousRange.end})`,
      "Change",
      "Change %",
      "Status",
    ],
    rows: movers.map((m) => [
      m.label,
      num(m.current),
      num(m.previous),
      num(m.change),
      m.changePct == null ? null : Number(m.changePct.toFixed(2)),
      m.status,
    ]),
  };
}

export function TopMoversConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const cfg = normalizeTopMoversConfig(config);

  /** Keeps unrelated keys (filters) — the dialog appends the shared filter card. */
  function update(patch: Partial<TopMoversConfig>) {
    onChange({ ...config, ...patch });
  }

  const limitOptions = TOP_MOVERS_LIMITS.includes(cfg.limit)
    ? TOP_MOVERS_LIMITS
    : [...TOP_MOVERS_LIMITS, cfg.limit].sort((a, b) => a - b);

  return (
    <ConfigSection title="Movement" hint="Ranked by absolute change">
      <ConfigField label="Metric">
        <div className="grid grid-cols-2 @[19rem]:grid-cols-3 @[24rem]:grid-cols-4 @[30rem]:grid-cols-5 gap-1.5">
          {QUERY_METRICS.map((m) => (
            <ChipToggle
              key={m}
              active={cfg.metric === m}
              onClick={() => update({ metric: m })}
              className="justify-center px-1"
            >
              {QUERY_METRIC_META[m].label}
            </ChipToggle>
          ))}
        </div>
      </ConfigField>

      <div className="grid grid-cols-1 @[26rem]:grid-cols-2 gap-x-4 gap-y-4">
        <ConfigField label="Break down by">
          <ChipRow>
            {TOP_MOVERS_GROUP_BYS.map((g) => (
              <ChipToggle key={g} active={cfg.groupBy === g} onClick={() => update({ groupBy: g })}>
                {TOP_MOVERS_GROUP_BY_LABELS[g]}
              </ChipToggle>
            ))}
          </ChipRow>
        </ConfigField>

        <ConfigField label="Direction">
          <ChipRow>
            {TOP_MOVERS_DIRECTIONS.map((d) => (
              <ChipToggle
                key={d}
                active={cfg.direction === d}
                onClick={() => update({ direction: d })}
              >
                {TOP_MOVERS_DIRECTION_LABELS[d]}
              </ChipToggle>
            ))}
          </ChipRow>
        </ConfigField>
      </div>

      <ConfigField label="Show">
        <Select value={String(cfg.limit)} onValueChange={(v) => update({ limit: Number(v) })}>
          <SelectTrigger size="sm" className="w-full text-xs" aria-label="Number of movers">
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
    </ConfigSection>
  );
}
