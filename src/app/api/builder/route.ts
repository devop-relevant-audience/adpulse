// Builder Assistant — a dashboard-only assistant that turns plain English into
// "custom" chart-builder widgets. Separate from /api/chat: no persistence (no
// chat_sessions/chat_messages), a small build/edit tool loop instead of the
// analytics tool belt, and a named-event SSE protocol so the panel can tell
// prose apart from a created widget (see src/lib/builder/protocol.ts).
//
// SSE events emitted by this route:
//   event: delta   data: {"content":"…"}          assistant text
//   event: widget  data: {"config":…,"title":…}   a validated widget config
//   event: widget_update
//                  data: {"widgetId":…,…}         a rewrite of an existing one
//   event: widget_remove
//                  data: {"widgetId":…,"title":…} a widget taken off the view
//   event: status  data: {"message":"…"}          what the route is doing now
//   event: error   data: {"message":"…"}          stream-level failure
//   event: done    data: {}                       always last
//
// Provider wiring is copied from the chat route on purpose: OpenRouter over raw
// fetch, a manual tool-calling loop, no AI SDK.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import { logger } from "@/lib/log";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import {
  getClientCurrency,
  getClientDataFacts,
  getClients,
  listCampaignsBySpend,
} from "@/lib/data/queries";
import { PLATFORMS, type Platform } from "@/lib/types/database";
import {
  BUILDER_WIDGET_TYPES,
  builderWidgetTitle,
  isBuilderWidgetType,
  parseBuilderConfig,
  type BuilderWidgetType,
} from "@/lib/builder/widget-kinds";
import { WIDGET_SIZE_KEYS, type WidgetSizeKey } from "@/lib/dashboard/types";
import { buildBuilderSystemPrompt } from "@/lib/builder/prompt";
import type {
  BuilderWidgetEvent,
  BuilderWidgetRef,
  BuilderWidgetRemoveEvent,
  BuilderWidgetUpdateEvent,
} from "@/lib/builder/protocol";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";

const OPENROUTER_TIMEOUT_MS = 30_000;
/** Tool-calling rounds before the final answer is streamed. */
const MAX_TOOL_ITERATIONS = 5;
/** Conversation turns replayed from the client (nothing is stored server-side). */
const MAX_HISTORY_MESSAGES = 24;
/** Top campaigns by spend handed to the model for name -> id resolution and ranking. */
const MAX_CAMPAIGNS_RETURNED = 50;
/** Widgets of the open view described to the model as edit targets. */
const MAX_INVENTORY_WIDGETS = 40;

// SSE + a bounded tool loop, on the Node runtime because the tools hit Drizzle.
export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  clientId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES),
  context: z.object({
    dashboardId: z.string().uuid().nullish(),
    viewName: z.string().max(120).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    platforms: z.array(z.enum(PLATFORMS)).optional(),
    currency: z.string().max(8).optional(),
    /**
     * The widgets on the view as the user currently sees them (draft included),
     * which is why they come from the client rather than being re-read here.
     * Nothing is trusted: the id only ever selects a target the client already
     * declared editable, the config is re-checked against that type's builder
     * schema before it is shown as an edit target, and the config the model
     * sends back goes through the same schema a fresh widget does.
     */
    widgets: z
      .array(
        z.object({
          i: z.string().min(1).max(64),
          title: z.string().max(160),
          type: z.string().max(40),
          config: z.record(z.string(), z.unknown()).optional(),
          locked: z.string().max(160).optional(),
        })
      )
      .max(MAX_INVENTORY_WIDGETS)
      .optional(),
    /** Widget pinned in the panel — the default target for an unqualified edit. */
    targetWidgetId: z.string().max(64).nullish(),
  }),
});

