"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BiFilterAlt, BiLibrary } from "react-icons/bi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfigSection } from "@/components/dashboard/config-ui";
import { WidgetFiltersForm } from "@/components/dashboard/widget-filters-form";
import { WidgetErrorBoundary } from "@/components/dashboard/widget-frame";
import {
  getWidget,
  getWidgetConfigSize,
  type WidgetConfigSize,
  type WidgetDefinition,
} from "@/lib/dashboard/widget-registry";
import { describeWidgetFilters, readWidgetFilters } from "@/lib/dashboard/filters";
import { SIZE_PRESETS, GRID_COLS } from "@/lib/dashboard/types";
import type { SavedWidgetUsage, WidgetInstance } from "@/lib/dashboard/types";
import {
  savedWidgetUsageQuery,
  useSavedWidgetUsage,
  useSavedWidgets,
} from "@/hooks/use-saved-widgets";
import type { WidgetLinkChange } from "@/store/dashboard-store";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/** How many other views to name before collapsing the rest into "+N more". */
const USAGE_PREVIEW_LIMIT = 5;

/** How long the draft must settle before the preview re-renders (and re-fetches). */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Dialog geometry per size tier (see `getWidgetConfigSize`). The HEIGHT is what
 * actually sizes the preview: the preview card is `flex-1`, so it grows to
 * whatever the dialog leaves it. A one-number KPI in a 56rem-tall dialog is
 * almost entirely blank space, which is why the tiers step the height down as
 * well as the width.
 */
const TIER: Record<
  WidgetConfigSize,
  { dialog: string; panes: string; preview: string; rail: string; pane: string }
> = {
  // The small tier is where a cramped dialog shows most: a KPI's settings are
  // one select plus the filters, and the filter labels ("Date range" and its
  // "Following the page date picker" hint) share a row, so a 20rem rail wraps
  // them and the campaign list falls below the fold. It gets a wider rail, a
  // taller body and looser padding than the bigger tiers, whose content fills
  // the room on its own.
  sm: {
    dialog: "sm:max-w-[70rem] h-[min(90vh,50rem)]",
    panes: "lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]",
    preview: "min-h-[16rem]",
    // `--config-pad` / `--config-gap` loosen every ConfigSection card inside
    // (see config-ui.tsx); the bigger tiers leave them at their defaults.
    rail: "space-y-5 px-7 py-6 [--config-pad:1.25rem] [--config-gap:1.25rem]",
    pane: "gap-5 px-7 pb-6 lg:pt-6 [--config-pad:1.25rem] [--config-gap:1.25rem]",
  },
  md: {
    dialog: "sm:max-w-[62rem] h-[min(88vh,42rem)]",
    panes: "lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]",
    preview: "min-h-[12rem]",
    rail: "space-y-3 px-5 py-4",
    pane: "gap-3 px-5 pb-4 lg:pt-4",
  },
  lg: {
    dialog: "sm:max-w-[80rem] h-[min(88vh,48rem)]",
    panes: "lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]",
    preview: "min-h-[16rem]",
    rail: "space-y-3 px-5 py-4",
    pane: "gap-3 px-5 pb-4 lg:pt-4",
  },
  xl: {
    dialog: "sm:max-w-[92.5rem] h-[min(90vh,56rem)]",
    panes: "lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]",
    preview: "min-h-[18rem]",
    rail: "space-y-3 px-5 py-4",
    pane: "gap-3 px-5 pb-4 lg:pt-4",
  },
};

/** A widget with no form and no filters shows only the size row, so it never
 * needs more than one narrow column regardless of tier. */
const NO_SETTINGS_DIALOG = "sm:max-w-[34rem]";

/** Value that trails `value` until it stops changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

type UsageDecision = {
  /** Other views using this saved widget, or `null` when the lookup failed. */
  others: SavedWidgetUsage["views"] | null;
  /** Templates using it — they hold the same link, so they change too. */
  templates: SavedWidgetUsage["templates"];
  /** Report layouts using it, minus the one being edited. */
  reportLayouts: SavedWidgetUsage["reportLayouts"];
  /** Report templates using it. */
  reportTemplates: SavedWidgetUsage["reportTemplates"];
  config: Record<string, unknown>;
};

