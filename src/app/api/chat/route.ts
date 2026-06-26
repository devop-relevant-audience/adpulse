import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getMetrics, compareMetrics, listCampaigns, getDailyTrend, detectAnomalies, getFunnelData } from '@/lib/data/queries';
import { getChannelMixAnalysis } from '@/lib/data/optimizer';
import { calculateHealthScore } from '@/lib/data/health-score';
import type { Platform } from '@/lib/types/database';
import { format, subDays } from 'date-fns';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

const chatSchema = z.object({
	message: z.string().min(1),
	clientId: z.string().uuid(),
	referenceContext: z.any().nullable().optional(),
	history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
});

const TOOL_DEFINITIONS = [
	{
		type: 'function' as const,
		function: {
			name: 'getMetrics',
			description:
				'Get campaign performance metrics for a client within a date range. Returns raw rows with impressions, clicks, spend, conversions, CTR, CPC, CPM per campaign per day.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string', description: 'The client UUID' },
					startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
					endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
					platform: { type: 'string', description: 'Optional: google, meta, or tiktok' },
					campaignId: { type: 'string', description: 'Optional: specific campaign ID' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'compareMetrics',
			description:
				'Compare aggregated metrics between two time periods for a client. Returns current period summary, previous period summary, and percentage deltas.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					currentStart: { type: 'string' },
					currentEnd: { type: 'string' },
					previousStart: { type: 'string' },
					previousEnd: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId', 'currentStart', 'currentEnd', 'previousStart', 'previousEnd'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'listCampaigns',
			description:
				'List all campaigns for a client, optionally filtered by platform. Returns campaign IDs, names, and platforms.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'getDailyTrend',
			description:
				'Get daily aggregated metrics (impressions, clicks, spend, conversions) for a client over a date range.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					startDate: { type: 'string' },
					endDate: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'detectAnomalies',
			description:
				'Detect anomalies in campaign metrics using Z-score analysis over a 7-day rolling window. Returns spikes and drops in spend, CTR, CPC, CPA, and conversions with severity levels.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					startDate: { type: 'string' },
					endDate: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'getFunnelData',
			description:
				'Get conversion funnel data showing impressions -> clicks -> conversions with drop-off rates. Includes per-platform breakdown.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					startDate: { type: 'string' },
					endDate: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'getChannelMixAnalysis',
			description:
				'Analyze cross-platform channel efficiency and get budget reallocation recommendations. Returns per-platform CPA, ROAS, efficiency scores, and reallocation suggestions.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					startDate: { type: 'string' },
					endDate: { type: 'string' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'calculateHealthScore',
			description:
				'Calculate account health score (0-100) with sub-scores for CPA efficiency, CTR trend, budget consistency, conversion trend, and spend efficiency. Returns grade A-F and actionable insights.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string' },
					startDate: { type: 'string' },
					endDate: { type: 'string' },
					platform: { type: 'string' },
				},
				required: ['clientId', 'startDate', 'endDate'],
			},
		},
	},
];

async function executeTool(name: string, args: Record<string, string>): Promise<string> {
	switch (name) {
		case 'getMetrics': {
			const data = await getMetrics({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
				campaignId: args.campaignId,
			});
			return JSON.stringify(data.slice(0, 50));
		}
		case 'compareMetrics': {
			const data = await compareMetrics({
				clientId: args.clientId,
				currentStart: args.currentStart,
				currentEnd: args.currentEnd,
				previousStart: args.previousStart,
				previousEnd: args.previousEnd,
				platform: args.platform as Platform | undefined,
			});
			return JSON.stringify(data);
		}
		case 'listCampaigns': {
			const data = await listCampaigns(args.clientId, args.platform as Platform | undefined);
			return JSON.stringify(data);
		}
		case 'getDailyTrend': {
			const data = await getDailyTrend({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
			});
			return JSON.stringify(data);
		}
		case 'detectAnomalies': {
			const data = await detectAnomalies({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
			});
			return JSON.stringify(data.slice(0, 20));
		}
		case 'getFunnelData': {
			const data = await getFunnelData({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
			});
			return JSON.stringify(data);
		}
		case 'getChannelMixAnalysis': {
			const data = await getChannelMixAnalysis({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
			});
			return JSON.stringify(data);
		}
		case 'calculateHealthScore': {
			const data = await calculateHealthScore({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
			});
			return JSON.stringify(data);
		}
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

interface OpenRouterMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

async function callOpenRouter(messages: OpenRouterMessage[], apiKey: string, stream = false): Promise<Response> {
	return fetch(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'HTTP-Referer': 'https://adpulse.app',
			'X-Title': 'AdPulse',
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: TOOL_DEFINITIONS,
			tool_choice: 'auto',
			stream,
		}),
	});
}

