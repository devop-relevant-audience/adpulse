"use client";

// The Builder Assistant panel. It serves all four widget grids — a client's
// dashboard view, a client's report layout, and the two master templates — and
// knows which one it is on from `gridKind` alone: the copy, the starter chips
// and the widget types the route offers all follow from it. Applying a change
// is the caller's job (see `use-builder-grid.ts`), so the panel never knows
// whether a change was saved or joined a draft — it just reports what it is
// told.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LuSparkles } from "react-icons/lu";
import {
  BiCheck,
  BiEdit,
  BiError,
  BiExpandAlt,
  BiImageAdd,
  BiLayout,
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
import type { WidgetHeightKey, WidgetSizeKey } from "@/lib/dashboard/types";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  builderGridSurface,
  type BuilderGridKind,
  type BuilderStatusEvent,
  type BuilderWidgetArrangeEvent,
  type BuilderWidgetEvent,
  type BuilderWidgetRef,
  type BuilderWidgetRemoveEvent,
  type BuilderWidgetResizeEvent,
  type BuilderWidgetUpdateEvent,
} from "@/lib/builder/protocol";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_LABEL,
  VISION_IMAGE_ACCEPT,
  VISION_IMAGE_TYPES_LABEL,
  isVisionImageType,
} from "@/lib/uploads/image-constraints";

/** How a created, edited or removed widget ended up on the grid. */
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

/**
 * The wording each grid uses. The panel's mechanics are identical on all four
 * (see `BuilderGridKind`) — what changes is whether one item is a "widget" or a
 * "block", and what a card says it was added to.
 */
interface GridWords {
  /** "widget" or "block". */
  noun: string;
  /** Where a change landed, for a card's status line: "dashboard", "report", "template". */
  where: string;
  /** What the empty state calls the thing being edited. */
  target: string;
}

const GRID_WORDS: Record<BuilderGridKind, GridWords> = {
  "dashboard-view": { noun: "widget", where: "dashboard", target: "this view" },
  "report-layout": { noun: "block", where: "report", target: "this report" },
  "dashboard-template": { noun: "widget", where: "template", target: "the master dashboard" },
  "report-template": { noun: "block", where: "template", target: "the master report" },
};

/** Mirrors the system prompt's worked examples, so a chip always lands. */
const SUGGESTIONS = [
  "Total spend this period",
  "Spend share by platform",
  "Clicks and conversions by day",
  "Top 10 campaigns by spend",
];

/**
 * A report page is read top to bottom, so its chips start it the way a report
 * starts: a cover, then the written summary, then the numbers.
 */
const REPORT_SUGGESTIONS = [
  "A cover page titled Monthly performance",
  "A written summary of the period",
  "KPI tiles for spend, conversions and CPA",
  "Top 10 campaigns by spend",
];

/** Shown instead once a widget is pinned — every one is a change to that widget. */
const EDIT_SUGGESTIONS = [
  "Make it a donut chart",
  "Break it down by campaign",
  "Add conversions and CPA",
  "Make it full width and tall",
];

/**
 * One image on the composer. The file is uploaded through `POST /api/assets` the
 * moment it is attached, so pressing Send never waits on a network round trip
 * and the model is handed a URL rather than bytes.
 */
interface Attachment {
  id: string;
  name: string;
  /** Object URL, for a thumbnail that appears before the upload finishes. */
  preview: string;
  /** Public Blob URL once the upload lands; null while in flight or failed. */
  url: string | null;
  /** Why this one cannot be sent. The row stays so the user can see and drop it. */
  error?: string;
}

