"use client";

import React from "react";
import { GripVertical, Settings2, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWidget } from "@/lib/dashboard/widget-registry";
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
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" />
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
      <div className="h-full w-full bg-white rounded-xl border border-hairline grid place-items-center text-xs text-ink-muted">
        Unknown widget: {instance.type}
      </div>
    );
  }

  const title = def.getTitle ? def.getTitle(instance.config) : def.title;
  const Render = def.Render;

  return (
    <div className="h-full w-full bg-white rounded-xl border border-hairline flex flex-col overflow-hidden group/widget">
      <div
        className={cn(
          "flex items-center gap-1.5 px-3 h-8 shrink-0 border-b border-hairline/60",
          editMode && "widget-drag-handle cursor-grab active:cursor-grabbing bg-canvas-soft/40"
        )}
      >
        {editMode && <GripVertical className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
        <span className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide truncate flex-1">
          {title}
        </span>
        {editMode && (
          <div className="flex items-center gap-0.5 shrink-0">
            {def.ConfigForm && (
              <button
                type="button"
                aria-label="Configure widget"
                onClick={() => onConfigure(instance.i)}
                className="p-1 rounded hover:bg-canvas-soft text-ink-muted hover:text-ink transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Remove widget"
              onClick={() => onRemove(instance.i)}
              className="p-1 rounded hover:bg-red-50 text-ink-muted hover:text-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 p-3">
        <WidgetErrorBoundary>
          <Render config={instance.config} instanceId={instance.i} />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
