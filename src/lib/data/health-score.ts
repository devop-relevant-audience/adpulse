import { getMetrics } from "./queries";
import type { Platform } from "@/lib/types/database";

interface SubScore {
  name: string;
  score: number;
  weight: number;
  weightedScore: number;
  description: string;
}

export interface HealthSummaryStats {
  totalSpend: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  avgCpa: number;
  avgCtr: number;
  avgCpc: number;
  recentCpa: number;
  recentCtr: number;
  activeDays: number;
  totalDays: number;
  bestDay: { date: string; conversions: number };
  worstDay: { date: string; conversions: number };
  topPlatform: { platform: string; conversions: number } | null;
  weekOverWeekGrowth: number;
}

export interface HealthScoreResult {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  subScores: SubScore[];
  insight: string;
  summary: HealthSummaryStats;
  recommendations: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

export async function calculateHealthScore(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<HealthScoreResult> {
  const rows = await getMetrics(params);

  if (rows.length === 0) {
    return {
      overallScore: 0,
      grade: "F",
      subScores: [],
      insight: "No data available for the selected period.",
      summary: {
        totalSpend: 0, totalConversions: 0, totalClicks: 0, totalImpressions: 0,
        avgCpa: 0, avgCtr: 0, avgCpc: 0, recentCpa: 0, recentCtr: 0,
        activeDays: 0, totalDays: 0,
        bestDay: { date: "", conversions: 0 },
        worstDay: { date: "", conversions: 0 },
        topPlatform: null, weekOverWeekGrowth: 0,
      },
      recommendations: [],
    };
  }

  const dailyMap = new Map<string, {
    spend: number; conversions: number; clicks: number; impressions: number;
  }>();

  for (const row of rows) {
    const existing = dailyMap.get(row.date) || { spend: 0, conversions: 0, clicks: 0, impressions: 0 };
    existing.spend += Number(row.spend);
    existing.conversions += Number(row.conversions);
    existing.clicks += Number(row.clicks);
    existing.impressions += Number(row.impressions);
    dailyMap.set(row.date, existing);
  }

  const sortedDays = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      ...data,
      cpa: data.conversions > 0 ? data.spend / data.conversions : 0,
      ctr: data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0,
    }));

  const totalSpend = sortedDays.reduce((s, d) => s + d.spend, 0);
  const totalConversions = sortedDays.reduce((s, d) => s + d.conversions, 0);
  const totalClicks = sortedDays.reduce((s, d) => s + d.clicks, 0);
  const totalImpressions = sortedDays.reduce((s, d) => s + d.impressions, 0);

  // 1. CPA Efficiency (25%)
  const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const recent7 = sortedDays.slice(-7);
  const recentSpend = recent7.reduce((s, d) => s + d.spend, 0);
  const recentConv = recent7.reduce((s, d) => s + d.conversions, 0);
  const recentCpa = recentConv > 0 ? recentSpend / recentConv : avgCpa;

  let cpaScore: number;
  if (avgCpa === 0) {
    cpaScore = 50;
  } else {
    const cpaRatio = recentCpa / avgCpa;
    cpaScore = clamp(100 - ((cpaRatio - 0.8) / 0.7) * 100, 0, 100);
  }

  // 2. CTR Trend (20%)
  const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const recentImpressions = recent7.reduce((s, d) => s + d.impressions, 0);
  const recentClicks = recent7.reduce((s, d) => s + d.clicks, 0);
  const recentCtr = recentImpressions > 0 ? (recentClicks / recentImpressions) * 100 : 0;

  let ctrScore: number;
  if (overallCtr === 0) {
    ctrScore = 50;
  } else {
    const ctrRatio = recentCtr / overallCtr;
    ctrScore = clamp(50 + (ctrRatio - 1) * 200, 0, 100);
  }

  // 3. Budget Utilization (20%)
  const avgDailySpend = totalSpend / sortedDays.length;
  const spendVariance = sortedDays.reduce((s, d) => s + (d.spend - avgDailySpend) ** 2, 0) / sortedDays.length;
  const spendCv = avgDailySpend > 0 ? Math.sqrt(spendVariance) / avgDailySpend : 0;
  const budgetScore = clamp(100 - spendCv * 150, 0, 100);

  // 4. Conversion Volume Trend (20%)
  const firstHalf = sortedDays.slice(0, Math.floor(sortedDays.length / 2));
  const secondHalf = sortedDays.slice(Math.floor(sortedDays.length / 2));
  const firstHalfConv = firstHalf.reduce((s, d) => s + d.conversions, 0);
  const secondHalfConv = secondHalf.reduce((s, d) => s + d.conversions, 0);

  let convTrendScore: number;
  if (firstHalfConv === 0) {
    convTrendScore = secondHalfConv > 0 ? 80 : 50;
  } else {
    const growthRate = (secondHalfConv - firstHalfConv) / firstHalfConv;
    convTrendScore = clamp(50 + growthRate * 200, 0, 100);
  }

  // 5. Spend Efficiency (15%)
  const firstHalfSpend = firstHalf.reduce((s, d) => s + d.spend, 0);
  const secondHalfSpend = secondHalf.reduce((s, d) => s + d.spend, 0);
  const firstRoas = firstHalfSpend > 0 ? firstHalfConv / firstHalfSpend : 0;
  const secondRoas = secondHalfSpend > 0 ? secondHalfConv / secondHalfSpend : 0;

  let spendEffScore: number;
  if (firstRoas === 0) {
    spendEffScore = secondRoas > 0 ? 70 : 50;
  } else {
    const roasChange = (secondRoas - firstRoas) / firstRoas;
    spendEffScore = clamp(50 + roasChange * 200, 0, 100);
  }

  const subScores: SubScore[] = [
    {
      name: "CPA Efficiency",
      score: Number(cpaScore.toFixed(1)),
      weight: 0.25,
      weightedScore: Number((cpaScore * 0.25).toFixed(1)),
      description: recentCpa < avgCpa
        ? `Recent CPA ($${recentCpa.toFixed(2)}) is below average ($${avgCpa.toFixed(2)})`
        : `Recent CPA ($${recentCpa.toFixed(2)}) is above average ($${avgCpa.toFixed(2)})`,
    },
    {
      name: "CTR Trend",
      score: Number(ctrScore.toFixed(1)),
      weight: 0.20,
      weightedScore: Number((ctrScore * 0.20).toFixed(1)),
      description: recentCtr >= overallCtr
        ? `CTR trending up: ${recentCtr.toFixed(2)}% vs ${overallCtr.toFixed(2)}% average`
        : `CTR trending down: ${recentCtr.toFixed(2)}% vs ${overallCtr.toFixed(2)}% average`,
    },
    {
      name: "Budget Consistency",
      score: Number(budgetScore.toFixed(1)),
      weight: 0.20,
      weightedScore: Number((budgetScore * 0.20).toFixed(1)),
      description: spendCv < 0.3 ? "Spend is consistent day-to-day" : "Spend variance is high, consider more consistent daily budgets",
    },
    {
      name: "Conversion Trend",
      score: Number(convTrendScore.toFixed(1)),
      weight: 0.20,
      weightedScore: Number((convTrendScore * 0.20).toFixed(1)),
      description: secondHalfConv >= firstHalfConv
        ? `Conversions growing: ${secondHalfConv} vs ${firstHalfConv} in prior period`
        : `Conversions declining: ${secondHalfConv} vs ${firstHalfConv} in prior period`,
    },
    {
      name: "Spend Efficiency",
      score: Number(spendEffScore.toFixed(1)),
      weight: 0.15,
      weightedScore: Number((spendEffScore * 0.15).toFixed(1)),
      description: secondRoas >= firstRoas
        ? "ROAS is improving over time"
        : "ROAS is declining — review campaign targeting",
    },
  ];

  const overallScore = Number(subScores.reduce((s, sub) => s + sub.weightedScore, 0).toFixed(1));
  const grade = getGrade(overallScore);

  // Summary stats
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const activeDays = sortedDays.filter(d => d.spend > 0).length;
  const sortedByConv = [...sortedDays].sort((a, b) => b.conversions - a.conversions);
  const bestDay = sortedByConv[0];
  const worstDay = sortedByConv[sortedByConv.length - 1];

  const platformMap = new Map<string, number>();
  for (const row of rows) {
    const cur = platformMap.get(row.platform) || 0;
    platformMap.set(row.platform, cur + Number(row.conversions));
  }
  const topPlatformEntry = [...platformMap.entries()].sort((a, b) => b[1] - a[1])[0];

  const weekOverWeekGrowth = firstHalfConv > 0
    ? ((secondHalfConv - firstHalfConv) / firstHalfConv) * 100
    : 0;

  const summary: HealthSummaryStats = {
    totalSpend,
    totalConversions,
    totalClicks,
    totalImpressions,
    avgCpa,
    avgCtr: overallCtr,
    avgCpc,
    recentCpa,
    recentCtr,
    activeDays,
    totalDays: sortedDays.length,
    bestDay: { date: bestDay.date, conversions: bestDay.conversions },
    worstDay: { date: worstDay.date, conversions: worstDay.conversions },
    topPlatform: topPlatformEntry ? { platform: topPlatformEntry[0], conversions: topPlatformEntry[1] } : null,
    weekOverWeekGrowth,
  };

  // Generate recommendations
  const recommendations: string[] = [];
  const lowestSubScore = [...subScores].sort((a, b) => a.score - b.score)[0];

  if (cpaScore < 60) recommendations.push("Review targeting and bids — CPA is trending above average. Consider pausing low-performing campaigns.");
  if (ctrScore < 60) recommendations.push("CTR is declining — refresh ad creatives and test new copy variations.");
  if (budgetScore < 60) recommendations.push("Spend is inconsistent — set consistent daily budgets to improve delivery predictability.");
  if (convTrendScore < 60) recommendations.push("Conversions are declining — investigate landing page performance and audience fatigue.");
  if (spendEffScore < 60) recommendations.push("ROAS is decreasing — consider reallocating budget from underperforming channels.");
  if (recommendations.length === 0) recommendations.push("Account is healthy. Continue monitoring and testing incremental optimizations.");

  const insight = overallScore >= 80
    ? "Your account is performing well across all dimensions. Keep monitoring for changes."
    : overallScore >= 60
      ? `Good overall health. Focus on improving ${lowestSubScore.name} (${lowestSubScore.score}/100) to push your score higher.`
      : `Your ${lowestSubScore.name} score is dragging overall health down. ${lowestSubScore.description}.`;

  return { overallScore, grade, subScores, insight, summary, recommendations };
}
