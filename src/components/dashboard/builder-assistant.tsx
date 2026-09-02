"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LuSparkles } from "react-icons/lu";
import {
  BiCheck,
  BiEdit,
  BiError,
  BiPlus,
  BiSend,
  BiSquare,
  BiTrash,
  BiUndo,
  BiX,
} from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import {
  describeBuilderConfig,
  type BuilderWidgetType,
} from "@/lib/builder/widget-kinds";
import type { WidgetSizeKey } from "@/lib/dashboard/types";
import type {
  BuilderStatusEvent,
  BuilderWidgetEvent,
  BuilderWidgetRef,
  BuilderWidgetRemoveEvent,
  BuilderWidgetUpdateEvent,
} from "@/lib/builder/protocol";

/** How a created, edited or removed widget ended up on the dashboard. */
export type BuilderInsertResult = "saved" | "draft" | "failed";

/** One applied change, with the way back if there is one. */
export interface BuilderApplyResult {
  state: BuilderInsertResult;
  /**
   * Reverts exactly this change through the same persistence path. Absent when
   * the change never landed, so there is nothing to take back.
   */
  undo?: () => Promise<BuilderInsertResult>;
}

/** Thread items replayed to the route, which accepts at most 24 messages. */
const MAX_REPLAYED_ITEMS = 20;

/** Mirrors the system prompt's worked examples, so a chip always lands. */
const SUGGESTIONS = [
  "Total spend this period",
  "Spend share by platform",
  "Clicks and conversions by day",
  "Top 10 campaigns by spend",
];

/** Shown instead once a widget is pinned — every one is a change to that widget. */
const EDIT_SUGGESTIONS = [
  "Make it a donut chart",
  "Break it down by campaign",
  "Add conversions and CPA",
  "Make it full width",
];

type ThreadItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "widget";
      id: string;
      /**
       * "create" added a widget, "update" rewrote one already on the grid,
       * "remove" took one off it.
       */
      mode: "create" | "update" | "remove";
      title: string;
      /** Absent for a removal — the widget is gone, only its name is left. */
      type?: BuilderWidgetType;
      config?: Record<string, unknown>;
      state: "pending" | BuilderInsertResult;
      /** Reverts this card's change; absent once it has been used. */
      undo?: () => Promise<BuilderInsertResult>;
      /** How the undo went. Set = the card is spent and offers no second one. */
      undone?: BuilderInsertResult;
      undoing?: boolean;
    };

interface BuilderAssistantProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string | null;
  dashboardId?: string | null;
  /**
   * The open view, keyed the way the dashboard keys its own Builder scope: the
   * selection, not the saved row's id, which is null until the view is first
   * saved (a Builder save would otherwise look like a view switch).
   */
  viewId: string | null;
  viewName?: string;
  /** Widgets on the open view, so the assistant can be asked to change one. */
  widgets: BuilderWidgetRef[];
  /** Widget pinned via "Edit with AI"; unqualified edits refer to it. */
  targetWidgetId: string | null;
  onTargetChange: (i: string | null) => void;
  /** Inserts a validated config into the current view and reports how it persisted. */
  onCreateWidget: (
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: WidgetSizeKey
  ) => Promise<BuilderApplyResult>;
  /** Replaces an existing widget's config, same persistence rules as a create. */
  onUpdateWidget: (
    widgetId: string,
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: WidgetSizeKey
  ) => Promise<BuilderApplyResult>;
  /** Takes a widget off the view, same persistence rules as a create. */
  onRemoveWidget: (widgetId: string) => Promise<BuilderApplyResult>;
}

