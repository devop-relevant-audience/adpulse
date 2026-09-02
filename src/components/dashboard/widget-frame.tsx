"use client";

import React from "react";
import {
  BiMove,
  BiCog,
  BiX,
  BiError,
  BiFilterAlt,
  BiLibrary,
  BiBookmarkPlus,
  BiCopy,
  BiDotsHorizontalRounded,
  BiDownload,
} from "react-icons/bi";
import { LuSparkles } from "react-icons/lu";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { describeWidgetFilters, readWidgetFilters } from "@/lib/dashboard/filters";
import {
  downloadWidgetCsv,
  useHasWidgetData,
  useWidgetDataReader,
} from "@/lib/dashboard/widget-data";
import type { WidgetInstance } from "@/lib/dashboard/types";

export class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full grid place-items-center text-center px-3">
          <div className="text-ink-muted">
            <BiError className="w-4 h-4 mx-auto mb-1 text-amber-500" />
            <p className="text-xs">This widget failed to render</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface WidgetFrameProps {
  instance: WidgetInstance;
  editMode: boolean;
  /** One-shot "just added" flash (see dashboard-grid.css). */
  highlight?: boolean;
  onConfigure: (i: string) => void;
  onRemove: (i: string) => void;
  /** Opens the "save to library" dialog. Absent = the action is unavailable. */
  onSaveToLibrary?: (i: string) => void;
  /** Copies the widget in the draft. Absent = the action is unavailable. */
  onDuplicate?: (i: string) => void;
  /**
   * Pins this widget as the Builder Assistant's edit target. Absent = the
   * assistant cannot rewrite this widget (not a chart, library-linked, or the
   * viewer may not edit the dashboard at all).
   */
  onEditWithAi?: (i: string) => void;
}