/** Shared by both widget tools: the width vocabulary the config dialog uses. */
const SIZE_PARAMETER = {
  type: "string",
  enum: [...WIDGET_SIZE_KEYS],
  description:
    "Optional width on the 12-column grid. Omit to use the natural width of the chart type.",
};

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_campaigns",
      description:
        "The current client's top campaigns by spend in the active date range (id, name, platform, spend). Call this before putting campaign ids in config.filters.campaignIds — campaign ids can never be guessed — and use the spend figures to answer questions about the biggest or top-spending campaigns.",
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: [...PLATFORMS],
            description: "Optional platform filter.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_widget",
      description:
        "Create one dashboard widget and add it to the user's dashboard. Call once per widget requested.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [...BUILDER_WIDGET_TYPES],
            description:
              'Widget type. Defaults to "custom", the chart builder — use a fixed type only when the system prompt says it fits better.',
          },
          config: {
            type: "object",
            description:
              "The widget config for that type. Must satisfy the schema and rules given in the system prompt.",
          },
          size: SIZE_PARAMETER,
        },
        required: ["config"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_widget",
      description:
        "Replace the config of a widget already on the dashboard. `widgetId` must be an id from the inventory in the system prompt, and `config` is the COMPLETE new config, not a patch — for the type that widget already is (an edit cannot change a widget's type).",
      parameters: {
        type: "object",
        properties: {
          widgetId: {
            type: "string",
            description: "Id of the widget to change, copied exactly from the inventory.",
          },
          config: {
            type: "object",
            description:
              "The full replacement config for the widget's own type, under the same rules as create_widget.",
          },
          size: SIZE_PARAMETER,
        },
        required: ["widgetId", "config"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remove_widget",
      description:
        "Delete a widget from the dashboard. `widgetId` must be an id from the inventory in the system prompt — any widget there, including ones marked NOT editable.",
      parameters: {
        type: "object",
        properties: {
          widgetId: {
            type: "string",
            description: "Id of the widget to delete, copied exactly from the inventory.",
          },
        },
        required: ["widgetId"],
      },
    },
  },
];

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface CallOptions {
  stream?: boolean;
  /** "none" on the final pass so the answer can't create a second copy. */
  toolChoice?: "auto" | "none";
}

