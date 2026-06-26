"use client";

import { useState } from "react";
import { useOptimizer } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArrowRight, Lightbulb, TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import type { Platform } from "@/lib/types/database";
import type { ChannelMixAnalysis } from "@/lib/data/optimizer";

const PLATFORM_COLORS: Record<Platform, string> = {
  google: "#4285F4",
  meta: "#0668E1",
  tiktok: "#121212",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  tiktok: "TikTok Ads",
};

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function AllocationDonut({ title, allocation, totalSpend }: {
  title: string;
  allocation: Record<string, number>;
  totalSpend: number;
}) {
  const data = Object.entries(allocation).map(([platform, pct]) => ({
    name: PLATFORM_LABELS[platform as Platform] || platform,
    value: pct,
    color: PLATFORM_COLORS[platform as Platform] || "#888",
    spend: (pct / 100) * totalSpend,
  }));

  return (
    <div className="flex flex-col items-center">
      <h4 className="text-[12px] font-medium text-ink-muted mb-2">{title}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, index) => (
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
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-[11px] text-ink-muted">{d.name}: {d.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EfficiencyTable({ analysis }: { analysis: ChannelMixAnalysis }) {
  return (
    <div className="bg-white rounded-xl border border-hairline overflow-hidden">
      <div className="px-5 py-3 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Platform Efficiency Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline bg-canvas-soft/50">
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider">Platform</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Spend</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Conversions</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">CPA</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">CTR</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">CPA Trend</th>
              <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted uppercase tracking-wider text-right">Efficiency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {analysis.platforms.map((p) => (
              <tr key={p.platform} className="hover:bg-canvas-soft/30 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] }} />
                    <span className="text-[13px] font-medium text-ink">{PLATFORM_LABELS[p.platform]}</span>
                    <span className="text-[10px] text-ink-faint">#{p.efficiencyRank}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatCurrency(p.totalSpend)}</td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{p.totalConversions.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums font-medium text-ink">{formatCurrency(p.cpa)}</td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{p.ctr}%</td>
                <td className="px-5 py-3 text-right">
                  <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums",
                    p.recentCpaTrend <= 0 ? "text-emerald-600" : "text-red-500"
                  )}>
                    {p.recentCpaTrend <= 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {Math.abs(p.recentCpaTrend)}%
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-canvas-soft rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${p.efficiencyScore}%`,
                          backgroundColor: p.efficiencyScore >= 60 ? "#16a34a" : p.efficiencyScore >= 40 ? "#f59e0b" : "#ef4444",
                        }}
                      />
                    </div>
                    <span className="text-[12px] font-medium text-ink tabular-nums w-8 text-right">{p.efficiencyScore}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecommendationCard({ analysis, reallocationMultiplier }: { analysis: ChannelMixAnalysis; reallocationMultiplier: number }) {
  if (analysis.suggestions.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-medium text-emerald-800">Your channel mix is well-balanced</p>
            <p className="text-[12px] text-emerald-700 mt-1">All platforms are performing within similar efficiency ranges. No reallocation recommended.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {analysis.suggestions.map((suggestion, i) => {
        const adjustedConversions = Math.round(suggestion.projectedAdditionalConversions * reallocationMultiplier);
        return (
          <div key={i} className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-medium text-blue-800">
                    Shift {Math.round(suggestion.shiftPercent * reallocationMultiplier)}% from {PLATFORM_LABELS[suggestion.from]} to {PLATFORM_LABELS[suggestion.to]}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[12px] text-blue-600 font-medium">
                    +{adjustedConversions} conversions
                  </span>
                </div>
                <p className="text-[12px] text-blue-700">{suggestion.rationale}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChannelOptimizer() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const [reallocationMultiplier, setReallocationMultiplier] = useState(1);

  const { data: analysis, isLoading } = useOptimizer({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
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

  if (!analysis) return null;

  const adjustedAllocation: Record<string, number> = { ...analysis.currentAllocation };
  if (analysis.suggestions.length > 0) {
    const suggestion = analysis.suggestions[0];
    const shift = (suggestion.shiftPercent * reallocationMultiplier / 100) * (analysis.currentAllocation[suggestion.from] || 0);
    adjustedAllocation[suggestion.from] = Number(((analysis.currentAllocation[suggestion.from] || 0) - shift).toFixed(1));
    adjustedAllocation[suggestion.to] = Number(((analysis.currentAllocation[suggestion.to] || 0) + shift).toFixed(1));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Channel Mix Optimizer</h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Analyze cross-platform efficiency and optimize budget allocation based on marginal CPA.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-hairline p-4">
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">Total Spend</p>
          <p className="text-xl font-semibold text-ink mt-1 tabular-nums">{formatCurrency(analysis.totalSpend)}</p>
        </div>
        <div className="bg-white rounded-xl border border-hairline p-4">
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">Total Conversions</p>
          <p className="text-xl font-semibold text-ink mt-1 tabular-nums">{analysis.totalConversions.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-hairline p-4">
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">Projected +Conversions</p>
          <p className="text-xl font-semibold text-emerald-600 mt-1 tabular-nums">
            +{Math.round(analysis.projectedImpact.additionalConversions * reallocationMultiplier)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-hairline p-4">
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">CPA Reduction</p>
          <p className="text-xl font-semibold text-emerald-600 mt-1 tabular-nums">
            -{(analysis.projectedImpact.cpaReduction * reallocationMultiplier).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-hairline p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AllocationDonut title="Current Allocation" allocation={analysis.currentAllocation} totalSpend={analysis.totalSpend} />
          <AllocationDonut title="Recommended Allocation" allocation={adjustedAllocation} totalSpend={analysis.totalSpend} />
        </div>

        {analysis.suggestions.length > 0 && (
          <div className="mt-6 pt-4 border-t border-hairline">
            <label className="text-[12px] font-medium text-ink-muted">
              Reallocation Intensity
            </label>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-ink-faint">Conservative</span>
              <input
                type="range"
                min={0.25}
                max={2}
                step={0.25}
                value={reallocationMultiplier}
                onChange={(e) => setReallocationMultiplier(Number(e.target.value))}
                className="flex-1 accent-primary h-1.5"
              />
              <span className="text-[11px] text-ink-faint">Aggressive</span>
              <span className="text-[12px] font-medium text-ink tabular-nums w-10 text-right">{reallocationMultiplier}x</span>
            </div>
          </div>
        )}
      </div>

      <RecommendationCard analysis={analysis} reallocationMultiplier={reallocationMultiplier} />
      <EfficiencyTable analysis={analysis} />
    </div>
  );
}
