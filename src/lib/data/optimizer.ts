import { getMetrics } from "./queries";
import type { Platform } from "@/lib/types/database";

export interface PlatformEfficiency {
  platform: Platform;
  totalSpend: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  cpa: number;
  roas: number;
  ctr: number;
  currentAllocation: number;
  recentCpaTrend: number;
  efficiencyScore: number;
  efficiencyRank: number;
}

export interface ReallocationSuggestion {
  from: Platform;
  to: Platform;
  shiftPercent: number;
  projectedAdditionalConversions: number;
  rationale: string;
}

export interface ChannelMixAnalysis {
  platforms: PlatformEfficiency[];
  currentAllocation: Record<string, number>;
  recommendedAllocation: Record<string, number>;
  suggestions: ReallocationSuggestion[];
  totalSpend: number;
  totalConversions: number;
  projectedImpact: {
    additionalConversions: number;
    cpaReduction: number;
  };
}

export async function getChannelMixAnalysis(params: {
  clientId: string;
  startDate: string;
  endDate: string;
}): Promise<ChannelMixAnalysis> {
  const rows = await getMetrics({
    clientId: params.clientId,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  const platformAgg = new Map<Platform, {
    spend: number;
    conversions: number;
    clicks: number;
    impressions: number;
    dailySpend: Map<string, number>;
    dailyCpa: Map<string, number>;
  }>();

  for (const row of rows) {
    const existing = platformAgg.get(row.platform) || {
      spend: 0, conversions: 0, clicks: 0, impressions: 0,
      dailySpend: new Map(), dailyCpa: new Map(),
    };

    existing.spend += Number(row.spend);
    existing.conversions += Number(row.conversions);
    existing.clicks += Number(row.clicks);
    existing.impressions += Number(row.impressions);

    const daySpend = (existing.dailySpend.get(row.date) || 0) + Number(row.spend);
    const dayConv = Number(row.conversions);
    existing.dailySpend.set(row.date, daySpend);

    if (dayConv > 0) {
      const currentDayCpa = existing.dailyCpa.get(row.date) || 0;
      existing.dailyCpa.set(row.date, currentDayCpa + Number(row.spend) / dayConv);
    }

    platformAgg.set(row.platform, existing);
  }

  const totalSpend = Array.from(platformAgg.values()).reduce((s, p) => s + p.spend, 0);
  const totalConversions = Array.from(platformAgg.values()).reduce((s, p) => s + p.conversions, 0);

  const platforms: PlatformEfficiency[] = Array.from(platformAgg.entries()).map(([platform, data]) => {
    const cpa = data.conversions > 0 ? data.spend / data.conversions : Infinity;
    const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0;

    const sortedDates = Array.from(data.dailyCpa.keys()).sort();
    const recentDates = sortedDates.slice(-7);
    const olderDates = sortedDates.slice(-30, -7);

    const recentAvgCpa = recentDates.length > 0
      ? recentDates.reduce((s, d) => s + (data.dailyCpa.get(d) || 0), 0) / recentDates.length
      : cpa;
    const olderAvgCpa = olderDates.length > 0
      ? olderDates.reduce((s, d) => s + (data.dailyCpa.get(d) || 0), 0) / olderDates.length
      : cpa;

    const recentCpaTrend = olderAvgCpa > 0 ? ((recentAvgCpa - olderAvgCpa) / olderAvgCpa) * 100 : 0;

    // Lower CPA and improving trend = higher efficiency
    const cpaNormalized = cpa > 0 ? Math.max(0, 100 - (cpa / (totalSpend / Math.max(totalConversions, 1))) * 50) : 0;
    const trendBonus = Math.max(-20, Math.min(20, -recentCpaTrend));
    const efficiencyScore = Math.max(0, Math.min(100, cpaNormalized + trendBonus));

    return {
      platform,
      totalSpend: Number(data.spend.toFixed(2)),
      totalConversions: data.conversions,
      totalClicks: data.clicks,
      totalImpressions: data.impressions,
      cpa: Number(cpa.toFixed(2)),
      roas: data.spend > 0 ? Number((data.conversions / data.spend * 100).toFixed(2)) : 0,
      ctr: Number(ctr.toFixed(2)),
      currentAllocation: totalSpend > 0 ? Number(((data.spend / totalSpend) * 100).toFixed(1)) : 0,
      recentCpaTrend: Number(recentCpaTrend.toFixed(1)),
      efficiencyScore: Number(efficiencyScore.toFixed(1)),
      efficiencyRank: 0,
    };
  });

  platforms.sort((a, b) => b.efficiencyScore - a.efficiencyScore);
  platforms.forEach((p, i) => { p.efficiencyRank = i + 1; });

  const currentAllocation: Record<string, number> = {};
  const recommendedAllocation: Record<string, number> = {};
  const suggestions: ReallocationSuggestion[] = [];

  for (const p of platforms) {
    currentAllocation[p.platform] = p.currentAllocation;
    recommendedAllocation[p.platform] = p.currentAllocation;
  }

  if (platforms.length >= 2) {
    const best = platforms[0];
    const worst = platforms[platforms.length - 1];

    if (best.efficiencyScore - worst.efficiencyScore > 10) {
      const shiftPercent = Math.min(20, Math.round((best.efficiencyScore - worst.efficiencyScore) / 3));
      const shiftAmount = (shiftPercent / 100) * worst.currentAllocation;

      recommendedAllocation[worst.platform] = Number((worst.currentAllocation - shiftAmount).toFixed(1));
      recommendedAllocation[best.platform] = Number((best.currentAllocation + shiftAmount).toFixed(1));

      const projectedConversions = worst.cpa > 0 && best.cpa > 0
        ? ((shiftAmount / 100) * totalSpend) * (1 / best.cpa - 1 / worst.cpa)
        : 0;

      suggestions.push({
        from: worst.platform,
        to: best.platform,
        shiftPercent,
        projectedAdditionalConversions: Math.max(0, Number(projectedConversions.toFixed(0))),
        rationale: `${best.platform} has a ${((1 - best.cpa / worst.cpa) * 100).toFixed(0)}% lower CPA than ${worst.platform}. Shifting ${shiftPercent}% of ${worst.platform}'s budget could yield additional conversions at lower cost.`,
      });
    }
  }

  const projectedAdditionalConversions = suggestions.reduce((s, sg) => s + sg.projectedAdditionalConversions, 0);
  const currentAvgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const newCpa = (totalConversions + projectedAdditionalConversions) > 0
    ? totalSpend / (totalConversions + projectedAdditionalConversions)
    : 0;
  const cpaReduction = currentAvgCpa > 0 ? ((currentAvgCpa - newCpa) / currentAvgCpa) * 100 : 0;

  return {
    platforms,
    currentAllocation,
    recommendedAllocation,
    suggestions,
    totalSpend: Number(totalSpend.toFixed(2)),
    totalConversions,
    projectedImpact: {
      additionalConversions: projectedAdditionalConversions,
      cpaReduction: Number(cpaReduction.toFixed(1)),
    },
  };
}
