"use client";

import { useMemo } from "react";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT } from "@/lib/dashboard/chart-theme";
import type { WidgetRenderProps } from "@/lib/dashboard/types";
import type { Platform } from "@/lib/types/database";

export function PlatformBreakdownWidget({ config }: WidgetRenderProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const metricKey = (typeof config.metric === "string" ? config.metric : "spend") as
    | "spend"
    | "conversions";

  const { data, isLoading, isError, refetch } = useMetrics({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const agg = new Map<Platform, number>();
    for (const r of data) {
      const v = metricKey === "conversions" ? Number(r.conversions) : Number(r.spend);
      agg.set(r.platform, (agg.get(r.platform) ?? 0) + v);
    }
    const total = Array.from(agg.values()).reduce((s, v) => s + v, 0) || 1;
    return Array.from(agg.entries())
      .map(([p, value]) => ({ platform: p, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [data, metricKey]);

  if (!clientId || isLoading) return <Skeleton className="h-full w-full" />;
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (rows.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  return (
    <div className="h-full w-full flex flex-col justify-center gap-3">
      {rows.map((r) => {
        return (
          <div key={r.platform}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-1.5 text-ink font-medium">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PLATFORM_COLORS[r.platform] }} />
                {PLATFORM_LABELS_SHORT[r.platform]}
              </span>
              <span className="text-ink-muted">
                {metricKey === "conversions" ? formatNumber(r.value) : formatCurrency(r.value)}
                <span className="text-ink-faint ml-1.5">{r.pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-canvas-soft overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${r.pct}%`, background: PLATFORM_COLORS[r.platform] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