/** The edit-mode button cluster, shared by the card frame and the bare one. */
function EditActions({
  instance,
  linked,
  canConfigure,
  onConfigure,
  onRemove,
  onSaveToLibrary,
  onDuplicate,
}: Pick<WidgetFrameProps, "instance" | "onConfigure" | "onRemove" | "onSaveToLibrary" | "onDuplicate"> & {
  linked: boolean;
  canConfigure: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {onSaveToLibrary && !linked && (
        <button
          type="button"
          aria-label="Save widget to library"
          title="Save to library"
          onClick={() => onSaveToLibrary(instance.i)}
          className="p-1 rounded hover:bg-canvas-soft text-ink-muted hover:text-ink transition-colors"
        >
          <BiBookmarkPlus className="w-3.5 h-3.5" />
        </button>
      )}
      {onDuplicate && (
        <button
          type="button"
          aria-label="Duplicate widget"
          title="Duplicate"
          onClick={() => onDuplicate(instance.i)}
          className="p-1 rounded hover:bg-canvas-soft text-ink-muted hover:text-ink transition-colors"
        >
          <BiCopy className="w-3.5 h-3.5" />
        </button>
      )}
      {canConfigure && (
        <button
          type="button"
          aria-label="Configure widget"
          onClick={() => onConfigure(instance.i)}
          className="p-1 rounded hover:bg-canvas-soft text-ink-muted hover:text-ink transition-colors"
        >
          <BiCog className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label="Remove widget"
        onClick={() => onRemove(instance.i)}
        className="p-1 rounded hover:bg-red-50 text-ink-muted hover:text-red-600 transition-colors"
      >
        <BiX className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function WidgetFrame({
  instance,
  editMode,
  highlight,
  onConfigure,
  onRemove,
  onSaveToLibrary,
  onDuplicate,
  onEditWithAi,
}: WidgetFrameProps) {
  const def = getWidget(instance.type);
  // View-mode menu state. `hasData` only flips when the widget first publishes
  // rows, and the rows themselves are pulled at click time, so a widget
  // re-rendering its data never re-renders this frame.
  const hasData = useHasWidgetData(instance.i);
  const readWidgetData = useWidgetDataReader();

  if (!def) {
    return (
      <Panel className="h-full w-full grid place-items-center text-xs text-ink-muted">
        Unknown widget: {instance.type}
      </Panel>
    );
  }

  const title = def.getTitle ? def.getTitle(instance.config) : def.title;
  const Render = def.Render;
  const filterLabel = describeWidgetFilters(readWidgetFilters(instance.config));
  const canConfigure = Boolean(def.ConfigForm || def.supportsFilters);
  // Linked = this instance renders a saved-widget library entry, so editing it
  // can change other views (the config dialog asks before it does).
  const linked = Boolean(instance.savedWidgetId);
  const editActions = (
    <EditActions
      instance={instance}
      linked={linked}
      canConfigure={canConfigure}
      onConfigure={onConfigure}
      onRemove={onRemove}
      onSaveToLibrary={onSaveToLibrary}
      onDuplicate={onDuplicate}
    />
  );

  // A chromeless widget (section header, image) is page furniture, not a card:
  // the Panel's border and title row would print a heading twice over a section,
  // and caption an image with its alt text. So it renders bare and the edit
  // affordances float over it instead of sitting in a title bar.
  if (def.chromeless) {
    return (
      <div
        className={cn(
          "h-full w-full relative px-1",
          editMode &&
            "widget-drag-handle cursor-grab active:cursor-grabbing rounded-lg border border-dashed border-hairline bg-canvas-soft/40",
          highlight && "widget-just-added"
        )}
      >
        {/* Same rule as the card body: the content must not swallow the drag in
            edit mode. An <img> is natively draggable, so without this a drag
            started on an image begins an HTML5 image drag and the widget itself
            never moves. */}
        <div className={cn("h-full w-full", editMode && "pointer-events-none select-none")}>
          <Render config={instance.config} instanceId={instance.i} />
        </div>
        {editMode && (
          // A chromeless widget can fill its tile edge to edge with arbitrary
          // pixels, so the floating cluster carries its own backdrop or the
          // buttons vanish into a dark image.
          <div className="absolute top-1 right-1 rounded-md bg-white/85 backdrop-blur-sm">
            {editActions}
          </div>
        )}
      </div>
    );
  }

  return (
    <Panel className={cn("h-full w-full flex flex-col overflow-hidden group/widget", highlight && "widget-just-added")}>
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 h-8 shrink-0 border-b border-hairline/60",
          editMode && "widget-drag-handle cursor-grab active:cursor-grabbing bg-canvas-soft/40"
        )}
      >
        {editMode && <BiMove className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
        <span className="text-[12px] font-medium text-ink-secondary truncate flex-1">
          {title}
        </span>
        {filterLabel && (
          <span
            title={filterLabel}
            className="inline-flex items-center gap-1 shrink-0 min-w-0 max-w-[45%] text-[10px] text-ink-muted bg-canvas-soft border border-hairline/60 rounded-full px-1.5 py-px"
          >
            <BiFilterAlt className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{filterLabel}</span>
          </span>
        )}
        {linked && (
          <span
            title="Linked to a saved widget — editing it can change other views"
            className="inline-flex items-center gap-1 shrink-0 text-[10px] text-primary bg-primary/8 border border-primary/20 rounded-full px-1.5 py-px"
          >
            <BiLibrary className="w-2.5 h-2.5 shrink-0" />
            Linked
          </span>
        )}
        {editMode && editActions}
        {/* Promoted out of the actions menu: an AI edit is the fastest way to
            change a chart, and behind the "…" nobody found it. Same reveal as
            the actions menu beside it — on hover (or keyboard focus) on a
            pointer device, always visible on touch, where there is no hover. */}
        {!editMode && onEditWithAi && (
          <button
            type="button"
            aria-label="Edit with AI"
            title="Edit with AI"
            onClick={() => onEditWithAi(instance.i)}
            className="shrink-0 p-1 rounded text-ink-faint hover:bg-primary/8 hover:text-primary transition-colors opacity-100 md:opacity-0 md:group-hover/widget:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
          >
            <LuSparkles className="w-3.5 h-3.5" />
          </button>
        )}
        {!editMode && hasData && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Widget actions"
              className="shrink-0 p-1 rounded text-ink-faint hover:bg-canvas-soft hover:text-ink transition-colors opacity-100 md:opacity-0 md:group-hover/widget:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
            >
              <BiDotsHorizontalRounded className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-44">
              <DropdownMenuItem
                onClick={() => {
                  const data = readWidgetData(instance.i);
                  if (data) downloadWidgetCsv(data, title);
                }}
              >
                <BiDownload className="w-3.5 h-3.5 text-ink-muted" />
                Download CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className={cn("flex-1 min-h-0 p-3", editMode && "pointer-events-none select-none")}>
        <WidgetErrorBoundary>
          <Render config={instance.config} instanceId={instance.i} />
        </WidgetErrorBoundary>
      </div>
    </Panel>
  );
}
