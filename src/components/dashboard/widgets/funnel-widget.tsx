"use client";

import { useFunnel } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/dashboard/metrics";

const STAGE_COLORS = ["#6366f1", "#f59e0b", "#10b981"];

export function FunnelWidget() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data: funnelData, isLoading } = useFunnel({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className="h-full w-full flex flex-col justify-center gap-2 px-1">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  const stages = funnelData?.overall ?? [];
  if (stages.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No funnel data</div>;

  const maxVolume = stages[0].volume || 1;

  return (
    <div className="h-full w-full flex flex-col justify-center gap-2.5 overflow-auto px-1">
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.volume / maxVolume) * 100, 4);
        const color = STAGE_COLORS[i % STAGE_COLORS.length];
        return (
          <div key={stage.stage}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="font-medium text-ink">{stage.stage}</span>
              <span className="text-ink-muted tabular-nums">
                {formatNumber(stage.volume)}
                {i > 0 && (
                  <span className="text-ink-faint ml-1.5">{stage.percentOfPrevious.toFixed(1)}%</span>
                )}
              </span>
            </div>
            <div className="h-3.5 rounded-md bg-canvas-soft overflow-hidden">
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${widthPct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