/**
 * "2 other views and 1 report layout" — whatever an update would actually
 * touch. All four kinds store the same link, so all four count.
 */
function usageLabel(counts: {
  views: number;
  templates: number;
  reportLayouts: number;
  reportTemplates: number;
}): string {
  const parts: string[] = [];
  if (counts.views > 0) parts.push(`${counts.views} other view${counts.views === 1 ? "" : "s"}`);
  if (counts.templates > 0)
    parts.push(`${counts.templates} template${counts.templates === 1 ? "" : "s"}`);
  if (counts.reportLayouts > 0)
    parts.push(
      `${counts.reportLayouts} report layout${counts.reportLayouts === 1 ? "" : "s"}`
    );
  if (counts.reportTemplates > 0)
    parts.push(
      `${counts.reportTemplates} report template${counts.reportTemplates === 1 ? "" : "s"}`
    );
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

interface WidgetConfigDialogProps {
  instance: WidgetInstance | null;
  /** Current lg-grid width of the widget, for the size preset row. */
  currentWidth?: number;
  /** The view being edited, so its own usage is excluded from the "other views" count. */
  currentViewId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: Record<string, unknown>, link?: WidgetLinkChange) => void;
  onResize: (w: number) => void;
}

/**
 * Widget settings dialog. Every widget with something to configure (a form or
 * filters) gets a fixed-height, editor-style body split into two independent
 * panes: a settings rail (chart type, data, filters) that scrolls on its own,
 * and a preview pane where a compact title + size row sits above a live preview
 * that fills the remaining height — so the preview never scrolls out of view.
 * The dialog's width and height come from the widget's size tier (`TIER`), so
 * the preview is scaled to how much the widget actually has to show. A widget
 * with no settings at all has nothing to preview, so it keeps a narrow
 * single-column dialog.
 */
