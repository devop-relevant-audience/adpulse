"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/components/dashboard/dashboard-grid.css";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { BiArrowBack, BiCheck, BiPlus, BiShow, BiX } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WidgetCatalogDialog } from "@/components/dashboard/widget-catalog-dialog";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";
import { SaveWidgetDialog } from "@/components/dashboard/save-widget-dialog";
import { WidgetDataProvider } from "@/lib/dashboard/widget-data";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { useReportLayout, useSaveReportLayout } from "@/hooks/use-report-layouts";
import { ReportPreviewDialog } from "@/components/reports/report-preview-dialog";
import { useReportLayoutStore } from "@/store/report-layout-store";
import type { NewWidgetSpec } from "@/store/grid-edit-store";
import {
  GRID_COLS,
  GRID_CONTAINER_PADDING,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  type DashboardLayouts,
  type SavedWidget,
  type WidgetInstance,
} from "@/lib/dashboard/types";

// The report builder's canvas: one layout, always in edit mode, drawn on a
// document-width page rather than the full dashboard width so the blocks are
// arranged at roughly the proportions the generated report will use.
//
// The grid wiring is the dashboard's (see `customizable-dashboard.tsx`): RGL
// 2.x self-measures through `useContainerWidth`, so the measured div must be
// mounted on the very first render — loading, empty and populated states all
// live INSIDE it.

/** Editing width of the page. Matches the generated report's document width. */
const PAGE_MAX_WIDTH = 880;

// The editor grid is PINNED to `lg`/12 columns, whatever the page measures.
// RGL picks a breakpoint from the measured width (`getBreakpointFromWidth`:
// the widest entry whose value is strictly below the width), and the page's
// content box is ~832px — under GRID_BREAKPOINTS.lg (1024), so it would select
// `md` and write every drag and resize into `layouts.md`. The report renderer
// (`view-report.tsx`) draws `layouts.lg` at 12 columns only, so those edits
// would be discarded. A single-entry breakpoint map at 0 makes `lg` the only
// candidate at any width; 12 columns at 832px simply means narrower cells.
// `md`/`sm` are still maintained by the store (addWidget/resizeWidget) and
// carried through the save, because the PUT schema requires all three.
const EDITOR_BREAKPOINTS = { lg: 0 };
const EDITOR_COLS = { lg: GRID_COLS.lg };