type ThreadItem =
  | { kind: "user"; id: string; text: string; images?: string[] }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "widget";
      id: string;
      /**
       * "create" added a widget, "update" rewrote one already on the grid,
       * "remove" took one off it, "resize" changed one's footprint and nothing
       * else, "arrange" put several side by side on one row.
       */
      mode: "create" | "update" | "remove" | "resize" | "arrange";
      title: string;
      /**
       * Absent for a removal (the widget is gone, only its name is left) and
       * for the size/layout changes, which carry no config at all.
       */
      type?: BuilderWidgetType;
      config?: Record<string, unknown>;
      /** What the size or layout change was, in words, for the card's subtitle. */
      detail?: string;
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
  /**
   * Which grid the panel is pointed at. Everything downstream — the widget
   * types the route offers, the prompt's wording, the copy in here — follows
   * from it. Defaults to a dashboard view.
   */
  gridKind?: BuilderGridKind;
  clientId: string | null;
  dashboardId?: string | null;
  /**
   * The open grid, keyed the way its owner keys its own Builder scope: the
   * selection, not the saved row's id, which is null until a view is first
   * saved (a Builder save would otherwise look like a view switch). A change of
   * this value starts the conversation over — the inventory, the cards and any
   * pinned target belonged to the grid that was open.
   */
  viewId: string | null;
  /** Name of the view, layout or template, for the panel's copy. */
  viewName?: string;
  /** Widgets on the open grid, so the assistant can be asked to change one. */
  widgets: BuilderWidgetRef[];
  /** Widget pinned via "Edit with AI"; unqualified edits refer to it. */
  targetWidgetId: string | null;
  onTargetChange: (i: string | null) => void;
  /** Inserts a validated config into the current grid and reports how it persisted. */
  onCreateWidget: (
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: BuilderWidgetSize
  ) => Promise<BuilderApplyResult>;
  /** Replaces an existing widget's config, same persistence rules as a create. */
  onUpdateWidget: (
    widgetId: string,
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: BuilderWidgetSize
  ) => Promise<BuilderApplyResult>;
  /** Takes a widget off the grid, same persistence rules as a create. */
  onRemoveWidget: (widgetId: string) => Promise<BuilderApplyResult>;
  /** Resizes a widget and nothing else — no config is sent or rewritten. */
  onResizeWidget: (widgetId: string, size: BuilderWidgetSize) => Promise<BuilderApplyResult>;
  /** Puts the given widgets side by side on one row, in that order. */
  onArrangeWidgets: (widgetIds: string[]) => Promise<BuilderApplyResult>;
}

/** A width word, a height word, or both — whatever the assistant asked for. */
export interface BuilderWidgetSize {
  width?: WidgetSizeKey;
  height?: WidgetHeightKey;
}

/** "full width · tall" — the size change as the card's subtitle prints it. */
function describeSize({ width, height }: BuilderWidgetSize): string {
  const words = (key: string) => key.replace(/-/g, " ");
  return [width ? `${words(width)} width` : null, height ? words(height) : null]
    .filter(Boolean)
    .join(" · ");
}

/** How a widget card reads back to the model on the next turn. */
function replayWidget(item: Extract<ThreadItem, { kind: "widget" }>): string {
  // An undone change must not be replayed as if it stood — the model would go
  // on editing a widget that is no longer there (or that never arrived).
  const undone = item.undone && item.undone !== "failed" ? " (the user undid this)" : "";
  if (item.mode === "remove") return `Removed widget: ${item.title}${undone}`;
  // The geometry changes replay as prose: they carry no config, and what the
  // model needs next turn is that the size or the row already changed.
  if (item.mode === "resize") return `Resized widget "${item.title}" to ${item.detail}${undone}`;
  if (item.mode === "arrange") return `Put on one row, left to right: ${item.title}${undone}`;
  const verb = item.mode === "update" ? "Updated" : "Created";
  return `${verb} widget (type "${item.type}"): ${JSON.stringify(item.config)}${undone}`;
}

