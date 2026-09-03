// Builder Assistant — the assistant that turns plain English into widgets on
// one of the four grids AdPulse edits: a client's dashboard view, a client's
// report layout, the master dashboard template or the master report template
// (`context.gridKind`, see src/lib/builder/protocol.ts). All four hold the
// identical widget vocabulary, so the tool loop is the same one; the GRID KIND
// decides which widget types are offered (a cover block belongs to a report,
// never a dashboard) and how the prompt words itself.
//
// Separate from /api/chat: no persistence (no chat_sessions/chat_messages), a
// small build/edit tool loop instead of the analytics tool belt, and a
// named-event SSE protocol so the panel can tell prose apart from a created
// widget.
//
// SSE events emitted by this route:
//   event: delta   data: {"content":"…"}          assistant text
//   event: widget  data: {"config":…,"title":…}   a validated widget config
//   event: widget_update
//                  data: {"widgetId":…,…}         a rewrite of an existing one
//   event: widget_remove
//                  data: {"widgetId":…,"title":…} a widget taken off the view
//   event: widget_resize
//                  data: {"widgetId":…,"width":…} a footprint change, settings
//                                                 untouched
//   event: widget_arrange
//                  data: {"widgetIds":[…],…}      widgets put on one row
//   event: status  data: {"message":"…"}          what the route is doing now
//   event: error   data: {"message":"…"}          stream-level failure
//   event: done    data: {}                       always last
//
// A user message may carry images (`messages[].images`): public Blob URLs the
// panel uploaded through POST /api/assets first. They are handed to the model as
// image parts, so it can rebuild a chart from a screenshot or lay a dashboard
// out from a sketch — and an "image" widget may only ever carry one of them.
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
  builderWidgetTitle,
  builderWidgetTypesFor,
  isBuilderWidgetType,
  parseBuilderConfig,
  type BuilderWidgetType,
} from "@/lib/builder/widget-kinds";
import {
  GRID_COLS,
  MAX_ARRANGE_WIDGETS,
  WIDGET_HEIGHT_KEYS,
  WIDGET_SIZE_KEYS,
  type GridSurface,
  type WidgetHeightKey,
  type WidgetSizeKey,
} from "@/lib/dashboard/types";
import { buildBuilderSystemPrompt } from "@/lib/builder/prompt";
import {
  BUILDER_GRID_KINDS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENTS_PER_REQUEST,
  builderGridSurface,
  type BuilderGridKind,
  type BuilderWidgetArrangeEvent,
  type BuilderWidgetEvent,
  type BuilderWidgetRef,
  type BuilderWidgetRemoveEvent,
  type BuilderWidgetResizeEvent,
  type BuilderWidgetUpdateEvent,
} from "@/lib/builder/protocol";
import { isAdpulseUploadUrl } from "@/lib/uploads/image-constraints";

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
      z
        .object({
          role: z.enum(["user", "assistant"]),
          // Not `.min(1)`: a message may be images alone.
          content: z.string().max(4000),
          /**
           * Public Blob URLs from POST /api/assets. Every one is re-checked
           * below with `isAdpulseUploadUrl` — a URL on any other host would
           * otherwise make the model's fetcher pull an arbitrary address.
           */
          images: z.array(z.string().max(600)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
        })
        .refine((m) => m.content.trim().length > 0 || (m.images?.length ?? 0) > 0, {
          message: "a message needs text or at least one image",
        })
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES),
  context: z.object({
    /**
     * Which grid is open. Absent = a dashboard view, which is what the panel
     * sent before the report surfaces existed.
     */
    gridKind: z.enum(BUILDER_GRID_KINDS).default("dashboard-view"),
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
          /**
           * The widget's footprint on the desktop grid, so the model can be
           * asked to line widgets up. Untrusted like everything else here: it
           * only ever becomes prose in the prompt, and the store recomputes
           * every position from its own draft when the change is applied.
           */
          layout: z
            .object({
              x: z.number().int().min(0).max(GRID_COLS.lg),
              y: z.number().int().min(0).max(10_000),
              w: z.number().int().min(1).max(GRID_COLS.lg),
              h: z.number().int().min(1).max(200),
            })
            .optional(),
        })
      )
      .max(MAX_INVENTORY_WIDGETS)
      .optional(),
    /** Widget pinned in the panel — the default target for an unqualified edit. */
    targetWidgetId: z.string().max(64).nullish(),
  }),
});

