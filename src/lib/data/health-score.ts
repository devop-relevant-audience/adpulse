import { getMetrics } from "./queries";
import type { Platform } from "@/lib/types/database";

interface SubScore {
  name: string;
  score: number;
  weight: number;
  weightedScore: number;
  description: string;
}

export interface HealthScoreResult {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  subScores: SubScore[];
  insight: string;
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

  // 1. CPA Efficiency (25%): current CPA vs rolling average
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
    // Score 100 if CPA is 20%+ below average, 0 if 50%+ above
    cpaScore = clamp(100 - ((cpaRatio - 0.8) / 0.7) * 100, 0, 100);
  }

  // 2. CTR Trend (20%): 7-day CTR vs 30-day CTR
  const overallCtr = sortedDays.reduce((s, d) => s + d.impressions, 0) > 0
    ? (sortedDays.reduce((s, d) => s + d.clicks, 0) / sortedDays.reduce((s, d) => s + d.impressions, 0)) * 100
    : 0;
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

  // 3. Budget Utilization (20%): variance of daily spend
  const avgDailySpend = totalSpend / sortedDays.length;
  const spendVariance = sortedDays.reduce((s, d) => s + (d.spend - avgDailySpend) ** 2, 0) / sortedDays.length;
  const spendCv = avgDailySpend > 0 ? Math.sqrt(spendVariance) / avgDailySpend : 0;

  // Lower CV = more consistent = higher score
  const budgetScore = clamp(100 - spendCv * 150, 0, 100);

  // 4. Conversion Volume Trend (20%): week-over-week growth
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

  // 5. Spend Efficiency / ROAS Trend (15%)
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

  const lowestSubScore = [...subScores].sort((a, b) => a.score - b.score)[0];
  const insight = overallScore >= 80
    ? "Your account is performing well across all dimensions. Keep monitoring for changes."
    : overallScore >= 60
      ? `Good overall health. Focus on improving ${lowestSubScore.name} (${lowestSubScore.score}/100) to push your score higher.`
      : `Your ${lowestSubScore.name} score is dragging overall health down. ${lowestSubScore.description}.`;

  return { overallScore, grade, subScores, insight };
}