/** How a widget card reads back to the model on the next turn. */
function replayWidget(item: Extract<ThreadItem, { kind: "widget" }>): string {
  // An undone change must not be replayed as if it stood — the model would go
  // on editing a widget that is no longer there (or that never arrived).
  const undone = item.undone && item.undone !== "failed" ? " (the user undid this)" : "";
  if (item.mode === "remove") return `Removed widget: ${item.title}${undone}`;
  const verb = item.mode === "update" ? "Updated" : "Created";
  return `${verb} widget (type "${item.type}"): ${JSON.stringify(item.config)}${undone}`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function BuilderAssistant({
  open,
  onOpenChange,
  clientId,
  dashboardId,
  viewId,
  viewName,
  widgets,
  targetWidgetId,
  onTargetChange,
  onCreateWidget,
  onUpdateWidget,
  onRemoveWidget,
}: BuilderAssistantProps) {
  const dateRange = useAppStore((s) => s.dateRange);
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);

  const [items, setItems] = useState<ThreadItem[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  // What the route says it is doing. Shown only until the answer starts, so it
  // never competes with the text.
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, streamingText]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // A thread is about one client's data AND one view's widgets — the inventory
  // it was answering about, the cards it reports and any pinned target all
  // belong to the view that was open — so switching either starts over. Done
  // during render (React's "adjusting state on prop change") rather than in an
  // effect, which would cascade an extra render. This is also what keeps a card
  // left mid-flight by the cancel below from sitting on "Adding…" forever: it
  // goes with the thread rather than claiming work that was stopped.
  const threadKey = `${clientId ?? ""}:${viewId ?? "default"}`;
  const [threadScope, setThreadScope] = useState(threadKey);
  if (threadKey !== threadScope) {
    setThreadScope(threadKey);
    setItems([]);
    setStreamingText("");
    setStatus(null);
    setIsStreaming(false);
    setError(null);
  }

  // "New chat" drops the conversation only. Widgets already built stay on the
  // dashboard — they were inserted (and usually saved) as they arrived, so
  // clearing the thread is forgetting the context, not an undo.
  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setItems([]);
    setInput("");
    setStreamingText("");
    setStatus(null);
    setIsStreaming(false);
    setError(null);
    onTargetChange(null);
    inputRef.current?.focus();
  }, [onTargetChange]);

  // Cancels the in-flight stream when the client or the view changes, or the
  // panel unmounts, so a late response can't land in a thread — or on a view —
  // it no longer belongs to.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [clientId, viewId]
  );

  const patchWidget = useCallback(
    (id: string, patch: Partial<Extract<ThreadItem, { kind: "widget" }>>) => {
      setItems((prev) =>
        prev.map((it) => (it.kind === "widget" && it.id === id ? { ...it, ...patch } : it))
      );
    },
    []
  );

  // Undo goes through the same persistence path as the change it reverts, so in
  // view mode it saves immediately and inside an open edit it joins the draft.
  // A target that is no longer there comes back "failed" rather than throwing.
  const handleUndo = useCallback(
    async (id: string) => {
      const item = items.find((it) => it.kind === "widget" && it.id === id);
      if (!item || item.kind !== "widget" || !item.undo || item.undone || item.undoing) return;
      patchWidget(id, { undoing: true });
      const state = await item.undo();
      patchWidget(id, { undoing: false, undone: state });
    },
    [items, patchWidget]
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || isStreaming || !clientId) return;

      // Widget cards replay as assistant turns carrying the config that was
      // built, so a follow-up ("make that a bar chart") has something to edit.
      // Trimmed to the tail: the route caps the replayed turns, and nothing is
      // persisted, so an old part of the thread is not worth a 400.
      const history = [
        ...items
          .slice(-MAX_REPLAYED_ITEMS)
          .map((it) =>
            it.kind === "widget"
              ? { role: "assistant" as const, content: replayWidget(it) }
              : { role: it.kind, content: it.text }
          ),
        { role: "user" as const, content: message },
      ];

      setItems((prev) => [...prev, { kind: "user", id: newId(), text: message }]);
      setInput("");
      setError(null);
      setStreamingText("");
      setStatus(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/builder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            messages: history,
            context: {
              dashboardId: dashboardId ?? null,
              viewName,
              startDate: dateRange.start,
              endDate: dateRange.end,
              platforms: selectedPlatform ? [selectedPlatform] : [],
              // The view as it stands right now, so an edit rewrites what the
              // user is actually looking at rather than a stale snapshot.
              widgets,
              targetWidgetId,
            },
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          setError(
            typeof payload.error === "string"
              ? payload.error
              : "The Builder Assistant is unavailable right now."
          );
          return;
        }

        // Named-event SSE (see src/lib/builder/protocol.ts): frames are split on
        // a blank line, and a frame's `data:` lines are concatenated.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            // A cancel lands between reads, so the frames already decoded into
            // this batch would otherwise keep being applied after it.
            if (controller.signal.aborted) return;
            let event = "";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!event || !data) continue;

            let payload: unknown;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }

            if (event === "delta") {
              const content = (payload as { content?: unknown }).content;
              if (typeof content === "string") {
                assistantText += content;
                setStreamingText(assistantText);
              }
            } else if (event === "widget_remove") {
              const removal = payload as BuilderWidgetRemoveEvent;
              const id = newId();
              setItems((prev) => [
                ...prev,
                { kind: "widget", id, mode: "remove", title: removal.title, state: "pending" },
              ]);
              const applied = await onRemoveWidget(removal.widgetId);
              patchWidget(id, { state: applied.state, undo: applied.undo });
            } else if (event === "widget" || event === "widget_update") {
              const update =
                event === "widget_update" ? (payload as BuilderWidgetUpdateEvent) : null;
              const widget = payload as BuilderWidgetEvent;
              const id = newId();
              setItems((prev) => [
                ...prev,
                {
                  kind: "widget",
                  id,
                  mode: update ? "update" : "create",
                  title: widget.title,
                  type: widget.type,
                  config: widget.config,
                  state: "pending",
                },
              ]);
              // Awaited inline so several widgets in one turn are applied (and
              // saved) one after another instead of racing the same base view.
              const applied = update
                ? await onUpdateWidget(update.widgetId, update.type, update.config, update.size)
                : await onCreateWidget(widget.type, widget.config, widget.size);
              patchWidget(id, { state: applied.state, undo: applied.undo });
            } else if (event === "status") {
              const message = (payload as BuilderStatusEvent).message;
              if (typeof message === "string") setStatus(message);
            } else if (event === "error") {
              const message = (payload as { message?: unknown }).message;
              setError(typeof message === "string" ? message : "Something went wrong.");
            }
          }
        }

        if (assistantText.trim().length > 0) {
          setItems((prev) => [...prev, { kind: "assistant", id: newId(), text: assistantText }]);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Something went wrong. Please try again.");
      } finally {
        // A cancelled turn no longer owns the panel — the client/view switch
        // already reset it, and a newer turn may have started — so only the
        // turn still holding the controller clears the streaming state.
        if (abortRef.current === controller) {
          setIsStreaming(false);
          setStreamingText("");
          setStatus(null);
          abortRef.current = null;
        }
      }
    },
    [
      clientId,
      dashboardId,
      dateRange.end,
      dateRange.start,
      isStreaming,
      items,
      onCreateWidget,
      onRemoveWidget,
      onUpdateWidget,
      patchWidget,
      selectedPlatform,
      targetWidgetId,
      viewName,
      widgets,
    ]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const isEmpty = items.length === 0 && !streamingText;
  const target = targetWidgetId ? widgets.find((w) => w.i === targetWidgetId) : undefined;

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 bottom-0 w-[420px] max-w-full bg-white border-l border-hairline flex flex-col z-40",
        "transition-transform duration-300 ease-in-out shadow-(--shadow-elevated)",
        open ? "translate-x-0" : "translate-x-full"
      )}
      aria-label="Builder Assistant"
      inert={!open ? true : undefined}
    >
      <div className="flex items-start justify-between gap-3 px-5 h-14 border-b border-hairline shrink-0 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <LuSparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-[13px] text-ink leading-tight">Builder Assistant</h2>
            <p className="text-[11px] text-ink-muted truncate">
              Describe a widget to build or change
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[12px] text-ink-muted hover:text-ink"
            onClick={startNewChat}
            disabled={isEmpty && !isStreaming && !targetWidgetId}
            title="Clear the conversation and start over"
          >
            <BiPlus className="w-3.5 h-3.5" /> New chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-ink-muted hover:text-ink"
            onClick={() => onOpenChange(false)}
            aria-label="Close Builder Assistant"
          >
            <BiX className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center mb-4">
              <LuSparkles className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-ink mb-1">
              {target ? "Change this widget in words" : "Build a widget in words"}
            </p>
            <p className="text-[12px] text-ink-muted max-w-[260px] leading-relaxed mb-5">
              {target ? (
                <>
                  Say what should change about{" "}
                  <span className="text-ink font-medium">{target.title}</span>.
                </>
              ) : (
                <>
                  Name the metric and how you want it split. The widget is added to{" "}
                  {viewName ? `“${viewName}”` : "this view"}.
                </>
              )}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[320px]">
              {(target ? EDIT_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={!clientId || isStreaming}
                  className="text-left px-3.5 py-2.5 rounded-lg border border-hairline bg-white hover:bg-primary/5 hover:border-primary/30 text-[12px] text-ink-muted hover:text-ink transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) =>
              item.kind === "widget" ? (
                <WidgetCard key={item.id} item={item} onUndo={handleUndo} />
              ) : (
                <div
                  key={item.id}
                  className={cn("flex", item.kind === "user" && "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                      item.kind === "user"
                        ? "bg-primary text-white whitespace-pre-wrap"
                        : "bg-[#f4f4f5] text-ink"
                    )}
                  >
                    {item.kind === "user" ? (
                      item.text
                    ) : (
                      <div className="prose-chat">
                        <ReactMarkdown>{item.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {streamingText && (
              <div className="flex">
                <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed bg-[#f4f4f5] text-ink">
                  <div className="prose-chat">
                    <ReactMarkdown>{streamingText}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {isStreaming && !streamingText && (
              <p className="text-[12px] text-ink-muted">{status ?? "Working…"}</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[12px] text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-hairline p-3 shrink-0">
        {target && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5">
            <BiEdit className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-[11px] text-ink-muted min-w-0 flex-1 truncate">
              Editing <span className="text-ink font-medium">{target.title}</span>
            </span>
            <button
              type="button"
              onClick={() => onTargetChange(null)}
              aria-label="Stop editing this widget"
              className="p-0.5 rounded text-ink-faint hover:text-ink hover:bg-white transition-colors shrink-0"
            >
              <BiX className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isStreaming || !clientId}
            placeholder={
              !clientId
                ? "Select a client first"
                : target
                  ? "e.g. make it a donut, full width"
                  : "e.g. CPA by campaign, top 5"
            }
            aria-label="Describe the widget to build"
            className="min-h-[2.5rem] max-h-32 resize-none text-[13px]"
          />
          {isStreaming ? (
            <Button
              size="icon"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
            >
              <BiSquare className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => void send(input)}
              disabled={!input.trim() || !clientId}
              aria-label="Send"
            >
              <BiSend className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

type WidgetCardItem = Extract<ThreadItem, { kind: "widget" }>;

/** Status line copy per mode, in the wording of what the user asked for. */
const CARD_LABELS: Record<
  WidgetCardItem["mode"],
  Record<WidgetCardItem["state"], string>
> = {
  create: {
    pending: "Adding…",
    saved: "Added to dashboard",
    draft: "Added — hit Save to keep it",
    failed: "Couldn't add it to the dashboard",
  },
  update: {
    pending: "Updating…",
    saved: "Widget updated",
    draft: "Updated — hit Save to keep it",
    failed: "Couldn't update the widget",
  },
  remove: {
    pending: "Removing…",
    saved: "Widget removed",
    draft: "Removed — hit Save to keep it",
    failed: "Couldn't remove the widget",
  },
};

function cardStatus(item: WidgetCardItem) {
  if (item.undone) {
    if (item.undone === "failed") {
      return {
        // Deliberately cause-free: an undo comes back "failed" when the target
        // is gone, when the view or client moved on, AND when the save itself
        // was rejected — naming one of those would be a guess.
        label: "Couldn't undo that change",
        className: "text-destructive",
        Icon: BiError,
      };
    }
    return {
      label: item.undone === "draft" ? "Undone — hit Save to keep it" : "Undone",
      className: "text-ink-muted",
      Icon: BiUndo,
    };
  }
  const label = CARD_LABELS[item.mode][item.state];
  if (item.state === "pending") return { label, className: "text-ink-muted", Icon: null };
  if (item.state === "failed") return { label, className: "text-destructive", Icon: BiError };
  return { label, className: "text-primary", Icon: BiCheck };
}

function WidgetCard({ item, onUndo }: { item: WidgetCardItem; onUndo: (id: string) => void }) {
  const status = cardStatus(item);
  const StatusIcon = status.Icon;
  const ModeIcon = item.mode === "remove" ? BiTrash : item.mode === "update" ? BiEdit : LuSparkles;
  // Only a change that actually landed can be taken back, and only once.
  const canUndo = !!item.undo && !item.undone && (item.state === "saved" || item.state === "draft");

  return (
    <div className="rounded-xl border border-hairline bg-white p-3.5">
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <ModeIcon className="w-3 h-3 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink leading-tight">{item.title}</p>
          {item.type && item.config && (
            <p className="text-[11px] text-ink-muted mt-0.5">
              {describeBuilderConfig(item.type, item.config)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className={cn("flex items-center gap-1 text-[11px] font-medium", status.className)}>
          {StatusIcon && <StatusIcon className="w-3.5 h-3.5" />}
          {status.label}
        </p>
        {canUndo && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px] text-ink-muted hover:text-ink shrink-0"
            onClick={() => onUndo(item.id)}
            disabled={item.undoing}
          >
            <BiUndo className="w-3.5 h-3.5" /> {item.undoing ? "Undoing…" : "Undo"}
          </Button>
        )}
      </div>
    </div>
  );
}
