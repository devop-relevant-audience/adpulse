import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getClientCurrency, getMetrics, compareMetrics, listCampaigns, getDailyTrend, getFunnelData, getCreatives, getCreativeFatigueAnalysis } from '@/lib/data/queries';
import { calculateHealthScore } from '@/lib/data/health-score';
import { addMessage, createSession, getMessages, getSession } from '@/lib/data/chat';
import type { ChatSessionSummary } from '@/lib/data/chat';
import { requireClientAccess, requireUser } from '@/lib/auth/guard';
import { withRoute } from '@/lib/http/with-route';
import { logger } from '@/lib/log';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';
import type { Platform } from '@/lib/types/database';
import { currencySymbol } from '@/lib/format';
import { format, subDays } from 'date-fns';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

// Abort any single OpenRouter request that stalls past this window so a hung
// upstream can't wedge the route (which is itself bounded by maxDuration below).
const OPENROUTER_TIMEOUT_MS = 30_000;
// Cap on the tool-calling loop iterations before we stream the final answer.
const MAX_TOOL_ITERATIONS = 5;
// Cap the conversation history replayed to the model each turn. The full thread
// is persisted in the DB; only the most recent messages are resent, to bound
// token cost / latency and stay well under the model context window as threads
// grow. Counts prior stored messages — the system prompt and the new user
// message are added on top and always sent.
const MAX_HISTORY_MESSAGES = 20;

// Streaming SSE route: it runs a bounded tool-calling loop then streams tokens,
// so it needs more headroom than the platform default. The Node runtime is
// required because the tool executors hit the Drizzle/pg data layer.
export const runtime = 'nodejs';
export const maxDuration = 60;

const chatSchema = z.object({
	message: z.string().min(1),
	clientId: z.string().uuid(),
	sessionId: z.string().uuid().optional(),
	referenceContext: z.any().nullable().optional(),
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
	{
		type: 'function' as const,
		function: {
			name: 'getCreatives',
			description:
				'Get ad creative performance data for a client. Returns creative-level metrics including headline, body copy, thumbnail URL, CTR, CPA, spend, conversions, days running, status (active/fatigued/paused), and creative type (image/video/carousel). Useful for answering questions about which ads are performing best or worst.',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string', description: 'The client UUID' },
					platform: { type: 'string', description: 'Optional: google, meta, or tiktok' },
					status: { type: 'string', description: 'Optional: active, fatigued, or paused' },
					sort: { type: 'string', description: 'Optional: spend, ctr, cpa, impressions, conversions' },
					order: { type: 'string', description: 'Optional: asc or desc' },
				},
				required: ['clientId'],
			},
		},
	},
	{
		type: 'function' as const,
		function: {
			name: 'getCreativeFatigueAnalysis',
			description:
				'Analyze creative fatigue across all ads for a client. Returns ads that have been running 14+ days, ranked by a fatigue score that considers CTR degradation, CPA inflation, and age. Higher fatigue_score means worse fatigue. Use this to answer questions like "which creatives are fatiguing?" or "which ads should I refresh?"',
			parameters: {
				type: 'object',
				properties: {
					clientId: { type: 'string', description: 'The client UUID' },
				},
				required: ['clientId'],
			},
		},
	},
];

