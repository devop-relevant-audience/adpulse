"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/dashboard/chart-theme";
import { formatCurrencyCompact as formatCurrency } from "@/lib/format";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

function aggregateByPlatform(rows: CampaignPerformanceRow[]) {
  const map = new Map<Platform, { spend: number; conversions: number; clicks: number; impressions: number }>();

  for (const row of rows) {
    const existing = map.get(row.platform);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.conversions += Number(row.conversions);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
    } else {
      map.set(row.platform, {
        spend: Number(row.spend),
        conversions: Number(row.conversions),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
      });
    }
  }

  const totalSpend = Array.from(map.values()).reduce((s, p) => s + p.spend, 0);

  return Array.from(map.entries()).map(([platform, data]) => ({
    platform,
    ...data,
    cpa: data.conversions > 0 ? Number((data.spend / data.conversions).toFixed(2)) : 0,
    ctr: data.impressions > 0 ? Number(((data.clicks / data.impressions) * 100).toFixed(2)) : 0,
    pct: totalSpend > 0 ? Number(((data.spend / totalSpend) * 100).toFixed(1)) : 0,
  }));
}

export function PlatformBreakdown() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);

  const { data: metrics, isLoading } = useMetrics({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
  });

  if (!clientId || isLoading) {
    return (
      <Panel className="p-5">
        <Skeleton className="h-[200px] w-full" />
      </Panel>
    );
  }

  const platformData = aggregateByPlatform(metrics || []);
  const totalSpend = platformData.reduce((s, p) => s + p.spend, 0);

  return (
    <Panel>
      <div className="px-5 py-4">
        <h3 className="text-sm font-semibold text-ink">Spend by platform</h3>
        <p className="text-xs text-ink-muted mt-0.5">Total: {formatCurrency(totalSpend)}</p>
      </div>

      {/* Consolidated mini-table */}
      <div className="px-5 pb-4">
        <Table>
          <TableHeader>
            <TableRow className="border-hairline hover:bg-transparent">
              <TableHead className="h-auto px-0 pb-2 text-[11px] font-medium text-ink-muted">Platform</TableHead>
              <TableHead className="h-auto px-0 pb-2 text-right text-[11px] font-medium text-ink-muted">Spend</TableHead>
              <TableHead className="h-auto px-0 pb-2 text-right text-[11px] font-medium text-ink-muted">% total</TableHead>
              <TableHead className="h-auto px-0 pb-2 text-right text-[11px] font-medium text-ink-muted">CTR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {platformData.map((p) => (
              <TableRow key={p.platform} className="group border-hairline/60 hover:bg-transparent">
                <TableCell className="px-0 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PLATFORM_COLORS[p.platform] }}
                    />
                    <span className="text-[13px] font-medium text-ink">{PLATFORM_LABELS[p.platform]}</span>
                  </div>
                </TableCell>
                <TableCell className="px-0 py-3 text-right">
                  <span className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(p.spend)}</span>
                </TableCell>
                <TableCell className="px-0 py-3 text-right">
                  <span className="text-[12px] text-ink-muted tabular-nums">{p.pct}%</span>
                </TableCell>
                <TableCell className="px-0 py-3 text-right">
                  <span className="text-[12px] font-semibold text-ink tabular-nums">{p.ctr}%</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Stacked bar visualization */}
      <div className="px-5 pb-4">
        <div className="h-3 rounded-full overflow-hidden flex">
          {platformData.map((p) => (
            <div
              key={p.platform}
              className="h-full first:rounded-l-full last:rounded-r-full transition-all"
              style={{
                width: `${p.pct}%`,
                backgroundColor: PLATFORM_COLORS[p.platform],
              }}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}
