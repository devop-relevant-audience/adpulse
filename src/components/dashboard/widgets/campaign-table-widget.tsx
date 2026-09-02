"use client";

import { useMemo } from "react";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { formatNumber } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency-format";
import { aggregateCampaignTotals } from "@/lib/data/campaign-aggregate";
import { COMPARE_MODE_LABELS, getCompareRange } from "@/lib/dashboard/date-presets";
import { useRegisterWidgetData, type WidgetData } from "@/lib/dashboard/widget-data";
import {
  ChangeCaption,
  SortButton,
  applySort,
  useTableSort,
} from "@/components/dashboard/widgets/custom-viz";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import { ConfigSection, ConfigField } from "@/components/dashboard/config-ui";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";
import {
  CAMPAIGN_TABLE_DEFAULT_LIMIT,
  CAMPAIGN_TABLE_DEFAULT_SORT_BY,
  CAMPAIGN_TABLE_LIMITS,
  CAMPAIGN_TABLE_SORTS,
  type CampaignTableLimit,
  type CampaignTableSortBy,
} from "@/lib/dashboard/campaign-table";


interface CampaignSummary {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  spend: number;
  conversions: number;
  ctr: number;
  cpa: number;
}

type MetricKey = "spend" | "conversions" | "ctr" | "cpa";

/** Metric columns, in display order. `invert` = lower is better (CPA). */
const METRIC_COLUMNS: { key: MetricKey; label: string; invert: boolean }[] = [
  { key: "spend", label: "Spend", invert: false },
  { key: "conversions", label: "Conv.", invert: false },
  { key: "ctr", label: "CTR", invert: false },
  { key: "cpa", label: "CPA", invert: true },
];

/** CSV cells carry raw numbers, trimmed of float noise. */
function round(n: number): number {
  return Number(n.toFixed(2));
}

function aggregateByCampaign(rows: CampaignPerformanceRow[]): CampaignSummary[] {
  return aggregateCampaignTotals(rows).map((c) => ({
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    platform: c.platform,
    spend: c.spend,
    conversions: c.conversions,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
  }));
}

function readLimit(config: Record<string, unknown>): number {
  const n = config.limit;
  return typeof n === "number" && CAMPAIGN_TABLE_LIMITS.includes(n as CampaignTableLimit)
    ? n
    : CAMPAIGN_TABLE_DEFAULT_LIMIT;
}

function readSortBy(config: Record<string, unknown>): CampaignTableSortBy {
  const s = config.sortBy;
  return s === "conversions" || s === "cpa" ? s : CAMPAIGN_TABLE_DEFAULT_SORT_BY;
}