type BuilderHistoryMessage = z.infer<typeof requestSchema>["messages"][number];

/** What a message with images but no words is taken to mean. */
const IMAGE_ONLY_INSTRUCTION = "Build what these images show.";

/**
 * The replayed thread as OpenRouter messages, with attached images as image
 * parts on the turn they were sent with.
 *
 * Images are kept newest-first up to a per-request budget: the panel replays the
 * whole thread every turn, so without a cap a conversation that started with a
 * dashboard screenshot would re-send it on every message after it. The dropped
 * ones are the oldest, which are also the least likely to be what the user is
 * talking about now. The kept list is what the prompt lists and what an `image`
 * widget may point at, so the model is never shown a URL it would be refused.
 */
function buildConversation(history: BuilderHistoryMessage[]): {
  messages: OpenRouterMessage[];
  images: string[];
} {
  const kept = new Set<string>();
  let budget = MAX_ATTACHMENTS_PER_REQUEST;
  for (let i = history.length - 1; i >= 0 && budget > 0; i--) {
    for (const url of history[i].images ?? []) {
      if (budget === 0) break;
      if (kept.has(url)) continue;
      kept.add(url);
      budget -= 1;
    }
  }

  const images: string[] = [];
  const messages = history.map<OpenRouterMessage>((m) => {
    const urls = (m.images ?? []).filter((url) => kept.has(url));
    if (m.role !== "user" || urls.length === 0) return { role: m.role, content: m.content };
    images.push(...urls);
    const text = m.content.trim() || IMAGE_ONLY_INSTRUCTION;
    return {
      role: "user",
      content: [
        { type: "text", text },
        ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    };
  });

  return { messages, images };
}

/** Shared by the widget tools: the width vocabulary the config dialog uses. */
const WIDTH_PARAMETER = {
  type: "string",
  enum: [...WIDGET_SIZE_KEYS],
  description: `Optional width, as a share of the ${GRID_COLS.lg}-column grid. Omit to keep the natural width of the widget type.`,
};

/** The height counterpart — grid rows, in the same named steps. */
const HEIGHT_PARAMETER = {
  type: "string",
  enum: [...WIDGET_HEIGHT_KEYS],
  description:
    "Optional height in grid rows, from compact (a stat tile) to extra-tall. Omit to keep the natural height of the widget type.",
};

/**
 * The tool belt, built for the grid being edited. Only two things vary: the
 * `type` enum of create_widget (a report block must not be offered on a
 * dashboard, and vice versa) and the noun the descriptions use — "widget" on a
 * dashboard, "block" on a report page.
 */
function toolDefinitions(surface: GridSurface) {
  const noun = surface === "report" ? "block" : "widget";
  const grid = surface === "report" ? "report" : "dashboard";
  return [
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
        description: `Create one ${grid} ${noun} and add it to the ${grid} the user is editing. Call once per ${noun} requested.`,
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: builderWidgetTypesFor(surface),
              description:
                'Widget type. Defaults to "custom", the chart builder — use a fixed type only when the system prompt says it fits better.',
            },
            config: {
              type: "object",
              description:
                "The widget config for that type. Must satisfy the schema and rules given in the system prompt.",
            },
            width: WIDTH_PARAMETER,
            height: HEIGHT_PARAMETER,
          },
          required: ["config"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "update_widget",
        description: `Replace the config of a ${noun} already on the ${grid}. \`widgetId\` must be an id from the inventory in the system prompt, and \`config\` is the COMPLETE new config, not a patch — for the type that ${noun} already is (an edit cannot change a ${noun}'s type).`,
        parameters: {
          type: "object",
          properties: {
            widgetId: {
              type: "string",
              description: `Id of the ${noun} to change, copied exactly from the inventory.`,
            },
            config: {
              type: "object",
              description:
                "The full replacement config for the widget's own type, under the same rules as create_widget.",
            },
            width: WIDTH_PARAMETER,
            height: HEIGHT_PARAMETER,
          },
          required: ["widgetId", "config"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "remove_widget",
        description: `Delete a ${noun} from the ${grid}. \`widgetId\` must be an id from the inventory in the system prompt — any ${noun} there, including ones whose settings are not editable.`,
        parameters: {
          type: "object",
          properties: {
            widgetId: {
              type: "string",
              description: `Id of the ${noun} to delete, copied exactly from the inventory.`,
            },
          },
          required: ["widgetId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "resize_widget",
        description: `Change only the SIZE of a ${noun} already on the ${grid}, leaving its settings untouched. Give \`width\`, \`height\`, or both — at least one. Use this for 'make it taller', 'make it full width', 'shrink that tile'; never resend a config or rebuild a ${noun} just to resize it. Works on any ${noun} in the inventory, including ones whose settings are not editable.`,
        parameters: {
          type: "object",
          properties: {
            widgetId: {
              type: "string",
              description: `Id of the ${noun} to resize, copied exactly from the inventory.`,
            },
            width: WIDTH_PARAMETER,
            height: HEIGHT_PARAMETER,
          },
          required: ["widgetId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "arrange_row",
        description: `Put ${noun}s side by side on ONE row, in the order given, left to right. Use this for 'side by side', 'same row', 'next to', 'line them up'. The row lands where the topmost of these ${noun}s already is and whatever was below it moves down; widths that add up to more than the ${GRID_COLS.lg} columns of a row are shrunk to fit, so call resize_widget first when the user wants particular proportions. Positions are never given as coordinates — the grid closes gaps upwards on its own.`,
        parameters: {
          type: "object",
          properties: {
            widgetIds: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: MAX_ARRANGE_WIDGETS,
              description: `Ids of the ${noun}s to place on the row, copied exactly from the inventory, in left-to-right order. Any ${noun} in the inventory may be moved.`,
            },
          },
          required: ["widgetIds"],
        },
      },
    },
  ];
}

/** Built once per surface — the inputs are constants. */
const TOOL_DEFINITIONS: Record<GridSurface, ReturnType<typeof toolDefinitions>> = {
  dashboard: toolDefinitions("dashboard"),
  report: toolDefinitions("report"),
};

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Multimodal user content: OpenRouter's OpenAI-shaped parts array. */
type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenRouterContentPart[] | null;
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
  surface: GridSurface,
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
        tools: TOOL_DEFINITIONS[surface],
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
  resize?: BuilderWidgetResizeEvent;
  arrange?: BuilderWidgetArrangeEvent;
};

/** An inventory entry the builder can actually rewrite: type checked, config parsed. */
type EditableWidgetRef = BuilderWidgetRef & {
  type: BuilderWidgetType;
  config: Record<string, unknown>;
};

/** Everything a tool needs beyond its own arguments. */
interface ToolScope {
  /**
   * The grid being edited, as a widget surface. Every config the model produces
   * is held to it, so a cover block cannot be built onto a dashboard even if the
   * model asks for one.
   */
  surface: GridSurface;
  /** From the membership-checked request, never from the model. */
  clientId: string;
  /** The page's active date range — what the campaign lookup ranks over. */
  startDate: string;
  endDate: string;
  /** Widgets the client declared editable AND the builder has a schema for. */
  editable: Map<string, EditableWidgetRef>;
  /** Every widget on the view, editable or not — for a useful refusal. */
  known: Map<string, BuilderWidgetRef>;
  /**
   * The only URLs an `image` widget may carry: the images attached to this
   * conversation, plus the ones already on the view (so "make the logo fill its
   * tile" is an edit rather than a refusal). The schema proves a URL is an
   * AdPulse upload; this proves it is one the user actually put in front of us.
   */
  imageUrls: Set<string>;
}

/**
 * The type the model asked to create. Absent or unknown falls back to the chart
 * builder, which is what almost every request wants — an unrecognised word must
 * not fail the call, and a wrong-shaped config is caught by the schema anyway.
 */
function readWidgetType(
  args: Record<string, unknown>,
  surface: GridSurface
): BuilderWidgetType {
  const raw = typeof args.type === "string" ? args.type : "custom";
  return isBuilderWidgetType(raw, surface) ? raw : "custom";
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
  args: Record<string, unknown>,
  surface: GridSurface
): { ok: true; event: BuilderWidgetEvent } | { ok: false; issues: string[] } {
  const parsed = parseBuilderConfig(type, args.config, surface);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const { width, height } = readSizeArgs(args);
  return {
    ok: true,
    // Same title rule the grid uses, so the card in the panel is never named
    // differently from the widget itself.
    event: {
      type,
      config: parsed.config,
      title: builderWidgetTitle(type, parsed.config),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    },
  };
}

/**
 * The size words off a tool call. An unrecognised word is dropped rather than
 * refused: the widget then keeps the natural size for its type, which is a
 * better answer than failing a call whose config is perfectly good.
 */
function readSizeArgs(args: Record<string, unknown>): {
  width?: WidgetSizeKey;
  height?: WidgetHeightKey;
} {
  const width = (WIDGET_SIZE_KEYS as readonly string[]).includes(String(args.width))
    ? (args.width as WidgetSizeKey)
    : undefined;
  const height = (WIDGET_HEIGHT_KEYS as readonly string[]).includes(String(args.height))
    ? (args.height as WidgetHeightKey)
    : undefined;
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

/**
 * An `image` widget's URL, checked against what this conversation offered. A
 * hallucinated (or copied-from-another-view) URL would render a picture the
 * user never chose, so it comes back as a fixable issue instead.
 */
function imageUrlIssues(event: BuilderWidgetEvent, scope: ToolScope): string[] | null {
  if (event.type !== "image") return null;
  const url = event.config.url;
  if (typeof url !== "string" || url.length === 0) {
    return [
      "config.url: an image widget needs the URL of an image attached to this conversation. Ask the user to attach one.",
    ];
  }
  if (!scope.imageUrls.has(url)) {
    return [
      `config.url: "${url}" is not an image attached to this conversation. Copy one of the attached image URLs exactly.`,
    ];
  }
  return null;
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
      const parsed = parseWidgetArgs(readWidgetType(args, scope.surface), args, scope.surface);
      if (!parsed.ok) return { result: { ok: false, issues: parsed.issues } };
      const badImage = imageUrlIssues(parsed.event, scope);
      if (badImage) return { result: { ok: false, issues: badImage } };
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
      const parsed = parseWidgetArgs(target.type, args, scope.surface);
      if (!parsed.ok) return { result: { ok: false, issues: parsed.issues } };
      const badImage = imageUrlIssues(parsed.event, scope);
      if (badImage) return { result: { ok: false, issues: badImage } };
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
    case "resize_widget": {
      // Like a removal, a resize does not depend on the config, so ANY widget
      // the client listed can be resized — including the ones update_widget
      // refuses because their settings are not ones the builder can rewrite.
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
      const { width, height } = readSizeArgs(args);
      if (!width && !height) {
        return {
          result: {
            ok: false,
            issues: [
              `resize_widget needs a "width" (${WIDGET_SIZE_KEYS.join(", ")}) or a "height" (${WIDGET_HEIGHT_KEYS.join(", ")}), or both.`,
            ],
          },
        };
      }
      const resize: BuilderWidgetResizeEvent = {
        widgetId,
        title: target.title,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      };
      return { result: { ok: true, ...resize }, resize };
    }
    case "arrange_row": {
      // Ids are de-duplicated but their ORDER is kept: it is the left-to-right
      // order of the row, and the only positional instruction the model gets to
      // give (see src/lib/dashboard/arrange.ts).
      const raw = Array.isArray(args.widgetIds) ? args.widgetIds : [];
      const seen = new Set<string>();
      const widgetIds: string[] = [];
      const unknown: string[] = [];
      for (const value of raw) {
        const id = typeof value === "string" ? value : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (scope.known.has(id)) widgetIds.push(id);
        else unknown.push(id);
      }
      if (unknown.length > 0) {
        return {
          result: {
            ok: false,
            issues: [
              `these ids are not on this view: ${unknown.map((id) => `"${id}"`).join(", ")}. Use ids from the inventory.`,
            ],
          },
        };
      }
      if (widgetIds.length < 2) {
        return {
          result: {
            ok: false,
            issues: [
              "arrange_row needs at least 2 different widget ids — a row of one widget is not a rearrangement.",
            ],
          },
        };
      }
      if (widgetIds.length > MAX_ARRANGE_WIDGETS) {
        return {
          result: {
            ok: false,
            issues: [
              `a row holds at most ${MAX_ARRANGE_WIDGETS} widgets. Split them across more than one arrange_row call.`,
            ],
          },
        };
      }
      const arrange: BuilderWidgetArrangeEvent = {
        widgetIds,
        titles: widgetIds.map((id) => scope.known.get(id)?.title ?? id),
      };
      return { result: { ok: true, ...arrange }, arrange };
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
  if (outcome.resize) {
    return JSON.stringify([
      "resize",
      outcome.resize.widgetId,
      outcome.resize.width,
      outcome.resize.height,
    ]);
  }
  // The row's ORDER is part of the key: asking for the same widgets in the other
  // order is a different row, not a repeat.
  if (outcome.arrange) return JSON.stringify(["arrange", outcome.arrange.widgetIds]);
  if (outcome.update) {
    return JSON.stringify([
      "update",
      outcome.update.widgetId,
      outcome.update.config,
      outcome.update.width,
      outcome.update.height,
    ]);
  }
  if (outcome.widget) {
    return JSON.stringify([
      "create",
      outcome.widget.type,
      outcome.widget.config,
      outcome.widget.width,
      outcome.widget.height,
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
    case "arrange_row":
      return "Rearranging the row…";
    case "update_widget":
    case "remove_widget":
    case "resize_widget": {
      const verb =
        name === "update_widget" ? "Updating" : name === "remove_widget" ? "Removing" : "Resizing";
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
  resize: (resize: BuilderWidgetResizeEvent) => void;
  arrange: (arrange: BuilderWidgetArrangeEvent) => void;
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
      response = await callOpenRouter(messages, apiKey, scope.surface);
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
        else if (outcome.resize) emit.resize(outcome.resize);
        else if (outcome.arrange) emit.arrange(outcome.arrange);
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

  // Attachment URLs are checked before any other work. An off-host URL is not a
  // typo — it is a caller trying to aim the model's fetcher somewhere else — so
  // it fails the request rather than being quietly dropped.
  if (history.some((m) => (m.images ?? []).some((url) => !isAdpulseUploadUrl(url)))) {
    return NextResponse.json(
      { error: "An attached image is not an AdPulse upload." },
      { status: 400 }
    );
  }

  // Membership first, then the agency check: a change here lands on a dashboard
  // view, a report layout or a master template, and every one of those PUTs is
  // agency-only. `clientId` is still required for a template — the editor
  // previews the template against one client, and that client's campaigns and
  // data facts are what the tools read.
  const access = await requireClientAccess(gate.ctx, clientId);
  if (!access.ok) return access.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  // The grid decides which widget types exist for this turn, so it is resolved
  // before anything is described to the model.
  const gridKind: BuilderGridKind = context.gridKind;
  const surface = builderGridSurface(gridKind);

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
    // The footprint rides along whatever the config turns out to be: a widget
    // whose settings cannot be rewritten can still be resized and moved.
    const rest = {
      i: w.i,
      title: w.title,
      type: w.type,
      ...(w.layout ? { layout: w.layout } : {}),
    };
    if (!isBuilderWidgetType(w.type, surface)) {
      return { ...rest, locked: w.locked ?? `the builder cannot configure a "${w.type}" widget` };
    }
    const parsed = parseBuilderConfig(w.type, w.config, surface);
    if (!parsed.ok) {
      return { ...rest, locked: "its current settings are not ones the builder can rewrite" };
    }
    const ref: EditableWidgetRef = { ...rest, type: w.type, config: parsed.config };
    editable.set(w.i, ref);
    return ref;
  });
  const known = new Map(inventory.map((w) => [w.i, w]));

  const { messages: replayed, images: attachments } = buildConversation(history);

  const systemPrompt = buildBuilderSystemPrompt({
    gridKind,
    clientName,
    currency: context.currency || currency,
    startDate: context.startDate,
    endDate: context.endDate,
    platforms: context.platforms ?? [],
    facts,
    viewName: context.viewName,
    widgets: inventory,
    ...(context.targetWidgetId ? { targetWidgetId: context.targetWidgetId } : {}),
    attachments,
  });

  // An image already on the view stays usable (alt text, fit) even once the
  // message that uploaded it has aged out of the replayed thread.
  const imageUrls = new Set(attachments);
  for (const w of inventory) {
    const url = w.config?.url;
    if (w.type === "image" && typeof url === "string") imageUrls.add(url);
  }

  const conversation: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...replayed,
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
          {
            surface,
            clientId,
            startDate: context.startDate,
            endDate: context.endDate,
            editable,
            known,
            imageUrls,
          },
          {
            widget: (widget) => send("widget", widget),
            update: (update) => send("widget_update", update),
            remove: (remove) => send("widget_remove", remove),
            resize: (resize) => send("widget_resize", resize),
            arrange: (arrange) => send("widget_arrange", arrange),
            status: (message) => send("status", { message }),
          }
        );

        // Final pass writes the short reply. Tools are disabled here so the
        // answer cannot create a duplicate of a widget already emitted above.
        send("status", { message: "Writing the answer…" });
        let streamResponse: Response;
        try {
          streamResponse = await callOpenRouter(resolved, apiKey, surface, {
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