async function resolveToolCalls(messages: OpenRouterMessage[], apiKey: string): Promise<OpenRouterMessage[]> {
	let maxIterations = 5;

	while (maxIterations > 0) {
		const response = await callOpenRouter(messages, apiKey, false);
		if (!response.ok) break;

		const data = await response.json();
		const choice = data.choices?.[0];
		if (!choice) break;

		const assistantMessage = choice.message;

		if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
			return messages;
		}

		messages.push({
			role: 'assistant',
			content: assistantMessage.content,
			tool_calls: assistantMessage.tool_calls,
		});

		for (const toolCall of assistantMessage.tool_calls) {
			const args = JSON.parse(toolCall.function.arguments);
			const result = await executeTool(toolCall.function.name, args);
			messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: result,
			});
		}

		maxIterations--;
	}

	return messages;
}

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const parsed = chatSchema.safeParse(body);

		if (!parsed.success) {
			return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
		}

		const { message, clientId, referenceContext, history } = parsed.data;

		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			return handleWithoutAI(message, clientId, referenceContext);
		}

		const today = format(new Date(), 'yyyy-MM-dd');
		const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

		let systemPrompt = `You are AdPulse AI, a helpful analytics assistant for advertising data. You help media buyers and account managers understand their ad campaign performance across Google Ads, Meta Ads, and TikTok Ads.

Today's date is ${today}. The default analysis period is the last 30 days (${thirtyDaysAgo} to ${today}).

IMPORTANT RULES:
- Always use the provided tools to fetch real data before answering questions about metrics
- Be specific with numbers — cite exact values from the data
- When comparing periods, explain what changed and offer plausible reasons
- Keep answers concise but insightful
- Format currency values with $ and use K/M abbreviations for large numbers
- If data shows anomalies (sudden drops or spikes), highlight them and suggest causes
- The client ID for this conversation is: ${clientId}`;

		if (referenceContext) {
			systemPrompt += `\n\nThe user has selected a specific context reference:\n${JSON.stringify(referenceContext, null, 2)}\nUse this as the starting point for answering their question.`;
		}

		const messages: OpenRouterMessage[] = [{ role: 'system', content: systemPrompt }];

		if (history && history.length > 0) {
			for (const msg of history) {
				messages.push({
					role: msg.role === 'user' ? 'user' : 'assistant',
					content: msg.content,
				});
			}
		}

		messages.push({ role: 'user', content: message });

		const resolvedMessages = await resolveToolCalls([...messages], apiKey);

		const streamResponse = await callOpenRouter(resolvedMessages, apiKey, true);

		if (!streamResponse.ok) {
			const errorText = await streamResponse.text();
			console.error('OpenRouter streaming error:', errorText);
			return handleWithoutAI(message, clientId, referenceContext);
		}

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const reader = streamResponse.body?.getReader();
				if (!reader) {
					controller.close();
					return;
				}

				const decoder = new TextDecoder();
				let buffer = '';

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (const line of lines) {
							if (line.startsWith('data: ')) {
								const data = line.slice(6).trim();
								if (data === '[DONE]') {
									controller.enqueue(encoder.encode('data: [DONE]\n\n'));
									continue;
								}
								try {
									const parsed = JSON.parse(data);
									const content = parsed.choices?.[0]?.delta?.content;
									if (content) {
										controller.enqueue(
											encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
										);
									}
								} catch {
									// Skip malformed chunks
								}
							}
						}
					}
				} catch (error) {
					console.error('Stream processing error:', error);
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	} catch (error) {
		console.error('Chat error:', error);
		return NextResponse.json({ error: 'Failed to process chat message' }, { status: 500 });
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleWithoutAI(_message: string, clientId: string, _referenceContext: unknown) {
	try {
		const today = format(new Date(), 'yyyy-MM-dd');

		const [campaigns, comparison] = await Promise.all([
			listCampaigns(clientId),
			compareMetrics({
				clientId,
				currentStart: format(subDays(new Date(), 14), 'yyyy-MM-dd'),
				currentEnd: today,
				previousStart: format(subDays(new Date(), 28), 'yyyy-MM-dd'),
				previousEnd: format(subDays(new Date(), 15), 'yyyy-MM-dd'),
			}),
		]);

		let response = `Here's a quick overview based on your data:\n\n`;
		response += `**Performance Summary (Last 14 days vs. Prior 14 days)**\n`;
		response += `- Impressions: ${comparison.current.totalImpressions.toLocaleString()} (${comparison.deltas.totalImpressions.percentage > 0 ? '+' : ''}${comparison.deltas.totalImpressions.percentage}%)\n`;
		response += `- Clicks: ${comparison.current.totalClicks.toLocaleString()} (${comparison.deltas.totalClicks.percentage > 0 ? '+' : ''}${comparison.deltas.totalClicks.percentage}%)\n`;
		response += `- Spend: $${comparison.current.totalSpend.toLocaleString()} (${comparison.deltas.totalSpend.percentage > 0 ? '+' : ''}${comparison.deltas.totalSpend.percentage}%)\n`;
		response += `- Conversions: ${comparison.current.totalConversions.toLocaleString()} (${comparison.deltas.totalConversions.percentage > 0 ? '+' : ''}${comparison.deltas.totalConversions.percentage}%)\n`;
		response += `\n${campaigns.length} active campaigns across ${new Set(campaigns.map((c) => c.platform)).size} platforms.\n`;
		response += `\n_Note: For full AI analysis, add an OpenRouter API key to your environment._`;

		return NextResponse.json({ response });
	} catch {
		return NextResponse.json({
			response:
				"I'm running in basic mode (no API key configured). Please add OPENROUTER_API_KEY to your environment for full AI capabilities.",
		});
	}
}
