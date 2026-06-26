"use client";

import { useHealthScore, useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Activity, Target } from "lucide-react";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

const GRADE_CONFIG = {
  A: { color: "#16a34a", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
  B: { color: "#2563eb", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  C: { color: "#f59e0b", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  D: { color: "#f97316", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
  F: { color: "#ef4444", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
} as const;

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#f97316";
  return "#ef4444";
}

export function HealthWidget() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);

  const { data: healthData, isLoading } = useHealthScore({
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

  if (!healthData) return null;

  const gradeConfig = GRADE_CONFIG[healthData.grade];
  const color = getScoreColor(healthData.overallScore);

  return (
    <div className="bg-white rounded-xl border border-hairline p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink">Health Score</h3>
        <Activity className="w-4 h-4 text-ink-muted" />
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {healthData.overallScore}
        </div>
        <div>
          <div className={cn("inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold", gradeConfig.bg, gradeConfig.border, gradeConfig.text)}>
            Grade {healthData.grade}
          </div>
          <p className="text-[11px] text-ink-muted mt-1.5 line-clamp-2">{healthData.insight}</p>
        </div>
      </div>

      <div className="space-y-2">
        {healthData.subScores.slice(0, 3).map((sub) => (
          <div key={sub.name} className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted w-24 truncate">{sub.name}</span>
            <div className="flex-1 h-1.5 bg-canvas-soft rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${sub.score}%`, backgroundColor: getScoreColor(sub.score) }}
              />
            </div>
            <span className="text-[11px] font-medium text-ink tabular-nums w-7 text-right">{sub.score.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function ConversionWidget() {
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

  if (!metrics || metrics.length === 0) return null;

  const totalConversions = metrics.reduce((s: number, r: CampaignPerformanceRow) => s + Number(r.conversions), 0);
  const totalClicks = metrics.reduce((s: number, r: CampaignPerformanceRow) => s + Number(r.clicks), 0);
  const totalSpend = metrics.reduce((s: number, r: CampaignPerformanceRow) => s + Number(r.spend), 0);
  const convRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
  const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

  const platformMap = new Map<Platform, { conversions: number; clicks: number }>();
  for (const row of metrics) {
    const existing = platformMap.get(row.platform) || { conversions: 0, clicks: 0 };
    existing.conversions += Number(row.conversions);
    existing.clicks += Number(row.clicks);
    platformMap.set(row.platform, existing);
  }

  const platformData = Array.from(platformMap.entries())
    .map(([platform, data]) => ({
      platform,
      ...data,
      rate: data.clicks > 0 ? (data.conversions / data.clicks) * 100 : 0,
    }))
    .sort((a, b) => b.rate - a.rate);

  const PLATFORM_COLORS: Record<Platform, string> = {
    google: "#4285F4",
    meta: "#0668E1",
    tiktok: "#121212",
  };

  const PLATFORM_LABELS: Record<Platform, string> = {
    google: "Google",
    meta: "Meta",
    tiktok: "TikTok",
  };

  return (
    <div className="bg-white rounded-xl border border-hairline p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink">Conversions</h3>
        <Target className="w-4 h-4 text-ink-muted" />
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold text-ink tabular-nums">{formatNumber(totalConversions)}</span>
        <span className="text-xs text-ink-muted">total</span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ink-muted">Rate:</span>
          <span className="text-[12px] font-semibold text-ink tabular-nums">{convRate.toFixed(2)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ink-muted">CPA:</span>
          <span className="text-[12px] font-semibold text-ink tabular-nums">{formatCurrency(cpa)}</span>
        </div>
      </div>

      <div className="space-y-2.5">
        {platformData.map((p) => (
          <div key={p.platform} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: PLATFORM_COLORS[p.platform] }}
            />
            <span className="text-[11px] text-ink-muted w-14 truncate">{PLATFORM_LABELS[p.platform]}</span>
            <div className="flex-1 h-2 bg-canvas-soft rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(p.rate * 10, 100)}%`,
                  backgroundColor: PLATFORM_COLORS[p.platform],
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="text-[11px] font-medium text-ink tabular-nums w-12 text-right">{p.rate.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