async function callOpenRouter(
  messages: OpenRouterMessage[],
  apiKey: string,
  { stream = false, toolChoice = "auto" }: CallOptions = {}
): Promise<Response> {
  // Same shape as the chat route: the abort timer bounds connect/generation and
  // is cleared before the caller reads a streamed body, so the stream itself is
  // never aborted mid-flight.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    return await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://adpulse.app",
        "X-Title": "AdPulse Builder",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: toolChoice,
        stream,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

type ToolOutcome = {
  result: unknown;
  widget?: BuilderWidgetEvent;
  update?: BuilderWidgetUpdateEvent;
  remove?: BuilderWidgetRemoveEvent;
};

/** An inventory entry the builder can actually rewrite: type checked, config parsed. */
type EditableWidgetRef = BuilderWidgetRef & {
  type: BuilderWidgetType;
  config: Record<string, unknown>;
};

/** Everything a tool needs beyond its own arguments. */
interface ToolScope {
  /** From the membership-checked request, never from the model. */
  clientId: string;
  /** The page's active date range — what the campaign lookup ranks over. */
  startDate: string;
  endDate: string;
  /** Widgets the client declared editable AND the builder has a schema for. */
  editable: Map<string, EditableWidgetRef>;
  /** Every widget on the view, editable or not — for a useful refusal. */
  known: Map<string, BuilderWidgetRef>;
}

/**
 * The type the model asked to create. Absent or unknown falls back to the chart
 * builder, which is what almost every request wants — an unrecognised word must
 * not fail the call, and a wrong-shaped config is caught by the schema anyway.
 */
function readWidgetType(args: Record<string, unknown>): BuilderWidgetType {
  const raw = typeof args.type === "string" ? args.type : "custom";
  return isBuilderWidgetType(raw) ? raw : "custom";
}

/**
 * The RAW config is held to that type's strict builder schema: anything
 * accepted here also passes the dashboards PUT, and anything else comes back as
 * issues the model can fix. Repairing it first (normalizeCustomConfig and
 * friends) would silently hand back a different widget — "spend by campaign as
 * a single number" would become an ungrouped total with no word said.
 */
function parseWidgetArgs(
  type: BuilderWidgetType,
  args: Record<string, unknown>
): { ok: true; event: BuilderWidgetEvent } | { ok: false; issues: string[] } {
  const parsed = parseBuilderConfig(type, args.config);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const size = (WIDGET_SIZE_KEYS as readonly string[]).includes(String(args.size))
    ? (args.size as WidgetSizeKey)
    : undefined;
  return {
    ok: true,
    // Same title rule the grid uses, so the card in the panel is never named
    // differently from the widget itself.
    event: {
      type,
      config: parsed.config,
      title: builderWidgetTitle(type, parsed.config),
      ...(size ? { size } : {}),
    },
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  scope: ToolScope
): Promise<ToolOutcome> {
  switch (name) {
    case "list_campaigns": {
      const platform = (PLATFORMS as readonly string[]).includes(String(args.platform))
        ? (args.platform as Platform)
        : undefined;
      const campaigns = await listCampaignsBySpend({
        clientId: scope.clientId,
        startDate: scope.startDate,
        endDate: scope.endDate,
        platform,
        limit: MAX_CAMPAIGNS_RETURNED,
      });
      return {
        result: campaigns.map((c) => ({
          id: c.campaign_id,
          name: c.campaign_name,
          platform: c.platform,
          spend: c.spend,
        })),
      };
    }
    case "create_widget": {
      const parsed = parseWidgetArgs(readWidgetType(args), args);
      if (!parsed.ok) return { result: { ok: false, issues: parsed.issues } };
      return {
        // Echoed back so the model can name the widget it just built.
        result: { ok: true, ...parsed.event },
        widget: parsed.event,
      };
    }
    case "update_widget": {
      // A target the client did not offer is refused rather than emitted: the
      // panel would have nothing to apply it to, and a hallucinated id must not
      // read as a successful edit.
      const widgetId = typeof args.widgetId === "string" ? args.widgetId : "";
      const target = scope.editable.get(widgetId);
      if (!target) {
        const other = scope.known.get(widgetId);
        return {
          result: {
            ok: false,
            issues: [
              other
                ? `widgetId "${widgetId}" is on the view but cannot be edited here (${other.locked ?? `type "${other.type}"`}).`
                : `widgetId "${widgetId}" is not on this view. Use an id from the inventory, or create a new widget.`,
            ],
          },
        };
      }
      // An edit changes settings, not kind: the config is validated against the
      // type the widget ALREADY is, whatever the model may have passed.
      const parsed = parseWidgetArgs(target.type, args);
      if (!parsed.ok) return { result: { ok: false, issues: parsed.issues } };
      const update: BuilderWidgetUpdateEvent = { widgetId, ...parsed.event };
      return { result: { ok: true, ...update }, update };
    }
    case "remove_widget": {
      // Deleting a widget does not depend on its config, so ANY widget the
      // client listed can go — including the ones update_widget refuses. An id
      // that is not on the view is still refused: the panel would have nothing
      // to delete, and the model must not report a removal that never happened.
      const widgetId = typeof args.widgetId === "string" ? args.widgetId : "";
      const target = scope.known.get(widgetId);
      if (!target) {
        return {
          result: {
            ok: false,
            issues: [
              `widgetId "${widgetId}" is not on this view. Use an id from the inventory.`,
            ],
          },
        };
      }
      const remove: BuilderWidgetRemoveEvent = { widgetId, title: target.title };
      return { result: { ok: true, ...remove }, remove };
    }
    default:
      return { result: { ok: false, issues: [`Unknown tool: ${name}`] } };
  }
}

/**
 * Identity of the change a tool call produced, or null when it changed nothing
 * (a lookup, or a refusal). Tools stay enabled for every round, so a model that
 * re-issues the same call would otherwise have the panel apply — and save — the
 * same change twice. The kind is part of the key so a create and an edit that
 * happen to share a config are still two different changes.
 */
function outcomeKey(outcome: ToolOutcome): string | null {
  if (outcome.remove) return JSON.stringify(["remove", outcome.remove.widgetId]);
  if (outcome.update) {
    return JSON.stringify([
      "update",
      outcome.update.widgetId,
      outcome.update.config,
      outcome.update.size,
    ]);
  }
  if (outcome.widget) {
    return JSON.stringify([
      "create",
      outcome.widget.type,
      outcome.widget.config,
      outcome.widget.size,
    ]);
  }
  return null;
}

/** The status line for a tool that is about to run, named after its target. */
function toolStatus(
  name: string,
  args: Record<string, unknown>,
  scope: ToolScope
): string | null {
  switch (name) {
    case "list_campaigns":
      return "Looking up campaigns…";
    case "create_widget":
      return "Building the widget…";
    case "update_widget":
    case "remove_widget": {
      const verb = name === "update_widget" ? "Updating" : "Removing";
      const title = scope.known.get(String(args.widgetId))?.title;
      return title ? `${verb} “${title}”…` : `${verb} the widget…`;
    }
    default:
      return null;
  }
}

/** What the loop reports back to the panel as it works. */
interface ToolLoopEmitters {
  widget: (widget: BuilderWidgetEvent) => void;
  update: (update: BuilderWidgetUpdateEvent) => void;
  remove: (remove: BuilderWidgetRemoveEvent) => void;
  status: (message: string) => void;
}

/**
 * Runs the tool-calling loop until the model stops asking for tools (or the cap
 * is hit), emitting a widget event for every successful create_widget. Returns
 * the message list to generate the final answer from.
 */
async function resolveToolCalls(
  messages: OpenRouterMessage[],
  apiKey: string,
  scope: ToolScope,
  emit: ToolLoopEmitters
): Promise<OpenRouterMessage[]> {
  // Changes already applied this turn, keyed by outcomeKey.
  const emitted = new Set<string>();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // The first round can take the whole OpenRouter timeout before anything
    // reaches the panel, so say so rather than leaving it blank.
    if (i === 0) emit.status("Thinking…");
    let response: Response;
    try {
      response = await callOpenRouter(messages, apiKey);
    } catch (error) {
      logger.error("OpenRouter tool-resolution request failed", error, { route: "builder.POST" });
      break;
    }
    if (!response.ok) {
      logger.error("OpenRouter tool-resolution error", undefined, {
        route: "builder.POST",
        detail: await response.text(),
      });
      break;
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message as
      | { content: string | null; tool_calls?: OpenRouterToolCall[] }
      | undefined;
    if (!assistantMessage) break;
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(toolCall.function.arguments || "{}");
        args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch (error) {
        // Malformed tool arguments are fed back as the tool result so the model
        // can retry, exactly as the chat route does.
        logger.error("Failed to parse tool-call arguments", error, {
          route: "builder.POST",
          tool: toolCall.function.name,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ok: false, issues: ["could not parse tool arguments as JSON"] }),
        });
        continue;
      }

      const status = toolStatus(toolCall.function.name, args, scope);
      if (status) emit.status(status);

      const outcome = await executeTool(toolCall.function.name, args, scope);
      const key = outcomeKey(outcome);
      if (key) {
        if (emitted.has(key)) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: true, duplicate: true, note: "already applied" }),
          });
          continue;
        }
        emitted.add(key);
        if (outcome.remove) emit.remove(outcome.remove);
        else if (outcome.update) emit.update(outcome.update);
        else if (outcome.widget) emit.widget(outcome.widget);
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(outcome.result),
      });
    }
  }

  return messages;
}