/** Files a picker, a paste or a drop handed us — only images are of interest. */
function imageFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list).filter((f) => f.type.startsWith("image/")) : [];
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function BuilderAssistant({
  open,
  onOpenChange,
  gridKind = "dashboard-view",
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
  onResizeWidget,
  onArrangeWidgets,
}: BuilderAssistantProps) {
  const dateRange = useAppStore((s) => s.dateRange);
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);
  const words = GRID_WORDS[gridKind];
  const isReport = builderGridSurface(gridKind) === "report";
  // One record per render is cheap, and it keeps every card's copy derived from
  // the grid rather than hard-coded to a dashboard.
  const cardLabels = useMemo(() => buildCardLabels(words), [words]);

  const [items, setItems] = useState<ThreadItem[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  // What the route says it is doing. Shown only until the answer starts, so it
  // never competes with the text.
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Why a file was not attached at all (too many, wrong type, too big). */
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** In-flight uploads, so they can be cancelled with their row or the panel. */
  const uploadsRef = useRef(new Map<string, AbortController>());
  /** Every object URL handed to a thumbnail, so none is left un-revoked. */
  const previewsRef = useRef(new Set<string>());

  const uploading = attachments.some((a) => !a.url && !a.error);
  /**
   * Why an upload failed. Shown as a full line under the tray, not only as the
   * thumbnail's tooltip: the useful failures here are whole-endpoint ones ("image
   * uploads are not configured"), which are unreadable in a 64px tile.
   */
  const uploadError = attachments.find((a) => a.error)?.error ?? null;
  const readyImages = attachments.filter((a) => a.url).map((a) => a.url as string);

  /** Drops the rows and the object URLs behind them. Uploaded blobs stay put. */
  const clearAttachments = useCallback(() => {
    uploadsRef.current.forEach((c) => c.abort());
    uploadsRef.current.clear();
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current.clear();
    setAttachments([]);
    setAttachError(null);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    uploadsRef.current.get(id)?.abort();
    uploadsRef.current.delete(id);
    setAttachError(null);
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.preview);
        previewsRef.current.delete(gone.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  /**
   * Uploads one file to the shared image endpoint. The row keeps its place in
   * the tray throughout, so a failure is visible next to the thumbnail rather
   * than as a message that outlives the file it was about.
   */
  const uploadAttachment = useCallback(async (id: string, file: File) => {
    const controller = new AbortController();
    uploadsRef.current.set(id, controller);
    const fail = (message: string) =>
      setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, error: message } : a)));
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/assets", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload = (await res.json().catch(() => null)) as
        | { url?: string; contentType?: string; error?: string }
        | null;
      if (!res.ok || typeof payload?.url !== "string") {
        fail(typeof payload?.error === "string" ? payload.error : "Upload failed.");
        return;
      }
      // The route sniffs the real type from the bytes. A GIF or an SVG uploads
      // fine but the model cannot read it, so it is rejected here rather than
      // sent as something the assistant would silently ignore.
      if (payload.contentType && !isVisionImageType(payload.contentType)) {
        fail(`The assistant can only read ${VISION_IMAGE_TYPES_LABEL} images.`);
        return;
      }
      const url = payload.url;
      setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, url } : a)));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      fail("Upload failed. Check your connection and try again.");
    } finally {
      uploadsRef.current.delete(id);
    }
  }, []);

  /**
   * Adds files from the picker, a paste or a drop. What cannot be attached is
   * reported as one line rather than silently dropped, and the rest still go.
   */
  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
      if (room <= 0) {
        setAttachError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images at a time.`);
        return;
      }

      const accepted: { attachment: Attachment; file: File }[] = [];
      const skipped: string[] = [];
      for (const file of files.slice(0, room)) {
        if (!isVisionImageType(file.type)) {
          skipped.push(`${file.name} is not ${VISION_IMAGE_TYPES_LABEL}`);
          continue;
        }
        if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
          skipped.push(`${file.name} is over ${MAX_IMAGE_UPLOAD_LABEL}`);
          continue;
        }
        const preview = URL.createObjectURL(file);
        previewsRef.current.add(preview);
        accepted.push({
          attachment: { id: newId(), name: file.name, preview, url: null },
          file,
        });
      }
      if (files.length > room) skipped.push(`only ${room} more image${room === 1 ? "" : "s"} fit`);

      setAttachError(skipped.length > 0 ? `Skipped: ${skipped.join(", ")}.` : null);
      if (accepted.length === 0) return;
      setAttachments((prev) => [...prev, ...accepted.map((a) => a.attachment)]);
      accepted.forEach(({ attachment, file }) => void uploadAttachment(attachment.id, file));
    },
    [attachments.length, uploadAttachment]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, streamingText]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // A thread is about one client's data AND one grid's widgets — the inventory
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
    // The rows go with the thread; the object URLs behind them are revoked by
    // the cleanup effect below, which runs on the very same change.
    setAttachments([]);
    setAttachError(null);
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
    clearAttachments();
    onTargetChange(null);
    inputRef.current?.focus();
  }, [clearAttachments, onTargetChange]);

  // Cancels the in-flight stream when the client or the view changes, or the
  // panel unmounts, so a late response can't land in a thread — or on a view —
  // it no longer belongs to.
  // Uploads are cancelled and thumbnails revoked on the same change, for the
  // same reason: they belong to the composer of the view being left.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      uploadsRef.current.forEach((c) => c.abort());
      uploadsRef.current.clear();
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current.clear();
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
      // A turn is either words, images, or both. An upload still in flight
      // holds the turn rather than being dropped from it.
      const images = attachments.filter((a) => a.url).map((a) => a.url as string);
      if ((!message && images.length === 0) || uploading || isStreaming || !clientId) return;

      // Widget cards replay as assistant turns carrying the config that was
      // built, so a follow-up ("make that a bar chart") has something to edit.
      // Trimmed to the tail: the route caps the replayed turns, and nothing is
      // persisted, so an old part of the thread is not worth a 400.
      const history = [
        ...items.slice(-MAX_REPLAYED_ITEMS).map((it) => {
          if (it.kind === "widget") {
            return { role: "assistant" as const, content: replayWidget(it) };
          }
          // Earlier images ride along again: the model is stateless between
          // turns, so "make that one a bar chart too" needs the picture back.
          // The route caps how many it forwards.
          return it.kind === "user" && it.images?.length
            ? { role: "user" as const, content: it.text, images: it.images }
            : { role: it.kind, content: it.text };
        }),
        { role: "user" as const, content: message, ...(images.length ? { images } : {}) },
      ];

      setItems((prev) => [
        ...prev,
        { kind: "user", id: newId(), text: message, ...(images.length ? { images } : {}) },
      ]);
      setInput("");
      clearAttachments();
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
              gridKind,
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
            } else if (event === "widget_resize") {
              const resize = payload as BuilderWidgetResizeEvent;
              const size = { width: resize.width, height: resize.height };
              const id = newId();
              setItems((prev) => [
                ...prev,
                {
                  kind: "widget",
                  id,
                  mode: "resize",
                  title: resize.title,
                  detail: describeSize(size),
                  state: "pending",
                },
              ]);
              const applied = await onResizeWidget(resize.widgetId, size);
              patchWidget(id, { state: applied.state, undo: applied.undo });
            } else if (event === "widget_arrange") {
              const arrange = payload as BuilderWidgetArrangeEvent;
              const id = newId();
              setItems((prev) => [
                ...prev,
                {
                  kind: "widget",
                  id,
                  mode: "arrange",
                  // The row IS the change, so the card is named after all of
                  // its members rather than after one widget.
                  title: arrange.titles.join(" + "),
                  detail: `${arrange.widgetIds.length} widgets on one row`,
                  state: "pending",
                },
              ]);
              const applied = await onArrangeWidgets(arrange.widgetIds);
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
              const size = { width: widget.width, height: widget.height };
              const applied = update
                ? await onUpdateWidget(update.widgetId, update.type, update.config, size)
                : await onCreateWidget(widget.type, widget.config, size);
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
      attachments,
      clearAttachments,
      clientId,
      dashboardId,
      dateRange.end,
      dateRange.start,
      gridKind,
      isStreaming,
      items,
      uploading,
      onArrangeWidgets,
      onCreateWidget,
      onRemoveWidget,
      onResizeWidget,
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

  // A screenshot pasted straight from the clipboard is the fastest way in, so
  // the paste is intercepted only when it actually carries an image.
  function handlePaste(e: React.ClipboardEvent) {
    const files = imageFiles(e.clipboardData?.files);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (isStreaming || !clientId) return;
    addFiles(imageFiles(e.dataTransfer?.files));
  }

  const isEmpty = items.length === 0 && !streamingText;
  const canAttach = !!clientId && !isStreaming && attachments.length < MAX_ATTACHMENTS_PER_MESSAGE;
  const canSend = !!clientId && !uploading && (!!input.trim() || readyImages.length > 0);
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
      onDragOver={(e) => {
        // Only a file drag is ours; a text selection dragged over the panel is
        // left to the browser.
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        if (canAttach) setDragging(true);
      }}
      onDragLeave={(e) => {
        // Leaving for a child element is not leaving the panel.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="absolute inset-2 z-50 rounded-xl border-2 border-dashed border-primary bg-white/85 grid place-items-center pointer-events-none">
          <div className="text-center">
            <BiImageAdd className="w-6 h-6 mx-auto mb-1 text-primary" aria-hidden />
            <p className="text-[13px] font-medium text-ink">Drop to attach</p>
            <p className="text-[11px] text-ink-muted">
              {VISION_IMAGE_TYPES_LABEL}, up to {MAX_IMAGE_UPLOAD_LABEL}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 px-5 h-14 border-b border-hairline shrink-0 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <LuSparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-[13px] text-ink leading-tight">Builder Assistant</h2>
            <p className="text-[11px] text-ink-muted truncate">
              Describe a {words.noun} to build or change
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
              {target ? `Change this ${words.noun} in words` : `Build a ${words.noun} in words`}
            </p>
            <p className="text-[12px] text-ink-muted max-w-[260px] leading-relaxed mb-5">
              {target ? (
                <>
                  Say what should change about{" "}
                  <span className="text-ink font-medium">{target.title}</span>.
                </>
              ) : (
                <>
                  Name the metric and how you want it split, or attach a screenshot or
                  sketch to build from. The {words.noun} is added to{" "}
                  {viewName ? `“${viewName}”` : words.target}.
                </>
              )}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[320px]">
              {(target ? EDIT_SUGGESTIONS : isReport ? REPORT_SUGGESTIONS : SUGGESTIONS).map((s) => (
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
                <WidgetCard
                  key={item.id}
                  item={item}
                  labels={cardLabels}
                  onUndo={handleUndo}
                />
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
                      <>
                        {item.images && item.images.length > 0 && (
                          <div
                            className={cn(
                              "flex flex-wrap gap-1.5",
                              item.text && "mb-1.5"
                            )}
                          >
                            {item.images.map((url) => (
                              /* eslint-disable-next-line @next/next/no-img-element -- arbitrary Blob host, not a configured next/image remote pattern */
                              <img
                                key={url}
                                src={url}
                                alt="Attached image"
                                className="h-16 w-16 rounded-md object-cover bg-white/20"
                              />
                            ))}
                          </div>
                        )}
                        {item.text}
                      </>
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
              aria-label={`Stop editing this ${words.noun}`}
              className="p-0.5 rounded text-ink-faint hover:text-ink hover:bg-white transition-colors shrink-0"
            >
              <BiX className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
            ))}
          </div>
        )}

        {(attachError || uploadError) && (
          <p role="alert" className="mb-2 text-[11px] text-destructive">
            {[attachError, uploadError].filter(Boolean).join(" ")}
          </p>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={VISION_IMAGE_ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = imageFiles(e.target.files);
              // Reset so picking the same file twice in a row still fires change.
              e.target.value = "";
              addFiles(files);
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAttach}
            aria-label="Attach an image"
            title={
              attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE
                ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} images at a time`
                : `Attach a screenshot or sketch (${VISION_IMAGE_TYPES_LABEL})`
            }
          >
            <BiImageAdd className="w-4 h-4" />
          </Button>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={2}
            disabled={isStreaming || !clientId}
            placeholder={
              !clientId
                ? "Select a client first"
                : target
                  ? "e.g. make it a donut, full width"
                  : isReport
                    ? "e.g. a cover page, then spend by platform"
                    : "e.g. CPA by campaign, top 5 — or paste a screenshot"
            }
            aria-label={`Describe the ${words.noun} to build`}
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
              disabled={!canSend}
              aria-label="Send"
              title={uploading ? "Waiting for the upload to finish" : undefined}
            >
              <BiSend className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

