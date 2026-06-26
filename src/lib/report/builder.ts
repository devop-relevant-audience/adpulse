import { compareMetrics, getMetrics, getDailyTrend, getFunnelData } from "@/lib/data/queries";
import { calculateHealthScore } from "@/lib/data/health-score";
import type { ComparisonResult, FunnelStage } from "@/lib/data/queries";
import type { HealthScoreResult } from "@/lib/data/health-score";
import type { Platform } from "@/lib/types/database";
import { format, subDays } from "date-fns";

export interface CampaignBreakdownItem {
  campaignName: string;
  platform: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
}

export interface PlatformSummary {
  platform: Platform;
  spend: number;
  conversions: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  pctOfSpend: number;
}

export interface TrendSummary {
  dailyData: Array<{
    date: string;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
  }>;
  bestDay: { date: string; conversions: number; spend: number };
  worstDay: { date: string; conversions: number; spend: number };
  avgDailySpend: number;
  spendVolatility: number;
}

export interface ReportData {
  id?: string;
  clientName: string;
  dateRange: { start: string; end: string };
  comparisonRange: { start: string; end: string };
  generatedAt: string;

  comparison: ComparisonResult;
  trendSummary: TrendSummary;
  platformBreakdown: PlatformSummary[];
  funnel: { overall: FunnelStage[]; byPlatform: Record<string, FunnelStage[]> };
  campaignBreakdown: CampaignBreakdownItem[];
  healthScore: HealthScoreResult;

  narratives: {
    executive: string;
    trends: string;
    platforms: string;
    funnel: string;
    campaigns: string;
    health: string;
    recommendations: string;
  };
}

