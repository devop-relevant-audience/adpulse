"use client";

import { useState } from "react";
import { useFunnel } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FunnelStage } from "@/lib/data/queries";
import type { Platform } from "@/lib/types/database";

const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  google: { label: "Google Ads", color: "#4285F4" },
  meta: { label: "Meta Ads", color: "#0668E1" },
  tiktok: { label: "TikTok Ads", color: "#121212" },
};

const STAGE_COLORS = ["#0075de", "#f59e0b", "#16a34a"];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function getDropOffColor(percent: number): string {
  if (percent >= 5) return "text-emerald-600";
  if (percent >= 1) return "text-amber-600";
  return "text-red-600";
}

function FunnelBar({ stages }: { stages: FunnelStage[] }) {
  if (stages.length === 0) {
    return (
      <div className="p-8 text-center text-ink-muted text-sm">No data available for this period.</div>
    );
  }

  const maxVolume = stages[0].volume;

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const widthPercent = maxVolume > 0 ? (stage.volume / maxVolume) * 100 : 0;
        const dropOff = i > 0 ? stages[i - 1].volume - stage.volume : 0;
        const dropOffPercent = i > 0 && stages[i - 1].volume > 0
          ? ((dropOff / stages[i - 1].volume) * 100).toFixed(1)
          : null;

        return (
          <div key={stage.stage}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{stage.stage}</span>
                <span className="text-[11px] text-ink-muted tabular-nums">{formatNumber(stage.volume)}</span>
              </div>
              <div className="flex items-center gap-3">
                {i > 0 && dropOffPercent && (
                  <span className="text-[11px] text-ink-faint">
                    -{formatNumber(dropOff)} dropped ({dropOffPercent}%)
                  </span>
                )}
                <span className={cn("text-[12px] font-medium tabular-nums", getDropOffColor(stage.percentOfFirst))}>
                  {stage.percentOfFirst.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="relative h-10 bg-canvas-soft rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500 ease-out flex items-center px-3"
                style={{
                  width: `${Math.max(widthPercent, 2)}%`,
                  backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length],
                  opacity: 0.85,
                }}
              >
                {widthPercent > 15 && (
                  <span className="text-white text-[11px] font-medium">{stage.percentOfPrevious.toFixed(1)}% of prev</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlatformFunnelComparison({ byPlatform }: { byPlatform: Record<string, FunnelStage[]> }) {
  const platforms = Object.keys(byPlatform) as Platform[];

  if (platforms.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-hairline overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Platform Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline bg-canvas-soft/50">
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider">Platform</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Impressions</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Clicks</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">CTR</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Conversions</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Conv. Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {platforms.map((platform) => {
              const stages = byPlatform[platform];
              if (!stages || stages.length < 3) return null;

              const impressions = stages[0].volume;
              const clicks = stages[1].volume;
              const conversions = stages[2].volume;
              const ctr = stages[1].percentOfPrevious;
              const convRate = stages[2].percentOfPrevious;

              return (
                <tr key={platform} className="hover:bg-canvas-soft/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PLATFORM_META[platform]?.color || "#888" }}
                      />
                      <span className="text-[13px] font-medium text-ink">{PLATFORM_META[platform]?.label || platform}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(impressions)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(clicks)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums font-medium text-ink">{ctr.toFixed(2)}%</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(conversions)}</td>
                  <td className={cn("px-5 py-3 text-right text-[13px] tabular-nums font-medium", getDropOffColor(convRate))}>
                    {convRate.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FunnelChart() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  const { data: funnelData, isLoading } = useFunnel({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!funnelData) return null;

  const activeFunnel = selectedPlatform && funnelData.byPlatform[selectedPlatform]
    ? funnelData.byPlatform[selectedPlatform]
    : funnelData.overall;

  const platformKeys = Object.keys(funnelData.byPlatform) as Platform[];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Conversion Funnel</h2>
        <p className="text-sm text-ink-muted mt-0.5">Visualize the journey from impressions to conversions with drop-off rates at each stage.</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setSelectedPlatform(null)}
          className={cn(
            "px-3 py-1.5 rounded-md text-[12px] font-medium transition-all border",
            !selectedPlatform
              ? "bg-primary/10 text-primary border-primary/30"
              : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
          )}
        >
          All Platforms
        </button>
        {platformKeys.map((p) => (
          <button
            key={p}
            onClick={() => setSelectedPlatform(p)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all border",
              selectedPlatform === p
                ? "border-transparent shadow-sm"
                : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
            )}
            style={selectedPlatform === p ? {
              backgroundColor: `${PLATFORM_META[p].color}10`,
              color: PLATFORM_META[p].color,
              borderColor: `${PLATFORM_META[p].color}30`,
            } : undefined}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: selectedPlatform === p ? PLATFORM_META[p].color : "#a39e98" }}
            />
            {PLATFORM_META[p].label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-hairline p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">
          {selectedPlatform ? `${PLATFORM_META[selectedPlatform as Platform]?.label || selectedPlatform} Funnel` : "Overall Funnel"}
        </h3>
        <FunnelBar stages={activeFunnel} />
      </div>

      {!selectedPlatform && <PlatformFunnelComparison byPlatform={funnelData.byPlatform} />}
    </div>
  );
}
