"use client";

import { useMemo } from "react";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { formatCurrency, formatNumber } from "@/lib/dashboard/metrics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

const SORT_OPTIONS = [
  { value: "spend", label: "Spend" },
  { value: "conversions", label: "Conversions" },
  { value: "cpa", label: "CPA" },
] as const;

const LIMIT_OPTIONS = [5, 8, 10, 20] as const;

interface CampaignSummary {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  spend: number;
  conversions: number;
  ctr: number;
  cpa: number;
}

function aggregateByCampaign(rows: CampaignPerformanceRow[]): CampaignSummary[] {
  const map = new Map<
    string,
    { campaignId: string; campaignName: string; platform: Platform; impressions: number; clicks: number; spend: number; conversions: number }
  >();

  for (const row of rows) {
    const existing = map.get(row.campaign_id);
    if (existing) {
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.spend += Number(row.spend);
      existing.conversions += Number(row.conversions);
    } else {
      map.set(row.campaign_id, {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        platform: row.platform,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(map.values()).map((c) => ({
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
  return typeof n === "number" && LIMIT_OPTIONS.includes(n as (typeof LIMIT_OPTIONS)[number]) ? n : 8;
}

function readSortBy(config: Record<string, unknown>): "spend" | "conversions" | "cpa" {
  const s = config.sortBy;
  return s === "conversions" || s === "cpa" ? s : "spend";
}

export function CampaignTableWidget({ config }: WidgetRenderProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  const limit = readLimit(config);
  const sortBy = readSortBy(config);

  const { data, isLoading, isError, refetch } = useMetrics({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const campaigns = useMemo(() => {
    const rows = aggregateByCampaign(data || []);
    return rows.sort((a, b) => b[sortBy] - a[sortBy]).slice(0, limit);
  }, [data, sortBy, limit]);

  if (!clientId || isLoading) {
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
            <th className="text-[11px] font-medium text-ink-muted pb-1.5">Campaign</th>
            <th className="text-[11px] font-medium text-ink-muted pb-1.5 text-right">Spend</th>
            <th className="text-[11px] font-medium text-ink-muted pb-1.5 text-right">Conv.</th>
            <th className="text-[11px] font-medium text-ink-muted pb-1.5 text-right">CTR</th>
            <th className="text-[11px] font-medium text-ink-muted pb-1.5 text-right">CPA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/60">
          {campaigns.map((c) => (
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
              <td className="py-1.5 text-right text-[12px] tabular-nums font-medium text-ink">
                {formatCurrency(c.spend)}
              </td>
              <td className="py-1.5 text-right text-[12px] tabular-nums text-ink-secondary">
                {formatNumber(c.conversions)}
              </td>
              <td className="py-1.5 text-right text-[12px] tabular-nums text-ink-secondary">
                {c.ctr.toFixed(2)}%
              </td>
              <td className="py-1.5 text-right text-[12px] tabular-nums text-ink-secondary">
                {formatCurrency(c.cpa)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignTableConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const limit = readLimit(config);
  const sortBy = readSortBy(config);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium text-ink-secondary">Rows shown</label>
        <Select value={String(limit)} onValueChange={(v) => onChange({ ...config, limit: Number(v) })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                Top {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-ink-secondary">Sort by</label>
        <Select value={sortBy} onValueChange={(v) => onChange({ ...config, sortBy: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
