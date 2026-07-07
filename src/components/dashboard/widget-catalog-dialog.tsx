"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WIDGET_LIST, type WidgetDefinition } from "@/lib/dashboard/widget-registry";
import type { NewWidgetSpec } from "@/store/dashboard-store";

const CATEGORY_LABELS: Record<WidgetDefinition["category"], string> = {
  metrics: "Metrics",
  charts: "Charts",
  attribution: "Attribution & Revenue",
  other: "Other",
};

const CATEGORY_ORDER: WidgetDefinition["category"][] = ["metrics", "charts", "attribution", "other"];

interface WidgetCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (spec: NewWidgetSpec) => void;
}

export function WidgetCatalogDialog({ open, onOpenChange, onAdd }: WidgetCatalogDialogProps) {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: WIDGET_LIST.filter((w) => w.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>Pick a widget to add to your dashboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {grouped.map((g) => (
            <div key={g.cat}>
              <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider mb-2">
                {CATEGORY_LABELS[g.cat]}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {g.items.map((w) => {
                  const Icon = w.icon;
                  return (
                    <button
                      key={w.type}
                      type="button"
                      onClick={() => {
                        onAdd({ type: w.type, defaultSize: w.defaultSize, defaultConfig: w.defaultConfig });
                        onOpenChange(false);
                      }}
                      className="flex items-start gap-3 p-3 rounded-lg border border-hairline text-left hover:border-primary/40 hover:bg-canvas-soft/50 transition-all"
                    >
                      <span className="w-8 h-8 rounded-md bg-primary/8 text-primary grid place-items-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{w.title}</span>
                        <span className="block text-xs text-ink-muted leading-snug mt-0.5">
                          {w.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