export function ReportLayoutEditor({
  clientId,
  layoutId,
  layoutName,
  onBack,
}: {
  clientId: string;
  layoutId: string;
  /** Known from the list, so the toolbar has a name before the fetch lands. */
  layoutName: string;
  onBack: () => void;
}) {
  const { data: saved, isLoading, isError, refetch } = useReportLayout(clientId, layoutId);
  const saveLayout = useSaveReportLayout(clientId);
  const { width, containerRef } = useContainerWidth();

  const draft = useReportLayoutStore((s) => s.draft);
  const isDirty = useReportLayoutStore((s) => s.isDirty);
  const beginEdit = useReportLayoutStore((s) => s.beginEdit);
  const cancelEdit = useReportLayoutStore((s) => s.cancelEdit);
  const setLayouts = useReportLayoutStore((s) => s.setLayouts);
  const addWidget = useReportLayoutStore((s) => s.addWidget);
  const duplicateWidget = useReportLayoutStore((s) => s.duplicateWidget);
  const removeWidget = useReportLayoutStore((s) => s.removeWidget);
  const updateWidgetConfig = useReportLayoutStore((s) => s.updateWidgetConfig);
  const linkWidget = useReportLayoutStore((s) => s.linkWidget);
  const resizeWidget = useReportLayoutStore((s) => s.resizeWidget);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [savingToLibraryId, setSavingToLibraryId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // Set to the action waiting on a "discard unsaved changes?" answer.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Seed the draft once per layout. Guarded on the STORE's draft, not a ref:
  // StrictMode re-runs effects after their cleanup (which clears the draft), and
  // a ref would still say "done" — leaving the skeleton up forever. A background
  // refetch changes `saved` but the draft for this layout already exists, so the
  // user's unsaved edits are never re-seeded away.
  useEffect(() => {
    if (!saved) return;
    const draft = useReportLayoutStore.getState().draft;
    if (draft && draft.id === layoutId) return;
    beginEdit(saved);
  }, [saved, layoutId, beginEdit]);

  // The draft belongs to this editor session, so leaving drops it.
  useEffect(() => () => cancelEdit(), [cancelEdit]);

  // Scroll a freshly added block into view. RGL renders a new item one commit
  // after the draft updates, so the element may not exist yet — retry briefly.
  // The flash itself is declarative (`highlight` on WidgetFrame).
  useEffect(() => {
    if (!justAddedId) return;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const tryScroll = () => {
      const el = document.querySelector(`[data-widget-id="${CSS.escape(justAddedId)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (attempts++ < 20) retryTimer = setTimeout(tryScroll, 50);
    };
    tryScroll();
    const flashTimer = setTimeout(() => setJustAddedId(null), 1800);
    return () => {
      clearTimeout(flashTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [justAddedId]);

  const widgetsById = useMemo(() => {
    const m = new Map<string, WidgetInstance>();
    draft?.widgets.forEach((w) => m.set(w.i, w));
    return m;
  }, [draft]);

  const configuring = configuringId ? widgetsById.get(configuringId) ?? null : null;
  const savingToLibrary = savingToLibraryId ? widgetsById.get(savingToLibraryId) ?? null : null;
  const configuringWidth = configuring
    ? draft?.layouts.lg.find((l) => l.i === configuring.i)?.w
    : undefined;

  function handleAddWidget(spec: NewWidgetSpec) {
    setJustAddedId(addWidget(spec));
  }

  function handleDuplicateWidget(i: string) {
    const copyId = duplicateWidget(i);
    if (copyId) setJustAddedId(copyId);
  }

  // A library entry is added LINKED: the config shown here is a hydrated copy,
  // but the library row stays the source of truth (the save strips it again).
  function handleAddSavedWidget(entry: SavedWidget) {
    const def = getWidget(entry.widget_type);
    if (!def) return;
    setJustAddedId(
      addWidget({
        type: entry.widget_type,
        defaultSize: def.defaultSize,
        defaultConfig: entry.config,
        savedWidgetId: entry.id,
      })
    );
  }

  // The grid only ever edits `lg` (see EDITOR_BREAKPOINTS), so `md`/`sm` are
  // taken straight from the draft — the store keeps them in step on add and
  // resize, and the PUT schema requires all three arrays.
  function handleLayoutChange(_current: Layout, all: ResponsiveLayouts) {
    const cur = useReportLayoutStore.getState().draft?.layouts;
    setLayouts({
      lg: [...(all.lg ?? cur?.lg ?? [])] as DashboardLayouts["lg"],
      md: [...(cur?.md ?? [])] as DashboardLayouts["md"],
      sm: [...(cur?.sm ?? [])] as DashboardLayouts["sm"],
    });
  }

  /** Answers whether the save landed, so callers can chain on it. */
  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    try {
      // Re-seed the draft from what the SERVER stored: linked widgets come back
      // hydrated, and the save is then no longer dirty.
      const stored = await saveLayout.mutateAsync(draft);
      beginEdit(stored);
      return true;
    } catch {
      // The failure is rendered from the mutation's own error state; the draft
      // stays dirty so the user can retry.
      return false;
    }
  }

  // The preview renders the SAVED row, so unsaved blocks have to land first —
  // a failed save keeps the dialog shut and leaves the error line to explain.
  async function handlePreview() {
    if (isDirty && !(await handleSave())) return;
    setPreviewOpen(true);
  }

  /** Ask before dropping unsaved blocks. */
  function withDirtyGuard(run: () => void) {
    if (isDirty) setPendingDiscard(() => run);
    else run();
  }

  function revertToSaved() {
    if (saved) beginEdit(saved);
  }

  const name = draft?.name ?? saved?.name ?? layoutName;

  return (
    <WidgetDataProvider>
      <div className="space-y-4 dash-editing">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => withDirtyGuard(onBack)}
            >
              <BiArrowBack className="w-3.5 h-3.5" /> Back
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-ink truncate">{name}</h1>
              <p className="text-[12px] text-ink-muted">Report layout</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatalogOpen(true)}
              disabled={!draft}
            >
              <BiPlus className="w-4 h-4" /> Add block
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePreview()}
              disabled={!draft || saveLayout.isPending}
            >
              <BiShow className="w-4 h-4" /> {isDirty ? "Save & preview" : "Preview"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => withDirtyGuard(revertToSaved)}
              disabled={!draft || !isDirty || saveLayout.isPending}
            >
              <BiX className="w-4 h-4" /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!draft || !isDirty || saveLayout.isPending}
            >
              <BiCheck className="w-4 h-4" /> {saveLayout.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {saveLayout.isError && (
          <p role="alert" className="text-[12px] text-destructive">
            {saveLayout.error instanceof Error
              ? saveLayout.error.message
              : "Failed to save the layout"}
          </p>
        )}

        {isError && !isLoading && (
          <QueryError onRetry={() => refetch()} message="Couldn't load this report layout" />
        )}

        {/* The page. The measured div sits INSIDE the padding so the grid width
            is the page's content width, and it is mounted on the first render
            (useContainerWidth attaches its observer in a mount effect only). */}
        <div
          className="mx-auto w-full rounded-xl border border-hairline bg-white p-6 shadow-sm"
          style={{ maxWidth: PAGE_MAX_WIDTH }}
        >
          <div ref={containerRef}>
            {!draft ? (
              <Skeleton className="h-[400px] w-full rounded-xl" />
            ) : draft.widgets.length === 0 ? (
              <div className="border border-dashed border-hairline rounded-xl py-16 grid place-items-center text-center">
                <BiPlus className="w-8 h-8 text-ink-faint mb-3" />
                <p className="text-sm font-medium text-ink">This report layout is empty</p>
                <p className="text-xs text-ink-muted mt-1 mb-4">
                  Start with a cover block, then add the metrics this report should carry.
                </p>
                <Button size="sm" onClick={() => setCatalogOpen(true)}>
                  <BiPlus className="w-4 h-4" /> Add block
                </Button>
              </div>
            ) : (
              <ResponsiveGridLayout
                className="layout"
                width={width}
                layouts={draft.layouts as unknown as ResponsiveLayouts}
                breakpoints={EDITOR_BREAKPOINTS}
                cols={EDITOR_COLS}
                rowHeight={GRID_ROW_HEIGHT}
                margin={GRID_MARGIN}
                containerPadding={GRID_CONTAINER_PADDING}
                dragConfig={{ enabled: true, handle: ".widget-drag-handle" }}
                resizeConfig={{ enabled: true }}
                onLayoutChange={handleLayoutChange}
              >
                {draft.widgets.map((w) => (
                  <div key={w.i} data-widget-id={w.i}>
                    <WidgetFrame
                      instance={w}
                      editMode
                      highlight={w.i === justAddedId}
                      onConfigure={setConfiguringId}
                      onRemove={removeWidget}
                      onSaveToLibrary={setSavingToLibraryId}
                      onDuplicate={handleDuplicateWidget}
                    />
                  </div>
                ))}
              </ResponsiveGridLayout>
            )}
          </div>
        </div>

        <WidgetCatalogDialog
          open={catalogOpen}
          onOpenChange={setCatalogOpen}
          onAdd={handleAddWidget}
          onAddSaved={handleAddSavedWidget}
          surface="report"
        />
        <WidgetConfigDialog
          instance={configuring}
          currentWidth={configuringWidth}
          currentViewId={layoutId}
          open={!!configuringId}
          onOpenChange={(o) => !o && setConfiguringId(null)}
          onSave={(cfg, link) => configuring && updateWidgetConfig(configuring.i, cfg, link)}
          onResize={(w) => configuring && resizeWidget(configuring.i, w)}
        />
        <SaveWidgetDialog
          instance={savingToLibrary}
          open={!!savingToLibraryId}
          onOpenChange={(o) => !o && setSavingToLibraryId(null)}
          onSaved={(savedWidgetId) =>
            savingToLibrary && linkWidget(savingToLibrary.i, savedWidgetId)
          }
        />

        {previewOpen && (
          <ReportPreviewDialog
            clientId={clientId}
            layoutId={layoutId}
            layoutName={name}
            onClose={() => setPreviewOpen(false)}
          />
        )}

        <Dialog open={!!pendingDiscard} onOpenChange={(open) => !open && setPendingDiscard(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription className="text-[13px]">
                “{name}” has blocks that have not been saved. Continuing drops them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingDiscard(null)}>
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const run = pendingDiscard;
                  setPendingDiscard(null);
                  run?.();
                }}
              >
                Discard changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </WidgetDataProvider>
  );
}
