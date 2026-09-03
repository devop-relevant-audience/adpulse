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
import { BiArrowBack, BiCheck, BiGridAlt, BiPlus, BiShow, BiX } from "react-icons/bi";
import { LuSparkles } from "react-icons/lu";
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
import { BuilderAssistant } from "@/components/dashboard/builder-assistant";
import { WidgetCatalogDialog } from "@/components/dashboard/widget-catalog-dialog";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";
import { SaveWidgetDialog } from "@/components/dashboard/save-widget-dialog";
import { ReportPreviewDialog } from "@/components/reports/report-preview-dialog";
import { WidgetDataProvider } from "@/lib/dashboard/widget-data";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { useSelectedClient } from "@/hooks/use-selected-client";
import { useMasterTemplate, useSaveTemplateContent } from "@/hooks/use-templates";
import {
  useMasterReportTemplate,
  useSaveReportTemplateContent,
} from "@/hooks/use-report-templates";
import { useTemplateEditStore } from "@/store/template-edit-store";
import { useBuilderGrid } from "@/hooks/use-builder-grid";
import { useAppStore } from "@/store/app-store";
import type { NewWidgetSpec } from "@/store/grid-edit-store";
import {
  GRID_BREAKPOINTS,
  GRID_COLS,
  GRID_CONTAINER_PADDING,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  type DashboardLayouts,
  type SavedWidget,
  type TemplateContent,
  type WidgetInstance,
} from "@/lib/dashboard/types";

// The master template's canvas: the house dashboard and the house report, edited
// with the same grid vocabulary as a client's own view or layout. Always in edit
// mode, one at a time (see `template-edit-store.ts`).
//
// Widgets render LIVE against whichever client is selected — the registry's
// hooks read the app store — so the editor is a preview of the template's shape,
// not of any one client's numbers. The banner says so.

/** Editing width of the report page. Matches the generated report's document width. */
const PAGE_MAX_WIDTH = 880;

// The report grid is PINNED to `lg`/12 columns whatever the page measures — see
// the long note in `report-layout-editor.tsx`: the page's content box is under
// GRID_BREAKPOINTS.lg, so RGL would otherwise write every drag into `layouts.md`
// and the report renderer, which draws `lg` only, would discard them.
const REPORT_BREAKPOINTS = { lg: 0 };
const REPORT_COLS = { lg: GRID_COLS.lg };