async function executeTool(
	name: string,
	args: Record<string, string>,
	authorizedClientId: string,
): Promise<string> {
	// Never trust the model-emitted clientId: the request's clientId was
	// membership-checked in POST; tool calls must not cross that boundary.
	args.clientId = authorizedClientId;
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
		case 'getFunnelData': {
			const data = await getFunnelData({
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				platform: args.platform as Platform | undefined,
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
		case 'getCreatives': {
			const data = await getCreatives({
				clientId: args.clientId,
				platform: args.platform as Platform | undefined,
				status: args.status as 'active' | 'fatigued' | 'paused' | undefined,
				sort: args.sort,
				order: args.order as 'asc' | 'desc' | undefined,
			});
			return JSON.stringify(data.slice(0, 30));
		}
		case 'getCreativeFatigueAnalysis': {
			const data = await getCreativeFatigueAnalysis(args.clientId);
			return JSON.stringify(data.slice(0, 20));
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
	// Guard every outbound call with an AbortController-based timeout. fetch()
	// resolves once the response headers arrive: for stream=false OpenRouter
	// buffers the whole completion first, so the window covers generation; for
	// stream=true it covers connect/TTFB, and the timer is cleared here (in
	// `finally`) before POST reads the token stream, so the stream body itself is
	// never aborted mid-flight.
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
	try {
		return await fetch(OPENROUTER_URL, {
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
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function resolveToolCalls(
	messages: OpenRouterMessage[],
	apiKey: string,
	authorizedClientId: string,
): Promise<OpenRouterMessage[]> {
	let maxIterations = MAX_TOOL_ITERATIONS;

	while (maxIterations > 0) {
		let response: Response;
		try {
			response = await callOpenRouter(messages, apiKey, false);
		} catch (error) {
			// Timeout (AbortError) or network failure during tool resolution: stop
			// looping and let the caller proceed with the messages gathered so far.
			logger.error('OpenRouter tool-resolution request failed', error, { route: 'chat.POST' });
			break;
		}
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
			let args: Record<string, string>;
			try {
				args = JSON.parse(toolCall.function.arguments);
			} catch (error) {
				// The model emitted malformed JSON for the tool arguments. Feed the
				// error back as the tool result so the loop can recover on the next
				// iteration instead of crashing the whole request.
				logger.error('Failed to parse tool-call arguments', error, {
					route: 'chat.POST',
					tool: toolCall.function.name,
				});
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: 'Invalid tool arguments: could not parse JSON.' }),
				});
				continue;
			}
			const result = await executeTool(toolCall.function.name, args, authorizedClientId);
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

export const POST = withRoute('chat.POST', async (request: NextRequest) => {
	const gate = await requireUser();
	if (!gate.ok) return gate.response;

	// Throttle per authenticated user (fall back to IP) before any OpenRouter or
	// DB work. Fails open when Upstash isn't configured.
	const rl = await checkRateLimit(gate.ctx.userId || getClientIp(request), {
		prefix: 'chat',
		limit: 30,
		windowSeconds: 60,
	});
	if (!rl.ok) return rateLimitResponse(rl);

	{
		const body = await request.json();
		const parsed = chatSchema.safeParse(body);

		if (!parsed.success) {
			return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
		}

		const { message, clientId, sessionId, referenceContext } = parsed.data;

		// Authorize the target client BEFORE opening the SSE stream.
		const access = await requireClientAccess(gate.ctx, clientId);
		if (!access.ok) return access.response;

		// Resolve the chat session. The session is bound to the already-authorized
		// clientId so a caller cannot reach another client's session.
		let session: ChatSessionSummary;
		if (sessionId) {
			const existing = await getSession(sessionId);
			if (!existing || existing.clientId !== clientId) {
				return NextResponse.json({ error: 'Session not found' }, { status: 404 });
			}
			session = existing;
		} else {
			const title = message.trim().slice(0, 80) || 'New chat';
			session = await createSession(clientId, title);
		}

		// Load prior conversation history from the DB BEFORE inserting the new
		// message, then persist the incoming user message.
		const prior = await getMessages(session.id);
		// Cap the replayed history to the most recent turns. The full thread stays
		// in the DB; resending only the tail bounds token cost/latency and keeps
		// requests under the model context window as conversations grow.
		const recentPrior = prior.slice(-MAX_HISTORY_MESSAGES);
		const history = recentPrior.map((m) => ({ role: m.role, content: m.content }));
		await addMessage(session.id, 'user', message, referenceContext ?? null);

		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			return handleWithoutAI(session.id, clientId, referenceContext);
		}

		const today = format(new Date(), 'yyyy-MM-dd');
		const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
		const currency = await getClientCurrency(clientId);

		let systemPrompt = `You are AdPulse AI, a helpful analytics assistant for advertising data. You help media buyers and account managers understand their ad campaign performance across Google Ads, Meta Ads, and TikTok Ads.

Today's date is ${today}. The default analysis period is the last 30 days (${thirtyDaysAgo} to ${today}).

IMPORTANT RULES:
- Always use the provided tools to fetch real data before answering questions about metrics
- Be specific with numbers — cite exact values from the data
- When comparing periods, explain what changed and offer plausible reasons
- Keep answers concise but insightful
- All monetary values for this client are in ${currency}: format them with the ${currencySymbol(currency)} symbol and use K/M abbreviations for large numbers
- You have access to creative-level analytics. Use getCreatives to see individual ad performance and getCreativeFatigueAnalysis to identify ads suffering from creative fatigue (declining CTR, rising CPA over time). When asked about fatiguing creatives, always use the fatigue analysis tool.
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

		const resolvedMessages = await resolveToolCalls([...messages], apiKey, clientId);

		let streamResponse: Response;
		try {
			streamResponse = await callOpenRouter(resolvedMessages, apiKey, true);
		} catch (error) {
			// Timeout (AbortError) or network failure before the stream opened.
			// Degrade to the basic-mode summary rather than 500-ing the request.
			logger.error('OpenRouter streaming request failed', error, { route: 'chat.POST' });
			return handleWithoutAI(session.id, clientId, referenceContext);
		}

		if (!streamResponse.ok) {
			const errorText = await streamResponse.text();
			logger.error('OpenRouter streaming error', undefined, {
				route: 'chat.POST',
				detail: errorText,
			});
			return handleWithoutAI(session.id, clientId, referenceContext);
		}

		const resolvedSessionId = session.id;
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				// Tell the client its (possibly newly created) session id first.
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sessionId: resolvedSessionId })}\n\n`));

				const reader = streamResponse.body?.getReader();
				if (!reader) {
					controller.close();
					return;
				}

				const decoder = new TextDecoder();
				let buffer = '';
				let assistantText = '';
				let persisted = false;

				// Persist the assistant reply exactly once. Runs from the finally
				// block so partial output survives a client abort or stream error.
				const persistAssistant = async () => {
					if (persisted) return;
					persisted = true;
					if (assistantText.length > 0) {
						try {
							await addMessage(resolvedSessionId, 'assistant', assistantText, null);
						} catch (error) {
							logger.error('Failed to persist assistant message', error, {
								route: 'chat.POST',
								sessionId: resolvedSessionId,
							});
						}
					}
				};

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
										assistantText += content;
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
					logger.error('Stream processing error', error, { route: 'chat.POST' });
				} finally {
					await persistAssistant();
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
	}
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleWithoutAI(sessionId: string, clientId: string, _referenceContext: unknown) {
	let responseText: string;
	try {
		const today = format(new Date(), 'yyyy-MM-dd');

		const [campaigns, comparison, currency] = await Promise.all([
			listCampaigns(clientId),
			compareMetrics({
				clientId,
				currentStart: format(subDays(new Date(), 14), 'yyyy-MM-dd'),
				currentEnd: today,
				previousStart: format(subDays(new Date(), 28), 'yyyy-MM-dd'),
				previousEnd: format(subDays(new Date(), 15), 'yyyy-MM-dd'),
			}),
			getClientCurrency(clientId),
		]);
		const sym = currencySymbol(currency);

		let response = `Here's a quick overview based on your data:\n\n`;
		response += `**Performance Summary (Last 14 days vs. Prior 14 days)**\n`;
		response += `- Impressions: ${comparison.current.totalImpressions.toLocaleString()} (${comparison.deltas.totalImpressions.percentage > 0 ? '+' : ''}${comparison.deltas.totalImpressions.percentage}%)\n`;
		response += `- Clicks: ${comparison.current.totalClicks.toLocaleString()} (${comparison.deltas.totalClicks.percentage > 0 ? '+' : ''}${comparison.deltas.totalClicks.percentage}%)\n`;
		response += `- Spend: ${sym}${comparison.current.totalSpend.toLocaleString()} (${comparison.deltas.totalSpend.percentage > 0 ? '+' : ''}${comparison.deltas.totalSpend.percentage}%)\n`;
		response += `- Conversions: ${comparison.current.totalConversions.toLocaleString()} (${comparison.deltas.totalConversions.percentage > 0 ? '+' : ''}${comparison.deltas.totalConversions.percentage}%)\n`;
		response += `\n${campaigns.length} active campaigns across ${new Set(campaigns.map((c) => c.platform)).size} platforms.\n`;
		response += `\n_Note: For full AI analysis, add an OpenRouter API key to your environment._`;
		responseText = response;
	} catch {
		responseText =
			"I'm running in basic mode (no API key configured). Please add OPENROUTER_API_KEY to your environment for full AI capabilities.";
	}

	await addMessage(sessionId, 'assistant', responseText, null);
	return NextResponse.json({ response: responseText, sessionId });
}
