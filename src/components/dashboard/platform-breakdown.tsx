"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  google: { label: "Google Ads", color: "#4285F4" },
  meta: { label: "Meta Ads", color: "#0668E1" },
  tiktok: { label: "TikTok Ads", color: "#121212" },
};

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

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
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
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  const platformData = aggregateByPlatform(metrics || []);
  const totalSpend = platformData.reduce((s, p) => s + p.spend, 0);

  return (
    <div className="bg-white rounded-xl border border-hairline">
      <div className="px-5 py-4">
        <h3 className="text-sm font-semibold text-ink">Spend by Platform</h3>
        <p className="text-xs text-ink-muted mt-0.5">Total: {formatCurrency(totalSpend)}</p>
      </div>

      {/* Consolidated mini-table */}
      <div className="px-5 pb-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className="text-left text-[10px] font-medium text-ink-muted uppercase tracking-wider pb-2">Platform</th>
              <th className="text-right text-[10px] font-medium text-ink-muted uppercase tracking-wider pb-2">Spend</th>
              <th className="text-right text-[10px] font-medium text-ink-muted uppercase tracking-wider pb-2">% Total</th>
              <th className="text-right text-[10px] font-medium text-ink-muted uppercase tracking-wider pb-2">CTR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {platformData.map((p) => (
              <tr key={p.platform} className="group">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PLATFORM_META[p.platform].color }}
                    />
                    <span className="text-[13px] font-medium text-ink">{PLATFORM_META[p.platform].label}</span>
                  </div>
                </td>
                <td className="py-3 text-right">
                  <span className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(p.spend)}</span>
                </td>
                <td className="py-3 text-right">
                  <span className="text-[12px] text-ink-muted tabular-nums">{p.pct}%</span>
                </td>
                <td className="py-3 text-right">
                  <span className="text-[12px] font-semibold text-ink tabular-nums">{p.ctr}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
                backgroundColor: PLATFORM_META[p.platform].color,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