export function WidgetConfigDialog({
  instance,
  currentWidth,
  currentViewId,
  open,
  onOpenChange,
  onSave,
  onResize,
}: WidgetConfigDialogProps) {
  const queryClient = useQueryClient();
  const savedWidgetId = instance?.savedWidgetId ?? null;
  // Prefetched while the dialog is open so the Apply click doesn't wait on it.
  useSavedWidgetUsage(open ? savedWidgetId : null);
  const { data: library } = useSavedWidgets(open && !!savedWidgetId);
  const linkedName = library?.find((entry) => entry.id === savedWidgetId)?.name;

  const [draft, setDraft] = useState<Record<string, unknown>>(instance?.config ?? {});
  // Set while the "used in other views" decision is pending; also holds the
  // config that decision will apply.
  const [decision, setDecision] = useState<UsageDecision | null>(null);
  // Reset the working copy on every open — done during render (React's
  // "adjusting state on prop change" pattern) rather than in an effect, to avoid
  // cascading-render lint/perf issues. The key carries the VIEW as well as the
  // instance id, because preset-derived views reuse literal ids ("kpi-spend"),
  // and closing sets it to null so a cancelled edit is never shown again.
  const openKey = open && instance ? `${currentViewId ?? "none"}::${instance.i}` : null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    if (openKey && instance) {
      setDraft({ ...instance.config });
      setDecision(null);
    }
  }

  // Applying a linked widget's edit is a fork in the road: the config either
  // goes back to the library (changing every view that uses it) or the instance
  // detaches into a private copy. Only ask when other views are actually
  // affected — otherwise "update everywhere" means "update here".
  async function handleApply() {
    if (!instance) return;
    if (!savedWidgetId) {
      onSave(draft);
      onOpenChange(false);
      return;
    }
    if (JSON.stringify(draft) === JSON.stringify(instance.config)) {
      onOpenChange(false);
      return;
    }

    let usage: SavedWidgetUsage | null = null;
    try {
      // `staleTime: 0` on purpose: the prefetch above may be a cached count from
      // before another view linked (or dropped) this widget, and a stale zero
      // silently skips the "update everywhere" decision.
      usage = await queryClient.fetchQuery({
        ...savedWidgetUsageQuery(savedWidgetId),
        staleTime: 0,
      });
    } catch {
      // Fall through with `null`: the dialog asks with an unknown count rather
      // than guessing which side of the fork the user wants.
    }

    const others = usage
      ? usage.views.filter((view) => view.dashboardId !== currentViewId)
      : null;
    const templates = usage?.templates ?? [];
    // `currentViewId` is whichever container is being edited — a dashboard view
    // or a report layout — so the one in hand is excluded on either side.
    const reportLayouts =
      usage?.reportLayouts.filter((layout) => layout.layoutId !== currentViewId) ?? [];
    const reportTemplates = usage?.reportTemplates ?? [];

    if (
      others &&
      others.length === 0 &&
      templates.length === 0 &&
      reportLayouts.length === 0 &&
      reportTemplates.length === 0
    ) {
      onSave(draft, { syncToLibrary: true });
      onOpenChange(false);
      return;
    }
    setDecision({ others, templates, reportLayouts, reportTemplates, config: draft });
  }

  function resolveDecision(link: WidgetLinkChange) {
    if (!decision) return;
    onSave(decision.config, link);
    setDecision(null);
    onOpenChange(false);
  }

  if (!instance) return null;
  const def = getWidget(instance.type);
  const ConfigForm = def?.ConfigForm;
  const AsideForm = def?.ConfigFormAside;
  const supportsFilters = def?.supportsFilters === true;
  // Anything with settings to edit gets the preview pane; a widget with neither
  // a form nor filters has nothing to watch change, so it stays a narrow dialog.
  const withPreview = !!def && (!!ConfigForm || supportsFilters);
  // Passing the draft lets a widget whose output the user chooses (the custom
  // builder) resize as that choice changes. Visualization only changes on a
  // click, never on a keystroke, so this cannot thrash while typing a title.
  const tier = TIER[def ? getWidgetConfigSize(def, draft) : "md"];

  const sizeSection = (
    <ConfigSection title="Size" hint={`${currentWidth ?? "?"}/${GRID_COLS.lg} columns · applies now`}>
      <div className="grid grid-cols-4 gap-2">
        {SIZE_PRESETS.map((p) => {
          const active = currentWidth === p.w;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => onResize(p.w)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "border-primary bg-primary/8" : "border-hairline hover:border-ink-faint"
              )}
            >
              <span className="w-full h-1.5 rounded-full bg-hairline overflow-hidden">
                <span
                  className={cn("block h-full rounded-full", active ? "bg-primary" : "bg-ink-faint")}
                  style={{ width: `${(p.w / GRID_COLS.lg) * 100}%` }}
                />
              </span>
              <span className={cn("text-[11px]", active ? "text-primary font-medium" : "text-ink-muted")}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
    </ConfigSection>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent bakes in `sm:max-w-sm`, so wider variants must override
          at the same breakpoint or they are ignored on desktop. The size comes
          from the widget's tier, so a widget that renders one number does not
          open the same cavernous dialog as a nine-row chart. The height is
          fixed so the two panes scroll independently and the preview fills the
          leftover space. */}
      <DialogContent
        className={cn(
          "p-0 gap-0 max-h-[92vh] overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]",
          // Eases the step when a tier change is the user's own doing (picking
          // a visualization) so the dialog does not snap to a new size.
          "transition-[max-width,height] duration-200 ease-out motion-reduce:transition-none",
          withPreview ? tier.dialog : NO_SETTINGS_DIALOG
        )}
      >
        <DialogHeader className="px-5 py-4 border-b border-hairline">
          <DialogTitle>Configure {def?.title ?? "widget"}</DialogTitle>
          <DialogDescription className="text-[13px]">
            Set what this widget shows and how much room it takes on the grid.
          </DialogDescription>
          {savedWidgetId && (
            <span className="mt-2 inline-flex w-fit items-center gap-1.5 text-[11px] font-medium text-primary bg-primary/8 border border-primary/20 rounded-full px-2 py-0.5">
              <BiLibrary className="w-3 h-3 shrink-0" />
              <span className="truncate">Linked{linkedName ? ` · ${linkedName}` : ""}</span>
            </span>
          )}
        </DialogHeader>

        {withPreview ? (
          <div
            className={cn(
              "min-h-0 overflow-y-auto bg-canvas-soft/40 lg:grid lg:overflow-hidden",
              tier.panes
            )}
          >
            {/* Settings rail: scrolls on its own so the preview stays in view.
                `@container` lets the form grids adapt to the rail width rather
                than the viewport. */}
            <div
              className={cn(
                "@container min-w-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-hairline",
                tier.rail
              )}
            >
              {ConfigForm && <ConfigForm config={draft} onChange={setDraft} />}
              {supportsFilters && <WidgetFiltersForm config={draft} onChange={setDraft} />}
            </div>
            {/* Preview pane: title and size stacked on top, live preview
                filling whatever height is left. */}
            <div className={cn("flex min-w-0 flex-col pt-0 lg:min-h-0 lg:overflow-y-auto", tier.pane)}>
              <div className="shrink-0 space-y-3">
                {AsideForm && <AsideForm config={draft} onChange={setDraft} />}
                {sizeSection}
              </div>
              {def && <PreviewCard def={def} config={draft} minHeight={tier.preview} />}
            </div>
          </div>
        ) : (
          // No form and no filters: nothing to preview, so only the size row
          // and a note that this widget has nothing else to set.
          <div className="min-h-0 overflow-y-auto bg-canvas-soft/40 px-5 py-4">
            <div className="space-y-3">
              {AsideForm && <AsideForm config={draft} onChange={setDraft} />}
              {sizeSection}
              <ConfigSection title="Settings">
                <p className="text-xs text-ink-muted">This widget has no data settings.</p>
              </ConfigSection>
            </div>
          </div>
        )}

        <DialogFooter className="m-0 rounded-b-xl px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleApply()}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <LinkedWidgetDecisionDialog
      decision={decision}
      name={linkedName}
      onCancel={() => setDecision(null)}
      onUpdateEverywhere={() => resolveDecision({ syncToLibrary: true })}
      onCreateCopy={() => resolveDecision({ savedWidgetId: null })}
    />
    </>
  );
}

