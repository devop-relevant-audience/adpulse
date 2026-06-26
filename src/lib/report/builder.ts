import { compareMetrics, getMetrics, getDailyTrend, listCampaigns } from '@/lib/data/queries';
import type { ComparisonResult } from '@/lib/data/queries';
import { format, subDays } from 'date-fns';

export interface ReportData {
	clientName: string;
	dateRange: { start: string; end: string };
	comparisonRange: { start: string; end: string };
	comparison: ComparisonResult;
	dailyTrend: Array<{
		date: string;
		impressions: number;
		clicks: number;
		spend: number;
		conversions: number;
	}>;
	campaignBreakdown: Array<{
		campaignName: string;
		platform: string;
		impressions: number;
		clicks: number;
		spend: number;
		conversions: number;
		ctr: number;
		cpc: number;
	}>;
	narrative: string;
}

export async function buildReport(params: {
	clientId: string;
	clientName: string;
	startDate: string;
	endDate: string;
}): Promise<ReportData> {
	const daysDiff = Math.round(
		(new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24),
	);
	const previousEnd = format(subDays(new Date(params.startDate), 1), 'yyyy-MM-dd');
	const previousStart = format(subDays(new Date(params.startDate), daysDiff + 1), 'yyyy-MM-dd');

	const [comparison, dailyTrend, rawMetrics] = await Promise.all([
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
	]);

	const campaignMap = new Map<
		string,
		{
			campaignName: string;
			platform: string;
			impressions: number;
			clicks: number;
			spend: number;
			conversions: number;
		}
	>();

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

	const campaignBreakdown = Array.from(campaignMap.values()).map((c) => ({
		...c,
		ctr: c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0,
		cpc: c.clicks > 0 ? Number((c.spend / c.clicks).toFixed(2)) : 0,
	}));

	const narrative = await generateNarrative(
		params.clientName,
		comparison,
		campaignBreakdown,
		params.startDate,
		params.endDate,
	);

	return {
		clientName: params.clientName,
		dateRange: { start: params.startDate, end: params.endDate },
		comparisonRange: { start: previousStart, end: previousEnd },
		comparison,
		dailyTrend,
		campaignBreakdown,
		narrative,
	};
}

async function generateNarrative(
	clientName: string,
	comparison: ComparisonResult,
	campaigns: Array<{
		campaignName: string;
		platform: string;
		impressions: number;
		clicks: number;
		spend: number;
		conversions: number;
		ctr: number;
		cpc: number;
	}>,
	startDate: string,
	endDate: string,
): Promise<string> {
	const apiKey = process.env.OPENROUTER_API_KEY;

	const deltaSummary = Object.entries(comparison.deltas)
		.map(
			([key, d]) =>
				`${key}: ${d.percentage > 0 ? '+' : ''}${d.percentage}% (${d.absolute > 0 ? '+' : ''}${d.absolute.toLocaleString()})`,
		)
		.join('\n');

	const campaignSummary = campaigns
		.sort((a, b) => b.spend - a.spend)
		.map(
			(c) =>
				`- ${c.campaignName} (${c.platform}): $${c.spend.toFixed(2)} spend, ${c.conversions} conversions, ${c.ctr}% CTR, $${c.cpc} CPC`,
		)
		.join('\n');

	const prompt = `You are a senior media strategist writing a client performance report for ${clientName}.

Period: ${startDate} to ${endDate}

Period-over-period changes:
${deltaSummary}

Current period totals:
- Impressions: ${comparison.current.totalImpressions.toLocaleString()}
- Clicks: ${comparison.current.totalClicks.toLocaleString()}
- Spend: $${comparison.current.totalSpend.toLocaleString()}
- Conversions: ${comparison.current.totalConversions.toLocaleString()}
- Avg CTR: ${comparison.current.avgCtr}%
- Avg CPC: $${comparison.current.avgCpc}

Campaign breakdown:
${campaignSummary}

Write a concise executive summary (3-5 paragraphs) covering:
1. Overall performance overview with key metrics
2. Notable changes — what improved, what declined, and plausible causes
3. Campaign-level highlights — best and worst performers
4. Actionable recommendations for the next period

Write in a professional but approachable tone. Use specific numbers. Don't use markdown headers — just flowing paragraphs.`;

	if (!apiKey) {
		return generateFallbackNarrative(clientName, comparison, campaigns, startDate, endDate);
	}

	try {
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'HTTP-Referer': 'https://adpulse.app',
				'X-Title': 'AdPulse',
			},
			body: JSON.stringify({
				model: 'google/gemini-3-flash-preview',
				messages: [{ role: 'user', content: prompt }],
			}),
		});

		if (!response.ok) {
			return generateFallbackNarrative(clientName, comparison, campaigns, startDate, endDate);
		}

		const data = await response.json();
		return (
			data.choices?.[0]?.message?.content ||
			generateFallbackNarrative(clientName, comparison, campaigns, startDate, endDate)
		);
	} catch {
		return generateFallbackNarrative(clientName, comparison, campaigns, startDate, endDate);
	}
}

function generateFallbackNarrative(
	clientName: string,
	comparison: ComparisonResult,
	campaigns: Array<{
		campaignName: string;
		platform: string;
		spend: number;
		conversions: number;
		ctr: number;
	}>,
	startDate: string,
	endDate: string,
): string {
	const c = comparison.current;
	const d = comparison.deltas;

	const topCampaign = campaigns.sort((a, b) => b.conversions - a.conversions)[0];
	const worstCtr = campaigns.sort((a, b) => a.ctr - b.ctr)[0];

	let narrative = `For the period ${startDate} to ${endDate}, ${clientName} generated ${c.totalImpressions.toLocaleString()} impressions across all platforms, resulting in ${c.totalClicks.toLocaleString()} clicks and ${c.totalConversions.toLocaleString()} conversions on a total spend of $${c.totalSpend.toLocaleString()}.`;

	narrative += `\n\nCompared to the prior period, impressions ${d.totalImpressions.percentage >= 0 ? 'increased' : 'decreased'} by ${Math.abs(d.totalImpressions.percentage)}%, while spend ${d.totalSpend.percentage >= 0 ? 'rose' : 'fell'} by ${Math.abs(d.totalSpend.percentage)}%. Conversions ${d.totalConversions.percentage >= 0 ? 'grew' : 'declined'} by ${Math.abs(d.totalConversions.percentage)}%, suggesting ${d.totalConversions.percentage > d.totalSpend.percentage ? 'improving efficiency' : 'potential optimization opportunities'}.`;

	if (topCampaign) {
		narrative += `\n\nThe top-performing campaign was "${topCampaign.campaignName}" (${topCampaign.platform}) with ${topCampaign.conversions} conversions and a ${topCampaign.ctr}% CTR.`;
	}

	if (worstCtr && worstCtr.campaignName !== topCampaign?.campaignName) {
		narrative += ` "${worstCtr.campaignName}" had the lowest CTR at ${worstCtr.ctr}% and may benefit from creative refresh or audience refinement.`;
	}

	narrative += `\n\nRecommendation: Review underperforming campaigns for creative fatigue, consider reallocating budget toward the highest-converting channels, and monitor CPC trends closely in the coming period.`;

	return narrative;
}
