"use client";

import { useState } from "react";
import { useFunnel } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { BiRightArrowAlt, BiTrendingDown } from "react-icons/bi";
import { PLATFORM_COLORS, PLATFORM_LABELS, SERIES_PALETTE } from "@/lib/dashboard/chart-theme";
import { formatNumber } from "@/lib/format";
import type { FunnelStage } from "@/lib/data/queries";
import type { Platform } from "@/lib/types/database";

// Funnel stages use the neutral series ramp (no amber, which is reserved for
// warnings) — derived from the canonical SERIES_PALETTE.
const STAGE_COLORS = SERIES_PALETTE.slice(0, 3).map((main) => ({
  main,
  light: `${main}14`,
  border: `${main}33`,
}));

function HorizontalFunnel({ stages, byPlatform }: { stages: FunnelStage[]; byPlatform: Record<string, FunnelStage[]> }) {
  if (stages.length === 0) {
    return (
      <div className="p-12 text-center text-ink-muted text-sm">No data available for this period.</div>
    );
  }

  const platforms = Object.keys(byPlatform) as Platform[];
  const maxVolume = stages[0].volume;

  return (
    <div className="space-y-6">
      {/* Main horizontal funnel flow */}
      <div className="relative">
        <div className="flex items-stretch gap-0">
          {stages.map((stage, i) => {
            const heightPercent = maxVolume > 0 ? (stage.volume / maxVolume) * 100 : 0;
            const stageColor = STAGE_COLORS[i % STAGE_COLORS.length];

            return (
              <div key={stage.stage} className="flex items-center flex-1">
                {/* Stage node */}
                <div className="flex-1 relative">
                  <div
                    className="rounded-xl border p-5 transition-all hover:shadow-md"
                    style={{
                      borderColor: stageColor.border,
                      backgroundColor: stageColor.light,
                    }}
                  >
                    <div className="text-center">
                      <p className="text-[12px] font-medium text-ink-muted mb-1">
                        {stage.stage}
                      </p>
                      <p className="text-2xl font-bold text-ink tabular-nums">
                        {formatNumber(stage.volume)}
                      </p>
                      {i > 0 && (
                        <p className="text-xs text-ink-muted mt-1">
                          {stage.percentOfFirst.toFixed(2)}% of total
                        </p>
                      )}
                    </div>

                    {/* Platform breakdown within stage */}
                    {platforms.length > 1 && (
                      <div className="mt-4 pt-3 border-t" style={{ borderColor: stageColor.border }}>
                        <div className="space-y-1.5">
                          {platforms.map((platform) => {
                            const platformStages = byPlatform[platform];
                            if (!platformStages || !platformStages[i]) return null;
                            const pVolume = platformStages[i].volume;
                            const pPercent = stage.volume > 0 ? (pVolume / stage.volume) * 100 : 0;

                            return (
                              <div key={platform} className="flex items-center gap-2">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                                />
                                <span className="text-[11px] text-ink-muted truncate flex-1">
                                  {PLATFORM_LABELS[platform]}
                                </span>
                                <span className="text-[11px] font-medium text-ink tabular-nums">
                                  {formatNumber(pVolume)}
                                </span>
                                <span className="text-[11px] text-ink-muted tabular-nums w-10 text-right">
                                  {pPercent.toFixed(0)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Volume bar under each stage */}
                  <div className="mt-2 mx-2">
                    <div className="h-2 bg-canvas-soft rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300 ease-out"
                        style={{
                          width: `${Math.max(heightPercent, 2)}%`,
                          backgroundColor: stageColor.main,
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Connector arrow between stages */}
                {i < stages.length - 1 && (
                  <div className="flex flex-col items-center px-3 shrink-0">
                    <div className="flex items-center gap-1">
                      <div className="w-8 h-[2px] bg-hairline" />
                      <BiRightArrowAlt className="w-4 h-4 text-ink-faint" />
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <BiTrendingDown className="w-3 h-3 text-ink-muted" />
                      <span className="text-[11px] font-semibold text-ink-muted tabular-nums">
                        {stages[i + 1].percentOfPrevious.toFixed(1)}%
                      </span>
                    </div>
                    <span className="text-[11px] text-ink-muted mt-0.5">conv. rate</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Drop-off summary */}
      <div className="bg-canvas-soft/50 rounded-xl border border-hairline p-4">
        <h4 className="text-[12px] font-medium text-ink-muted mb-3">Drop-off analysis</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stages.slice(1).map((stage, i) => {
            const prevStage = stages[i];
            const dropOff = prevStage.volume - stage.volume;
            const dropOffPercent = prevStage.volume > 0 ? (dropOff / prevStage.volume) * 100 : 0;

            return (
              <div key={stage.stage} className="flex items-center gap-3 bg-white rounded-lg border border-hairline p-3">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-ink">{prevStage.stage}</span>
                  <BiRightArrowAlt className="w-3 h-3 text-ink-faint shrink-0" />
                  <span className="text-[12px] font-medium text-ink">{stage.stage}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-semibold text-red-500 tabular-nums">
                    -{formatNumber(dropOff)} ({dropOffPercent.toFixed(1)}%)
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlatformBranching({ byPlatform, stages }: { byPlatform: Record<string, FunnelStage[]>; stages: FunnelStage[] }) {
  const platforms = Object.keys(byPlatform) as Platform[];

  if (platforms.length <= 1) return null;

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Platform performance breakdown</h3>
        <p className="text-xs text-ink-muted mt-0.5">How each platform contributes across the funnel</p>
      </div>

      <div className="p-5">
        <div className="space-y-4">
          {platforms.map((platform) => {
            const platformStages = byPlatform[platform];
            if (!platformStages || platformStages.length < 3) return null;

            const impressions = platformStages[0].volume;
            const conversions = platformStages[2].volume;
            const ctr = platformStages[1].percentOfPrevious;
            const convRate = platformStages[2].percentOfPrevious;
            const shareOfTotal = stages[0].volume > 0
              ? (impressions / stages[0].volume) * 100
              : 0;

            return (
              <div
                key={platform}
                className="rounded-xl border p-4 transition-all hover:shadow-sm"
                style={{ borderColor: `${PLATFORM_COLORS[platform]}30` }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                    />
                    <span className="text-[14px] font-semibold text-ink">{PLATFORM_LABELS[platform]}</span>
                  </div>
                  <span className="text-xs text-ink-muted font-medium">{shareOfTotal.toFixed(1)}% of total volume</span>
                </div>

                {/* Horizontal mini-funnel for this platform */}
                <div className="flex items-center gap-2">
                  {platformStages.map((pStage, idx) => {
                    const widthPercent = impressions > 0 ? (pStage.volume / impressions) * 100 : 0;
                    return (
                      <div key={pStage.stage} className="flex items-center flex-1">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-ink-muted">{pStage.stage}</span>
                            <span className="text-[12px] font-semibold text-ink tabular-nums">
                              {formatNumber(pStage.volume)}
                            </span>
                          </div>
                          <div className="h-3 bg-canvas-soft rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.max(widthPercent, 2)}%`,
                                backgroundColor: PLATFORM_COLORS[platform],
                                opacity: 0.7 + (idx * 0.1),
                              }}
                            />
                          </div>
                        </div>
                        {idx < platformStages.length - 1 && (
                          <div className="px-2 shrink-0">
                            <BiRightArrowAlt className="w-3 h-3 text-ink-faint" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Key metrics row */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-hairline/60">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-muted">CTR:</span>
                    <span className={cn(
                      "text-[12px] font-semibold tabular-nums",
                      ctr >= 3 ? "text-emerald-600" : ctr >= 1 ? "text-amber-600" : "text-red-500"
                    )}>
                      {ctr.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-muted">Conv. Rate:</span>
                    <span className={cn(
                      "text-[12px] font-semibold tabular-nums",
                      convRate >= 5 ? "text-emerald-600" : convRate >= 2 ? "text-amber-600" : "text-red-500"
                    )}>
                      {convRate.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-muted">Impressions:</span>
                    <span className="text-[12px] font-medium text-ink tabular-nums">
                      {formatNumber(impressions)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-muted">Conversions:</span>
                    <span className="text-[12px] font-medium text-ink tabular-nums">
                      {formatNumber(conversions)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function ComparisonTable({ byPlatform }: { byPlatform: Record<string, FunnelStage[]> }) {
  const platforms = Object.keys(byPlatform) as Platform[];
  if (platforms.length === 0) return null;

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Cross-platform comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline bg-canvas-soft/50">
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted">Platform</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Impressions</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Clicks</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">CTR</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Conversions</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Conv. rate</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Overall rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {platforms.map((platform) => {
              const pStages = byPlatform[platform];
              if (!pStages || pStages.length < 3) return null;

              const impressions = pStages[0].volume;
              const clicks = pStages[1].volume;
              const conversions = pStages[2].volume;
              const ctr = pStages[1].percentOfPrevious;
              const convRate = pStages[2].percentOfPrevious;
              const overallRate = pStages[2].percentOfFirst;

              return (
                <tr key={platform} className="hover:bg-canvas-soft/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                      />
                      <span className="text-[13px] font-medium text-ink">{PLATFORM_LABELS[platform]}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(impressions)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(clicks)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums font-medium text-ink">{ctr.toFixed(2)}%</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNumber(conversions)}</td>
                  <td className={cn(
                    "px-5 py-3 text-right text-[13px] tabular-nums font-medium",
                    convRate >= 5 ? "text-emerald-600" : convRate >= 2 ? "text-amber-600" : "text-red-500"
                  )}>
                    {convRate.toFixed(2)}%
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-muted">{overallRate.toFixed(3)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function FunnelChart() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const selectedCampaignIds = useAppStore((s) => s.selectedCampaignIds);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  const { data: funnelData, isLoading, isError, refetch } = useFunnel({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
    campaignIds: selectedCampaignIds.length ? selectedCampaignIds : undefined,
  });

  if (!clientId || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[250px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Conversion funnel</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            Track how users move through the funnel from impressions to conversions across platforms.
          </p>
        </div>
        <QueryError onRetry={() => refetch()} message="Couldn't load funnel data" />
      </div>
    );
  }

  if (!funnelData) return null;

  const activeFunnel = selectedPlatform && funnelData.byPlatform[selectedPlatform]
    ? funnelData.byPlatform[selectedPlatform]
    : funnelData.overall;

  const platformKeys = Object.keys(funnelData.byPlatform) as Platform[];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Conversion funnel</h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Track how users move through the funnel from impressions to conversions across platforms.
        </p>
      </div>

      {/* Platform filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setSelectedPlatform(null)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border",
            !selectedPlatform
              ? "bg-primary/10 text-primary border-primary/30"
              : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
          )}
        >
          All platforms
        </button>
        {platformKeys.map((p) => (
          <button
            key={p}
            onClick={() => setSelectedPlatform(p)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all border",
              selectedPlatform === p
                ? "border-transparent shadow-sm"
                : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
            )}
            style={selectedPlatform === p ? {
              backgroundColor: `${PLATFORM_COLORS[p]}10`,
              color: PLATFORM_COLORS[p],
              borderColor: `${PLATFORM_COLORS[p]}30`,
            } : undefined}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: selectedPlatform === p ? PLATFORM_COLORS[p] : "#6b6b6b" }}
            />
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Main funnel visualization */}
      <Panel className="p-6">
        <h3 className="text-sm font-semibold text-ink mb-5">
          {selectedPlatform ? `${PLATFORM_LABELS[selectedPlatform as Platform]} funnel` : "Overall funnel"}
        </h3>
        <HorizontalFunnel
          stages={activeFunnel}
          byPlatform={selectedPlatform ? {} : funnelData.byPlatform}
        />
      </Panel>

      {/* Platform branching view - only show when viewing all platforms */}
      {!selectedPlatform && platformKeys.length > 1 && (
        <PlatformBranching byPlatform={funnelData.byPlatform} stages={funnelData.overall} />
      )}

      {/* Comparison table */}
      {!selectedPlatform && <ComparisonTable byPlatform={funnelData.byPlatform} />}
    </div>
  );
}