/** One thumbnail in the composer tray: uploading, ready, or failed. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const { id, name, preview, url, error } = attachment;
  return (
    <div
      className={cn(
        "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-canvas-soft/60",
        error ? "border-destructive" : "border-hairline"
      )}
      title={error ? `${name} — ${error}` : name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
      <img src={preview} alt={name} className="h-full w-full object-cover" />
      {!url && (
        <span
          className={cn(
            "absolute inset-0 grid place-items-center bg-white/75 px-1 text-center text-[10px] font-medium",
            error ? "text-destructive" : "text-ink-muted"
          )}
        >
          {error ? <BiError className="h-4 w-4" aria-hidden /> : "Uploading…"}
        </span>
      )}
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={`Remove ${name}`}
        className="absolute top-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-ink/70 text-white transition-colors hover:bg-ink"
      >
        <BiX className="h-3 w-3" />
      </button>
    </div>
  );
}

type WidgetCardItem = Extract<ThreadItem, { kind: "widget" }>;

/**
 * Status line copy per mode, in the wording of what the user asked for — and of
 * the grid it was asked on: the same change is a widget added to a dashboard, a
 * block added to a report, or either one added to a master template.
 */
type CardLabels = Record<WidgetCardItem["mode"], Record<WidgetCardItem["state"], string>>;