/**
 * The fork for a linked widget: keep it shared (write the config back to the
 * library on the dashboard's own Save, so cancelling the edit reverts this too)
 * or detach this instance into a private copy.
 */
function LinkedWidgetDecisionDialog({
  decision,
  name,
  onCancel,
  onUpdateEverywhere,
  onCreateCopy,
}: {
  decision: UsageDecision | null;
  name?: string;
  onCancel: () => void;
  onUpdateEverywhere: () => void;
  onCreateCopy: () => void;
}) {
  const others = decision?.others ?? null;
  const templates = decision?.templates ?? [];
  const reportLayouts = decision?.reportLayouts ?? [];
  const reportTemplates = decision?.reportTemplates ?? [];
  const shown = others?.slice(0, USAGE_PREVIEW_LIMIT) ?? [];
  const extra = others ? others.length - shown.length : 0;
  const shownTemplates = templates.slice(0, USAGE_PREVIEW_LIMIT);
  const extraTemplates = templates.length - shownTemplates.length;
  const shownLayouts = reportLayouts.slice(0, USAGE_PREVIEW_LIMIT);
  const extraLayouts = reportLayouts.length - shownLayouts.length;
  const shownReportTemplates = reportTemplates.slice(0, USAGE_PREVIEW_LIMIT);
  const extraReportTemplates = reportTemplates.length - shownReportTemplates.length;

  return (
    <Dialog open={!!decision} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {others
              ? `This widget is used in ${usageLabel({
                  views: others.length,
                  templates: templates.length,
                  reportLayouts: reportLayouts.length,
                  reportTemplates: reportTemplates.length,
                })}`
              : "This widget may be used in other views"}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {name ? `“${name}” is a saved widget. ` : "This is a saved widget. "}
            Updating it will change it everywhere it is used.
          </DialogDescription>
        </DialogHeader>

        {others && (
          <ul className="text-[12px] text-ink-muted space-y-1 max-h-40 overflow-y-auto">
            {shown.map((view) => (
              <li key={view.dashboardId} className="truncate">
                {view.clientName} · {view.dashboardName}
              </li>
            ))}
            {extra > 0 && <li className="text-ink-faint">+{extra} more</li>}
            {shownTemplates.map((template) => (
              <li key={template.templateId} className="truncate">
                Template · {template.templateName}
              </li>
            ))}
            {extraTemplates > 0 && (
              <li className="text-ink-faint">+{extraTemplates} more templates</li>
            )}
            {shownLayouts.map((layout) => (
              <li key={layout.layoutId} className="truncate">
                Report layout · {layout.clientName} · {layout.layoutName}
              </li>
            ))}
            {extraLayouts > 0 && (
              <li className="text-ink-faint">+{extraLayouts} more report layouts</li>
            )}
            {shownReportTemplates.map((template) => (
              <li key={template.templateId} className="truncate">
                Report template · {template.templateName}
              </li>
            ))}
            {extraReportTemplates > 0 && (
              <li className="text-ink-faint">+{extraReportTemplates} more report templates</li>
            )}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onCreateCopy}>
            Create a copy
          </Button>
          <Button onClick={onUpdateEverywhere}>Update everywhere</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Right-column card: the real widget renderer driven by the unsaved draft, so
 * every change is visible before Apply. Same card language as the settings.
 */
function PreviewCard({
  def,
  config,
  minHeight,
}: {
  def: WidgetDefinition;
  config: Record<string, unknown>;
  /** Tailwind `min-h-*` floor for the render area, from the widget's size tier. */
  minHeight: string;
}) {
  const dateRange = useAppStore((s) => s.dateRange);
  const Render = def.Render;
  // Typing in a text field (a title, a limit) changes the draft on every
  // keystroke; settling first keeps half-typed configs from firing a fetch each.
  const preview = useDebounced(config, PREVIEW_DEBOUNCE_MS);
  const title = def.getTitle ? def.getTitle(preview) : def.title;
  const filterLabel = useMemo(() => describeWidgetFilters(readWidgetFilters(preview)), [preview]);
  const previewKey = useMemo(() => JSON.stringify(preview), [preview]);

  return (
    <ConfigSection
      title="Preview"
      hint={
        <span className="tabular-nums">
          {dateRange.start} → {dateRange.end}
        </span>
      }
      className="flex-1 flex flex-col min-h-0"
      bodyClassName="flex-1 flex flex-col min-h-0"
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[12px] font-medium text-ink-secondary truncate flex-1">{title}</span>
        {filterLabel && (
          <span
            title={filterLabel}
            className="inline-flex items-center gap-1 shrink-0 min-w-0 max-w-[45%] text-[10px] text-ink-muted bg-canvas-soft border border-hairline/60 rounded-full px-1.5 py-px"
          >
            <BiFilterAlt className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{filterLabel}</span>
          </span>
        )}
      </div>
      <div className={cn("flex-1", minHeight)}>
        {/* Keyed on the config so a render that threw on one draft doesn't
            leave the boundary stuck once the draft changes again. */}
        <WidgetErrorBoundary key={previewKey}>
          <Render config={preview} instanceId="preview" />
        </WidgetErrorBoundary>
      </div>
    </ConfigSection>
  );
}