export const POST = withRoute("builder.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Throttle per user (IP fallback) before any OpenRouter or DB work. Fails
  // open when Upstash isn't configured.
  const rl = await checkRateLimit(gate.ctx.userId || getClientIp(request), {
    prefix: "builder",
    limit: 20,
    windowSeconds: 60,
  });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clientId, messages: history, context } = parsed.data;

  // Membership first, then the agency check: creating a widget is a dashboard
  // write, and dashboards PUT is agency-only.
  const access = await requireClientAccess(gate.ctx, clientId);
  if (!access.ok) return access.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Builder Assistant needs the AI key configured (OPENROUTER_API_KEY)." },
      { status: 503 }
    );
  }

  const [clients, currency, facts] = await Promise.all([
    getClients(),
    getClientCurrency(clientId),
    getClientDataFacts({
      clientId,
      startDate: context.startDate,
      endDate: context.endDate,
    }),
  ]);
  const clientName = clients.find((c) => c.id === clientId)?.name ?? "this client";

  // The inventory the model is shown and the set of ids update_widget accepts
  // are built from the SAME list, so it can never be told about a target it is
  // then refused, or accept one it was never told about. The client offers a
  // widget as editable; the builder schemas have the final say, and a widget
  // they cannot parse is demoted to read-only WITH a reason rather than
  // silently accepted and then refused mid-turn.
  const editable = new Map<string, EditableWidgetRef>();
  const inventory: BuilderWidgetRef[] = (context.widgets ?? []).map((w) => {
    if (!w.config) return w;
    const rest = { i: w.i, title: w.title, type: w.type };
    if (!isBuilderWidgetType(w.type)) {
      return { ...rest, locked: w.locked ?? `the builder cannot configure a "${w.type}" widget` };
    }
    const parsed = parseBuilderConfig(w.type, w.config);
    if (!parsed.ok) {
      return { ...rest, locked: "its current settings are not ones the builder can rewrite" };
    }
    const ref: EditableWidgetRef = { ...rest, type: w.type, config: parsed.config };
    editable.set(w.i, ref);
    return ref;
  });
  const known = new Map(inventory.map((w) => [w.i, w]));

  const systemPrompt = buildBuilderSystemPrompt({
    clientName,
    currency: context.currency || currency,
    startDate: context.startDate,
    endDate: context.endDate,
    platforms: context.platforms ?? [],
    facts,
    viewName: context.viewName,
    widgets: inventory,
    ...(context.targetWidgetId ? { targetWidgetId: context.targetWidgetId } : {}),
  });

  const conversation: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // The panel's Stop button aborts the request, which cancels this stream —
      // every later enqueue then throws. Swallow that so the `finally` below
      // can't turn a routine cancel into an unhandled rejection.
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const resolved = await resolveToolCalls(
          conversation,
          apiKey,
          { clientId, startDate: context.startDate, endDate: context.endDate, editable, known },
          {
            widget: (widget) => send("widget", widget),
            update: (update) => send("widget_update", update),
            remove: (remove) => send("widget_remove", remove),
            status: (message) => send("status", { message }),
          }
        );

        // Final pass writes the short reply. Tools are disabled here so the
        // answer cannot create a duplicate of a widget already emitted above.
        send("status", { message: "Writing the answer…" });
        let streamResponse: Response;
        try {
          streamResponse = await callOpenRouter(resolved, apiKey, {
            stream: true,
            toolChoice: "none",
          });
        } catch (error) {
          logger.error("OpenRouter streaming request failed", error, { route: "builder.POST" });
          send("error", { message: "The assistant is unavailable right now. Please try again." });
          return;
        }

        if (!streamResponse.ok) {
          logger.error("OpenRouter streaming error", undefined, {
            route: "builder.POST",
            detail: await streamResponse.text(),
          });
          send("error", { message: "The assistant is unavailable right now. Please try again." });
          return;
        }

        const reader = streamResponse.body?.getReader();
        if (!reader) {
          send("error", { message: "The assistant returned an empty response." });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload);
              const content: unknown = chunk.choices?.[0]?.delta?.content;
              if (typeof content === "string" && content.length > 0) {
                send("delta", { content });
              }
            } catch {
              // Skip malformed chunks.
            }
          }
        }
      } catch (error) {
        logger.error("Builder stream processing error", error, { route: "builder.POST" });
        send("error", { message: "Something went wrong while building. Please try again." });
      } finally {
        send("done", {});
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already cancelled by the client.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