export async function buildReport(params: {
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string;
}): Promise<ReportData> {
  const daysDiff = Math.round(
    (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const previousEnd = format(subDays(new Date(params.startDate), 1), "yyyy-MM-dd");
  const previousStart = format(subDays(new Date(params.startDate), daysDiff + 1), "yyyy-MM-dd");

  const [comparison, dailyTrend, rawMetrics, funnelData, healthScore] = await Promise.all([
    compareMetrics({
      clientId: params.clientId,
      currentStart: params.startDate,
      currentEnd: params.endDate,
      previousStart,
      previousEnd,
    }),
    getDailyTrend({
      clientId: params.clientId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    getMetrics({
      clientId: params.clientId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    getFunnelData({
      clientId: params.clientId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
    calculateHealthScore({
      clientId: params.clientId,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
  ]);

  // Campaign breakdown
  const campaignMap = new Map<string, {
    campaignName: string;
    platform: string;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
  }>();

  for (const row of rawMetrics) {
    const existing = campaignMap.get(row.campaign_id);
    if (existing) {
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.spend += Number(row.spend);
      existing.conversions += Number(row.conversions);
    } else {
      campaignMap.set(row.campaign_id, {
        campaignName: row.campaign_name,
        platform: row.platform,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        conversions: Number(row.conversions),
      });
    }
  }

  const campaignBreakdown: CampaignBreakdownItem[] = Array.from(campaignMap.values()).map((c) => ({
    ...c,
    ctr: c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0,
    cpc: c.clicks > 0 ? Number((c.spend / c.clicks).toFixed(2)) : 0,
    cpa: c.conversions > 0 ? Number((c.spend / c.conversions).toFixed(2)) : 0,
  }));

  // Platform breakdown
  const platformMap = new Map<Platform, { spend: number; conversions: number; clicks: number; impressions: number }>();
  for (const row of rawMetrics) {
    const existing = platformMap.get(row.platform) || { spend: 0, conversions: 0, clicks: 0, impressions: 0 };
    existing.spend += Number(row.spend);
    existing.conversions += Number(row.conversions);
    existing.clicks += Number(row.clicks);
    existing.impressions += Number(row.impressions);
    platformMap.set(row.platform, existing);
  }

  const totalSpend = Array.from(platformMap.values()).reduce((s, p) => s + p.spend, 0);
  const platformBreakdown: PlatformSummary[] = Array.from(platformMap.entries()).map(([platform, data]) => ({
    platform,
    ...data,
    ctr: data.impressions > 0 ? Number(((data.clicks / data.impressions) * 100).toFixed(2)) : 0,
    cpc: data.clicks > 0 ? Number((data.spend / data.clicks).toFixed(2)) : 0,
    cpa: data.conversions > 0 ? Number((data.spend / data.conversions).toFixed(2)) : 0,
    pctOfSpend: totalSpend > 0 ? Number(((data.spend / totalSpend) * 100).toFixed(1)) : 0,
  }));

  // Trend summary
  const sortedTrend = [...dailyTrend].sort((a, b) => b.conversions - a.conversions);
  const bestDay = sortedTrend[0] || { date: "", conversions: 0, spend: 0 };
  const worstDay = sortedTrend[sortedTrend.length - 1] || { date: "", conversions: 0, spend: 0 };
  const avgDailySpend = dailyTrend.length > 0
    ? dailyTrend.reduce((s, d) => s + d.spend, 0) / dailyTrend.length
    : 0;
  const spendStdDev = dailyTrend.length > 0
    ? Math.sqrt(dailyTrend.reduce((s, d) => s + (d.spend - avgDailySpend) ** 2, 0) / dailyTrend.length)
    : 0;
  const spendVolatility = avgDailySpend > 0 ? spendStdDev / avgDailySpend : 0;

  const trendSummary: TrendSummary = {
    dailyData: dailyTrend,
    bestDay: { date: bestDay.date, conversions: bestDay.conversions, spend: bestDay.spend },
    worstDay: { date: worstDay.date, conversions: worstDay.conversions, spend: worstDay.spend },
    avgDailySpend,
    spendVolatility,
  };

  // Generate narratives
  const narratives = await generateNarratives({
    clientName: params.clientName,
    startDate: params.startDate,
    endDate: params.endDate,
    comparison,
    campaignBreakdown,
    platformBreakdown,
    trendSummary,
    funnelData,
    healthScore,
  });

  return {
    clientName: params.clientName,
    dateRange: { start: params.startDate, end: params.endDate },
    comparisonRange: { start: previousStart, end: previousEnd },
    generatedAt: new Date().toISOString(),
    comparison,
    trendSummary,
    platformBreakdown,
    funnel: funnelData,
    campaignBreakdown,
    healthScore,
    narratives,
  };
}

interface NarrativeContext {
  clientName: string;
  startDate: string;
  endDate: string;
  comparison: ComparisonResult;
  campaignBreakdown: CampaignBreakdownItem[];
  platformBreakdown: PlatformSummary[];
  trendSummary: TrendSummary;
  funnelData: { overall: FunnelStage[]; byPlatform: Record<string, FunnelStage[]> };
  healthScore: HealthScoreResult;
}

async function generateNarratives(ctx: NarrativeContext): Promise<ReportData["narratives"]> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return generateFallbackNarratives(ctx);
  }

  const prompt = buildFullPrompt(ctx);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://adpulse.app",
        "X-Title": "AdPulse",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return generateFallbackNarratives(ctx);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) return generateFallbackNarratives(ctx);

    try {
      const parsed = JSON.parse(content);
      return {
        executive: parsed.executive || generateFallbackNarratives(ctx).executive,
        trends: parsed.trends || generateFallbackNarratives(ctx).trends,
        platforms: parsed.platforms || generateFallbackNarratives(ctx).platforms,
        funnel: parsed.funnel || generateFallbackNarratives(ctx).funnel,
        campaigns: parsed.campaigns || generateFallbackNarratives(ctx).campaigns,
        health: parsed.health || generateFallbackNarratives(ctx).health,
        recommendations: parsed.recommendations || generateFallbackNarratives(ctx).recommendations,
      };
    } catch {
      return { ...generateFallbackNarratives(ctx), executive: content };
    }
  } catch {
    return generateFallbackNarratives(ctx);
  }
}

function buildFullPrompt(ctx: NarrativeContext): string {
  const { clientName, startDate, endDate, comparison, campaignBreakdown, platformBreakdown, trendSummary, funnelData, healthScore } = ctx;
  const c = comparison.current;
  const d = comparison.deltas;

  const topCampaigns = [...campaignBreakdown].sort((a, b) => b.conversions - a.conversions).slice(0, 5);
  const worstCampaigns = [...campaignBreakdown].sort((a, b) => a.ctr - b.ctr).slice(0, 3);

  return `You are a senior media strategist writing a comprehensive client performance report for ${clientName}.
Period: ${startDate} to ${endDate}

DATA:

Period-over-period changes:
${Object.entries(d).map(([key, v]) => `${key}: ${v.percentage > 0 ? "+" : ""}${v.percentage}%`).join("\n")}

Current totals: ${c.totalImpressions.toLocaleString()} impressions, ${c.totalClicks.toLocaleString()} clicks, $${c.totalSpend.toLocaleString()} spend, ${c.totalConversions.toLocaleString()} conversions, ${c.avgCtr}% CTR, $${c.avgCpc} CPC, $${c.avgCpa} CPA

Platform breakdown:
${platformBreakdown.map((p) => `- ${p.platform}: $${p.spend.toFixed(0)} spend (${p.pctOfSpend}%), ${p.ctr}% CTR, $${p.cpa} CPA, ${p.conversions} conv`).join("\n")}

Trend: best day ${trendSummary.bestDay.date} (${trendSummary.bestDay.conversions} conv), worst ${trendSummary.worstDay.date} (${trendSummary.worstDay.conversions} conv), avg daily spend $${trendSummary.avgDailySpend.toFixed(0)}, volatility ${(trendSummary.spendVolatility * 100).toFixed(0)}%

Funnel: ${funnelData.overall.map((s) => `${s.stage}: ${s.volume} (${s.percentOfFirst}%)`).join(" → ")}

Top campaigns: ${topCampaigns.map((c) => `${c.campaignName}(${c.platform}): ${c.conversions} conv, $${c.cpa} CPA`).join("; ")}
Worst CTR: ${worstCampaigns.map((c) => `${c.campaignName}: ${c.ctr}% CTR`).join("; ")}

Health: ${healthScore.overallScore}/100 (Grade ${healthScore.grade}). Sub-scores: ${healthScore.subScores.map((s) => `${s.name}: ${s.score}`).join(", ")}

TASK: Return a JSON object with these keys, each being 2-4 sentences of professional analysis:
- "executive": Overall performance summary
- "trends": Analysis of performance trends and volatility
- "platforms": Platform-specific insights and comparisons
- "funnel": Funnel efficiency analysis
- "campaigns": Campaign highlights and lowlights
- "health": Health score interpretation
- "recommendations": 3-5 actionable recommendations as a paragraph

Use specific numbers. Professional but approachable tone. No markdown.`;
}

function generateFallbackNarratives(ctx: NarrativeContext): ReportData["narratives"] {
  const { clientName, startDate, endDate, comparison, campaignBreakdown, platformBreakdown, trendSummary, funnelData, healthScore } = ctx;
  const c = comparison.current;
  const d = comparison.deltas;

  const topCampaign = [...campaignBreakdown].sort((a, b) => b.conversions - a.conversions)[0];
  const topPlatform = [...platformBreakdown].sort((a, b) => b.conversions - a.conversions)[0];

  const executive = `For ${startDate} to ${endDate}, ${clientName} generated ${c.totalImpressions.toLocaleString()} impressions, ${c.totalClicks.toLocaleString()} clicks, and ${c.totalConversions.toLocaleString()} conversions on $${c.totalSpend.toLocaleString()} spend. Compared to the prior period, conversions ${d.totalConversions.percentage >= 0 ? "increased" : "decreased"} by ${Math.abs(d.totalConversions.percentage)}% while spend ${d.totalSpend.percentage >= 0 ? "rose" : "fell"} by ${Math.abs(d.totalSpend.percentage)}%. Overall CPA is $${c.avgCpa}, ${d.avgCpa.percentage < 0 ? "an improvement" : "a regression"} of ${Math.abs(d.avgCpa.percentage)}% from the prior period.`;

  const trends = `Average daily spend was $${trendSummary.avgDailySpend.toFixed(0)} with a volatility coefficient of ${(trendSummary.spendVolatility * 100).toFixed(0)}%. The best-performing day was ${trendSummary.bestDay.date} with ${trendSummary.bestDay.conversions} conversions, while the weakest was ${trendSummary.worstDay.date} with ${trendSummary.worstDay.conversions} conversions. ${trendSummary.spendVolatility > 0.3 ? "High spend variance suggests inconsistent budget delivery — consider setting more stable daily caps." : "Spend delivery is relatively consistent, indicating healthy budget pacing."}`;

  const platforms = topPlatform
    ? `${topPlatform.platform} leads with ${topPlatform.pctOfSpend}% of total spend and ${topPlatform.conversions} conversions at $${topPlatform.cpa} CPA. ${platformBreakdown.length > 1 ? `Across ${platformBreakdown.length} active platforms, CTR ranges from ${Math.min(...platformBreakdown.map((p) => p.ctr))}% to ${Math.max(...platformBreakdown.map((p) => p.ctr))}%.` : ""} Consider shifting budget toward platforms with lower CPA and higher conversion rates.`
    : "No platform data available for this period.";

  const funnel = funnelData.overall.length >= 3
    ? `The funnel processed ${funnelData.overall[0].volume.toLocaleString()} impressions down to ${funnelData.overall[1].volume.toLocaleString()} clicks (${funnelData.overall[1].percentOfPrevious}% CTR) and ${funnelData.overall[2].volume.toLocaleString()} conversions (${funnelData.overall[2].percentOfPrevious}% click-to-conversion rate). The overall impression-to-conversion rate is ${funnelData.overall[2].percentOfFirst}%, which ${funnelData.overall[2].percentOfFirst > 1 ? "is within healthy range" : "suggests room for landing page optimization"}.`
    : "Insufficient funnel data for this period.";

  const campaigns = topCampaign
    ? `The top campaign is "${topCampaign.campaignName}" (${topCampaign.platform}) with ${topCampaign.conversions} conversions at $${topCampaign.cpa} CPA and ${topCampaign.ctr}% CTR. ${campaignBreakdown.length} campaigns are active in total. The bottom performers by CTR should be reviewed for creative fatigue or audience mismatch.`
    : "No campaign data available.";

  const health = `Account health score is ${healthScore.overallScore}/100 (Grade ${healthScore.grade}). ${healthScore.insight} ${healthScore.subScores.length > 0 ? `Strongest dimension: ${[...healthScore.subScores].sort((a, b) => b.score - a.score)[0].name} (${[...healthScore.subScores].sort((a, b) => b.score - a.score)[0].score}/100). Weakest: ${[...healthScore.subScores].sort((a, b) => a.score - b.score)[0].name} (${[...healthScore.subScores].sort((a, b) => a.score - b.score)[0].score}/100).` : ""}`;

  const recommendations = `Based on the data: 1) ${d.avgCpa.percentage > 0 ? "CPA is rising — review bid strategies and pause underperforming ad groups" : "CPA efficiency is improving — maintain current optimization cadence"}. 2) ${trendSummary.spendVolatility > 0.3 ? "Stabilize daily budgets to reduce delivery volatility" : "Budget pacing is healthy — continue current allocation"}. 3) ${healthScore.overallScore < 60 ? "Address the lowest health sub-score urgently to prevent further degradation" : "Focus on incremental testing to push health score higher"}. 4) Refresh creatives on campaigns with declining CTR. 5) Consider reallocating budget toward the platform with the lowest CPA.`;

  return { executive, trends, platforms, funnel, campaigns, health, recommendations };
}
