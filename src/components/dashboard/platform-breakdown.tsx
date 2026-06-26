"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
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
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  const platformData = aggregateByPlatform(metrics || []);
  const totalSpend = platformData.reduce((s, p) => s + p.spend, 0);

  const pieData = platformData.map((p) => ({
    name: PLATFORM_META[p.platform].label,
    value: p.spend,
    color: PLATFORM_META[p.platform].color,
  }));

  return (
    <div className="bg-white rounded-xl border border-hairline">
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-ink">Spend by Platform</h3>
      </div>

      {/* Donut Chart */}
      <div className="px-5">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={78}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e6e6e6",
                borderRadius: "10px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                padding: "8px 12px",
              }}
              formatter={(value) => [`$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Spend"]}
            />
            <text x="50%" y="47%" textAnchor="middle" className="fill-ink text-lg font-semibold">
              {formatCurrency(totalSpend)}
            </text>
            <text x="50%" y="58%" textAnchor="middle" className="fill-ink-muted text-[11px]">
              Total Spend
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Platform Stats Table */}
      <div className="px-5 pb-4 space-y-2">
        {platformData.map((p) => (
          <div key={p.platform} className="flex items-center gap-3 py-2 border-t border-hairline/60 first:border-t-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: PLATFORM_META[p.platform].color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-ink">{PLATFORM_META[p.platform].label}</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-medium text-ink tabular-nums">{formatCurrency(p.spend)}</p>
              <p className="text-[11px] text-ink-muted tabular-nums">{p.pct}% of total</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 border-t border-hairline">
        {platformData.map((p) => (
          <div key={`stats-${p.platform}`} className="px-3 py-3 text-center border-r border-hairline last:border-r-0">
            <p className="text-[10px] text-ink-muted uppercase tracking-wider font-medium">
              {PLATFORM_META[p.platform].label.split(" ")[0]}
            </p>
            <p className="text-[13px] font-semibold text-ink mt-0.5 tabular-nums">{p.ctr}%</p>
            <p className="text-[10px] text-ink-faint">CTR</p>
          </div>
        ))}
      </div>
    </div>
  );
}
