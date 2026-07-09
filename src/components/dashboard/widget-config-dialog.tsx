"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { SIZE_PRESETS } from "@/lib/dashboard/types";
import type { WidgetInstance } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

interface WidgetConfigDialogProps {
  instance: WidgetInstance | null;
  /** Current lg-grid width of the widget, for the size preset row. */
  currentWidth?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: Record<string, unknown>) => void;
  onResize: (w: number) => void;
}

export function WidgetConfigDialog({
  instance,
  currentWidth,
  open,
  onOpenChange,
  onSave,
  onResize,
}: WidgetConfigDialogProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(instance?.config ?? {});
  // Reset the working copy when a different widget is opened — done during
  // render (React's "adjusting state on prop change" pattern) rather than in an
  // effect, to avoid cascading-render lint/perf issues.
  const [lastId, setLastId] = useState<string | null>(instance?.i ?? null);
  if (instance && instance.i !== lastId) {
    setLastId(instance.i);
    setDraft({ ...instance.config });
  }

  if (!instance) return null;
  const def = getWidget(instance.type);
  const ConfigForm = def?.ConfigForm;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure {def?.title ?? "widget"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-secondary">Width</label>
            <div className="flex gap-1.5">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.w}
                  type="button"
                  onClick={() => onResize(p.w)}
                  className={cn(
                    "flex-1 text-xs py-1.5 rounded-md border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    currentWidth === p.w
                      ? "border-primary bg-primary/8 text-primary font-medium"
                      : "border-hairline text-ink-muted hover:text-ink"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {ConfigForm ? (
            <ConfigForm config={draft} onChange={setDraft} />
          ) : (
            <p className="text-xs text-ink-muted">This widget has no additional settings.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