export function CampaignTableWidget({ config, instanceId }: WidgetRenderProps) {
  const { formatCurrency } = useCurrencyFormat();
  const { clientId, dateRange, platforms, campaignIds } = useWidgetScope(config);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const compareMode = useAppStore((s) => s.compareMode);

  const limit = readLimit(config);
  const sortBy = readSortBy(config);

  const { data, isLoading, isError, refetch } = useMetrics({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platforms,
    campaignIds,
  });

  // Same table over the earlier window. `clientId: null` holds the query while
  // comparison is off, so no request is made in the common case.
  const compareRange = useMemo(() => getCompareRange(dateRange, compareMode), [dateRange, compareMode]);
  const previous = useMetrics({
    clientId: compareRange ? clientId : null,
    startDate: compareRange?.start ?? dateRange.start,
    endDate: compareRange?.end ?? dateRange.end,
    platforms,
    campaignIds,
  });

  const sort = useTableSort();

  const campaigns = useMemo(() => {
    const rows = aggregateByCampaign(data || []);
    // Config picks WHICH rows (top N by its metric); a header click only
    // reorders what is already on screen.
    const top = rows.sort((a, b) => b[sortBy] - a[sortBy]).slice(0, limit);
    return applySort(top, sort, (c, key) =>
      key === "campaignName" ? c.campaignName : c[key as MetricKey]
    );
  }, [data, sortBy, limit, sort]);

  const prevByCampaign = useMemo(() => {
    if (!compareRange || !previous.data) return null;
    return new Map(aggregateByCampaign(previous.data).map((c) => [c.campaignId, c]));
  }, [compareRange, previous.data]);

  const compareLabel = compareMode === "none" ? undefined : COMPARE_MODE_LABELS[compareMode];

  function formatMetricValue(key: MetricKey, value: number): string {
    if (key === "spend" || key === "cpa") return formatCurrency(value);
    if (key === "ctr") return `${value.toFixed(2)}%`;
    return formatNumber(value);
  }

  const widgetData = useMemo<WidgetData | null>(() => {
    if (campaigns.length === 0) return null;
    const columns = ["Campaign", "Platform"];
    for (const col of METRIC_COLUMNS) {
      columns.push(col.label);
      if (prevByCampaign) columns.push(`${col.label} (prev)`, `${col.label} Δ%`);
    }
    const rows = campaigns.map((c) => {
      const cells: (string | number | null)[] = [c.campaignName, c.platform];
      const prev = prevByCampaign?.get(c.campaignId) ?? null;
      for (const col of METRIC_COLUMNS) {
        cells.push(round(c[col.key]));
        if (prevByCampaign) {
          cells.push(prev ? round(prev[col.key]) : null);
          cells.push(prev && prev[col.key] !== 0 ? round(((c[col.key] - prev[col.key]) / Math.abs(prev[col.key])) * 100) : null);
        }
      }
      return cells;
    });
    return { columns, rows };
  }, [campaigns, prevByCampaign]);

  useRegisterWidgetData(instanceId, widgetData);

  if (!clientId || isLoading || (!!compareRange && previous.isLoading)) {
    return (
      <div className="h-full w-full space-y-2 px-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (campaigns.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="sticky top-0 bg-white">
            <th
              className="text-[11px] font-medium text-ink-muted pb-1.5"
              aria-sort={sort.ariaSort("campaignName")}
            >
              <SortButton
                label="Campaign"
                active={sort.key === "campaignName"}
                dir={sort.dir}
                onClick={() => sort.toggle("campaignName", "asc")}
              />
            </th>
            {METRIC_COLUMNS.map((col) => (
              <th
                key={col.key}
                className="text-[11px] font-medium text-ink-muted pb-1.5 text-right"
                aria-sort={sort.ariaSort(col.key)}
              >
                <SortButton
                  label={col.label}
                  active={sort.key === col.key}
                  dir={sort.dir}
                  align="right"
                  onClick={() => sort.toggle(col.key)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/60">
          {campaigns.map((c) => {
            const prev = prevByCampaign?.get(c.campaignId) ?? null;
            return (
              <tr
                key={c.campaignId}
                className="cursor-pointer hover:bg-canvas-soft/50 transition-colors"
                onClick={() =>
                  setReferenceContext({
                    campaignId: c.campaignId,
                    campaignName: c.campaignName,
                    platform: c.platform,
                    dateRange,
                  })
                }
              >
                <td className="py-1.5 pr-2 max-w-[140px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PLATFORM_COLORS[c.platform] }} />
                    <span className="text-[12px] text-ink truncate">{c.campaignName}</span>
                  </div>
                </td>
                {METRIC_COLUMNS.map((col, i) => (
                  <td
                    key={col.key}
                    className={
                      i === 0
                        ? "py-1.5 text-right text-[12px] tabular-nums font-medium text-ink"
                        : "py-1.5 text-right text-[12px] tabular-nums text-ink-secondary"
                    }
                  >
                    {formatMetricValue(col.key, c[col.key])}
                    {prevByCampaign && (
                      <ChangeCaption
                        current={c[col.key]}
                        previous={prev ? prev[col.key] : null}
                        invert={col.invert}
                        format={(v) => formatMetricValue(col.key, v)}
                        compareLabel={compareLabel}
                      />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignTableConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const limit = readLimit(config);
  const sortBy = readSortBy(config);

  return (
    <ConfigSection title="Table">
      <div className="grid grid-cols-2 gap-2">
        <ConfigField label="Rows shown">
          <Select value={String(limit)} onValueChange={(v) => onChange({ ...config, limit: Number(v) })}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue>{`Top ${limit}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CAMPAIGN_TABLE_LIMITS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Top {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigField>
        <ConfigField label="Sort by">
          <Select value={sortBy} onValueChange={(v) => onChange({ ...config, sortBy: v })}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue>{CAMPAIGN_TABLE_SORTS.find((o) => o.value === sortBy)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CAMPAIGN_TABLE_SORTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConfigField>
      </div>
    </ConfigSection>
  );
}