export function MasterTemplateEditor({
  kind,
  clientId,
  onBack,
}: {
  kind: "dashboard" | "report";
  clientId: string;
  onBack: () => void;
}) {
  const isReport = kind === "report";
  // Both hook sets are called unconditionally (rules of hooks); only the one
  // matching `kind` fetches, and the other mutation is inert until used.
  const dashboardMaster = useMasterTemplate(!isReport);
  const reportMaster = useMasterReportTemplate(isReport);
  const saveDashboardContent = useSaveTemplateContent();
  const saveReportContent = useSaveReportTemplateContent();

  const { data: saved, isLoading, isError, refetch } = isReport ? reportMaster : dashboardMaster;
  const saveContent = isReport ? saveReportContent : saveDashboardContent;

  const client = useSelectedClient();
  const { width, containerRef } = useContainerWidth();
  // The assistant shares the fixed right-hand slot (and the <main> push) with
  // the AI chat panel, so its open state lives in the app store, which keeps
  // the two mutually exclusive.
  const isBuilderOpen = useAppStore((s) => s.isBuilderOpen);
  const setBuilderOpen = useAppStore((s) => s.setBuilderOpen);

  const draft = useTemplateEditStore((s) => s.draft);
  const isDirty = useTemplateEditStore((s) => s.isDirty);
  const beginEdit = useTemplateEditStore((s) => s.beginEdit);
  const cancelEdit = useTemplateEditStore((s) => s.cancelEdit);
  const setLayouts = useTemplateEditStore((s) => s.setLayouts);
  const addWidget = useTemplateEditStore((s) => s.addWidget);
  const duplicateWidget = useTemplateEditStore((s) => s.duplicateWidget);
  const removeWidget = useTemplateEditStore((s) => s.removeWidget);
  const updateWidgetConfig = useTemplateEditStore((s) => s.updateWidgetConfig);
  const linkWidget = useTemplateEditStore((s) => s.linkWidget);
  const resizeWidget = useTemplateEditStore((s) => s.resizeWidget);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [savingToLibraryId, setSavingToLibraryId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // Set to the action waiting on a "discard unsaved changes?" answer.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Seed the draft once per template. Guarded on the STORE's draft, not a ref:
  // StrictMode re-runs effects after their cleanup (which clears the draft), and
  // a ref would still say "done" — leaving the skeleton up forever. A background
  // refetch changes `saved` but the draft for this template already exists, so
  // unsaved edits are never re-seeded away.
  useEffect(() => {
    if (!saved) return;
    const current = useTemplateEditStore.getState().draft;
    if (current && current.id === saved.id) return;
    beginEdit(saved);
  }, [saved, beginEdit]);

  // The draft belongs to this editor session, so leaving drops it.
  useEffect(() => () => cancelEdit(), [cancelEdit]);

  // The panel only exists inside this editor, so leaving must drop the flag too
  // — otherwise <main> keeps its margin with nothing in the slot.
  useEffect(() => () => setBuilderOpen(false), [setBuilderOpen]);

  // Scroll a freshly added widget into view. RGL renders a new item one commit
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

  // The Builder Assistant, pointed at the master template rather than at one
  // client's grid — the prompt says so, so it builds for every client instead of
  // pinning the template to this one's campaigns. No `save`: this editor is
  // ALWAYS inside an edit session, so an assistant change joins the draft and
  // lands with the Save button like every other edit.
  const builder = useBuilderGrid<TemplateContent>({
    store: useTemplateEditStore,
    surface: isReport ? "report" : "dashboard",
    config: draft,
    saved,
    // One master per kind, so the kind is the whole identity; the client rides
    // along because it is the data the tools read.
    scope: `${clientId}:master-${kind}`,
    onHighlight: setJustAddedId,
    onOpenPanel: () => setBuilderOpen(true),
  });

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

  // The report grid only ever edits `lg` (see REPORT_BREAKPOINTS), so its
  // `md`/`sm` are taken straight from the draft — the store keeps them in step
  // on add and resize, and the PUT schema requires all three arrays.
  function handleLayoutChange(_current: Layout, all: ResponsiveLayouts) {
    const cur = useTemplateEditStore.getState().draft?.layouts;
    setLayouts({
      lg: [...(all.lg ?? cur?.lg ?? [])] as DashboardLayouts["lg"],
      md: [...((isReport ? cur?.md : all.md ?? cur?.md) ?? [])] as DashboardLayouts["md"],
      sm: [...((isReport ? cur?.sm : all.sm ?? cur?.sm) ?? [])] as DashboardLayouts["sm"],
    });
  }

  /** Answers whether the save landed, so callers can chain on it. */
  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    try {
      // Re-seed the draft from what the SERVER stored: linked widgets come back
      // hydrated, and the save is then no longer dirty.
      const stored = await saveContent.mutateAsync({
        id: draft.id,
        layouts: draft.layouts,
        widgets: draft.widgets,
        version: draft.version,
      });
      beginEdit(stored);
      return true;
    } catch {
      // The failure is rendered from the mutation's own error state; the draft
      // stays dirty so the user can retry.
      return false;
    }
  }

  // The preview renders the SAVED template, so unsaved blocks have to land first
  // — a failed save keeps the dialog shut and leaves the error line to explain.
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

  const name = draft?.name ?? saved?.name ?? (isReport ? "Master report" : "Master dashboard");
  const clientLabel = client?.name ? `${client.name}’s` : "the selected client’s";

  const grid = !draft ? (
    <Skeleton className="h-[400px] w-full rounded-xl" />
  ) : draft.widgets.length === 0 ? (
    <div className="border border-dashed border-hairline rounded-xl py-16 grid place-items-center text-center">
      {isReport ? (
        <BiPlus className="w-8 h-8 text-ink-faint mb-3" />
      ) : (
        <BiGridAlt className="w-8 h-8 text-ink-faint mb-3" />
      )}
      <p className="text-sm font-medium text-ink">
        This master {isReport ? "report" : "dashboard"} is empty
      </p>
      <p className="text-xs text-ink-muted mt-1 mb-4">
        {isReport
          ? "Start with a cover block, then add the metrics every report should carry."
          : "Add the widgets every client should see out of the box."}
      </p>
      <div className="flex items-center justify-center gap-2">
        <Button size="sm" onClick={() => setCatalogOpen(true)}>
          <BiPlus className="w-4 h-4" /> {isReport ? "Add block" : "Add widget"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
          <LuSparkles className="w-4 h-4" /> Builder Assistant
        </Button>
      </div>
    </div>
  ) : (
    <ResponsiveGridLayout
      className="layout"
      width={width}
      layouts={draft.layouts as unknown as ResponsiveLayouts}
      breakpoints={isReport ? REPORT_BREAKPOINTS : GRID_BREAKPOINTS}
      cols={isReport ? REPORT_COLS : GRID_COLS}
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
            onEditWithAi={builder.canEditWithAi(w) ? builder.editWithAi : undefined}
          />
        </div>
      ))}
    </ResponsiveGridLayout>
  );

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
              <p className="text-[12px] text-ink-muted">
                Master {isReport ? "report" : "dashboard"} template
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatalogOpen(true)}
              disabled={!draft}
            >
              <BiPlus className="w-4 h-4" /> {isReport ? "Add block" : "Add widget"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBuilderOpen(true)}
              disabled={!draft}
            >
              <LuSparkles className="w-4 h-4" /> Builder Assistant
            </Button>
            {isReport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handlePreview()}
                disabled={!draft || saveContent.isPending}
              >
                <BiShow className="w-4 h-4" /> {isDirty ? "Save & preview" : "Preview"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => withDirtyGuard(revertToSaved)}
              disabled={!draft || !isDirty || saveContent.isPending}
            >
              <BiX className="w-4 h-4" /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!draft || !isDirty || saveContent.isPending}
            >
              <BiCheck className="w-4 h-4" /> {saveContent.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {saveContent.isError && (
          <p role="alert" className="text-[12px] text-destructive">
            {saveContent.error instanceof Error
              ? saveContent.error.message
              : "Failed to save the template"}
          </p>
        )}

        {isError && !isLoading && (
          <QueryError
            onRetry={() => refetch()}
            message={`Couldn't load the master ${isReport ? "report" : "dashboard"} template`}
          />
        )}

        <p className="text-[12px] text-ink-muted rounded-lg border border-hairline bg-canvas-soft px-3 py-2">
          You’re editing the master {isReport ? "report" : "dashboard"} template. Every new client
          and every new {isReport ? "report layout" : "view"} starts from it. Existing{" "}
          {isReport ? "layouts" : "views"} are not changed. Data shown is {clientLabel}, for
          preview only.
        </p>

        {/* The measured div must be mounted on the very first render: RGL 2.x's
            `useContainerWidth` attaches its observer in a mount effect only, so
            loading, empty and populated states all live INSIDE it. */}
        {isReport ? (
          <div
            className="mx-auto w-full rounded-xl border border-hairline bg-white p-6 shadow-sm"
            style={{ maxWidth: PAGE_MAX_WIDTH }}
          >
            <div ref={containerRef}>{grid}</div>
          </div>
        ) : (
          <div ref={containerRef}>{grid}</div>
        )}

        <WidgetCatalogDialog
          open={catalogOpen}
          onOpenChange={setCatalogOpen}
          onAdd={handleAddWidget}
          onAddSaved={handleAddSavedWidget}
          surface={isReport ? "report" : "dashboard"}
        />
        <WidgetConfigDialog
          instance={configuring}
          currentWidth={configuringWidth}
          currentViewId={draft?.id ?? null}
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

        {/* Stays mounted so the thread survives closing the panel. Reaching this
            editor at all is agency-only (both template APIs are), so there is no
            role check to repeat here. */}
        <BuilderAssistant
          open={isBuilderOpen}
          onOpenChange={setBuilderOpen}
          gridKind={isReport ? "report-template" : "dashboard-template"}
          clientId={clientId}
          viewId={`master-${kind}`}
          viewName={name}
          widgets={builder.widgets}
          targetWidgetId={builder.targetWidgetId}
          onTargetChange={builder.setTargetWidgetId}
          onCreateWidget={builder.onCreateWidget}
          onUpdateWidget={builder.onUpdateWidget}
          onRemoveWidget={builder.onRemoveWidget}
          onResizeWidget={builder.onResizeWidget}
          onArrangeWidgets={builder.onArrangeWidgets}
        />

        {previewOpen && draft && (
          <ReportPreviewDialog
            clientId={clientId}
            source={{ kind: "template", id: draft.id }}
            name={name}
            onClose={() => setPreviewOpen(false)}
          />
        )}

        <Dialog open={!!pendingDiscard} onOpenChange={(open) => !open && setPendingDiscard(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription className="text-[13px]">
                “{name}” has changes that have not been saved. Continuing drops them.
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