function buildCardLabels({ noun, where }: GridWords): CardLabels {
  const Noun = `${noun[0].toUpperCase()}${noun.slice(1)}`;
  return {
    create: {
      pending: "Adding…",
      saved: `Added to ${where === "template" ? "the template" : `the ${where}`}`,
      draft: "Added — hit Save to keep it",
      failed: `Couldn't add it to the ${where}`,
    },
    update: {
      pending: "Updating…",
      saved: `${Noun} updated`,
      draft: "Updated — hit Save to keep it",
      failed: `Couldn't update the ${noun}`,
    },
    remove: {
      pending: "Removing…",
      saved: `${Noun} removed`,
      draft: "Removed — hit Save to keep it",
      failed: `Couldn't remove the ${noun}`,
    },
    resize: {
      pending: "Resizing…",
      saved: `${Noun} resized`,
      draft: "Resized — hit Save to keep it",
      failed: `Couldn't resize the ${noun}`,
    },
    arrange: {
      pending: "Rearranging…",
      saved: "Moved onto one row",
      draft: "Moved onto one row — hit Save to keep it",
      failed: `Couldn't rearrange those ${noun}s`,
    },
  };
}

/** The glyph on the card, so the kind of change is readable at a glance. */
const MODE_ICONS: Record<WidgetCardItem["mode"], typeof LuSparkles> = {
  create: LuSparkles,
  update: BiEdit,
  remove: BiTrash,
  resize: BiExpandAlt,
  arrange: BiLayout,
};

function cardStatus(item: WidgetCardItem, labels: CardLabels) {
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
  const label = labels[item.mode][item.state];
  if (item.state === "pending") return { label, className: "text-ink-muted", Icon: null };
  if (item.state === "failed") return { label, className: "text-destructive", Icon: BiError };
  return { label, className: "text-primary", Icon: BiCheck };
}

function WidgetCard({
  item,
  labels,
  onUndo,
}: {
  item: WidgetCardItem;
  labels: CardLabels;
  onUndo: (id: string) => void;
}) {
  const status = cardStatus(item, labels);
  const StatusIcon = status.Icon;
  const ModeIcon = MODE_ICONS[item.mode];
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
          {item.type && item.config ? (
            <p className="text-[11px] text-ink-muted mt-0.5">
              {describeBuilderConfig(item.type, item.config)}
            </p>
          ) : (
            item.detail && <p className="text-[11px] text-ink-muted mt-0.5">{item.detail}</p>
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
