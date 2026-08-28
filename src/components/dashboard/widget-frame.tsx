"use client";

import React from "react";
import { BiMove, BiCog, BiX, BiError, BiFilterAlt } from "react-icons/bi";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { describeWidgetFilters, readWidgetFilters } from "@/lib/dashboard/filters";
import type { WidgetInstance } from "@/lib/dashboard/types";

class WidgetErrorBoundary extends React.Component<
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
  onConfigure: (i: string) => void;
  onRemove: (i: string) => void;
}

export function WidgetFrame({ instance, editMode, onConfigure, onRemove }: WidgetFrameProps) {
  const def = getWidget(instance.type);

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

  return (
    <Panel className="h-full w-full flex flex-col overflow-hidden group/widget">
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
        {editMode && (
          <div className="flex items-center gap-0.5 shrink-0">
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
