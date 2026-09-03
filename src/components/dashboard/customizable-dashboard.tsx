"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./dashboard-grid.css";

import { useEffect, useMemo, useState } from "react";
import type { NewWidgetSpec } from "@/store/dashboard-store";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { BiPencil, BiPlus, BiCheck, BiX, BiReset, BiGridAlt } from "react-icons/bi";
import { LuSparkles } from "react-icons/lu";
import { useAppStore } from "@/store/app-store";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAgencyRole } from "@/lib/auth/roles";
import { useDashboard, useDashboards, useSaveDashboard } from "@/hooks/use-dashboard";
import { useDashboardStore } from "@/store/dashboard-store";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { useMasterTemplate } from "@/hooks/use-templates";
import {
  GRID_COLS,
  GRID_BREAKPOINTS,
  GRID_ROW_HEIGHT,
  GRID_MARGIN,
  GRID_CONTAINER_PADDING,
  type DashboardConfig,
  type DashboardLayouts,
  type SavedWidget,
  type WidgetInstance,
} from "@/lib/dashboard/types";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WidgetDataProvider } from "@/lib/dashboard/widget-data";
import { WidgetCatalogDialog } from "@/components/dashboard/widget-catalog-dialog";
import { BuilderAssistant } from "@/components/dashboard/builder-assistant";
import { useBuilderGrid } from "@/hooks/use-builder-grid";
import { SaveWidgetDialog } from "@/components/dashboard/save-widget-dialog";
import { DashboardViewSwitcher } from "@/components/dashboard/dashboard-view-switcher";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";


export function CustomizableDashboard() {
  const clientId = useAppStore((s) => s.selectedClientId);
  // The Builder shares the fixed right-hand slot (and the <main> push) with the
  // AI chat panel, so its open state lives in the app store, which keeps the two
  // mutually exclusive.
  const isBuilderOpen = useAppStore((s) => s.isBuilderOpen);
  const setBuilderOpen = useAppStore((s) => s.setBuilderOpen);
  const { data: me } = useCurrentUser();
  // Editing the layout is agency-only (the dashboards PUT is agency-gated
  // server-side); a client_user gets the saved layout read-only.
  const canEdit = isAgencyRole(me?.profile.role);
  // RGL 2.x self-measures via this hook (WidthProvider was removed in 2.0).
  const { width, containerRef } = useContainerWidth();
  // A client owns many named views; `null` = whichever one is its default. The
  // selection is stored per client and read during render, so switching clients
  // never fires a request for client B with a view id belonging to client A.
  const selectedViewId = useDashboardStore((s) =>
    clientId ? s.selectedViewByClient[clientId] ?? null : null
  );
  const selectView = useDashboardStore((s) => s.selectView);
  const { data: views } = useDashboards(clientId);
  const { data: saved } = useDashboard(clientId, selectedViewId);
  const saveDashboard = useSaveDashboard(clientId, selectedViewId);

  const editMode = useDashboardStore((s) => s.editMode);
  const draft = useDashboardStore((s) => s.draft);
  const isDirty = useDashboardStore((s) => s.isDirty);
  const beginEdit = useDashboardStore((s) => s.beginEdit);
  const cancelEdit = useDashboardStore((s) => s.cancelEdit);
  const endEdit = useDashboardStore((s) => s.endEdit);
  const setLayouts = useDashboardStore((s) => s.setLayouts);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const duplicateWidget = useDashboardStore((s) => s.duplicateWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const updateWidgetConfig = useDashboardStore((s) => s.updateWidgetConfig);
  const linkWidget = useDashboardStore((s) => s.linkWidget);
  const resizeWidget = useDashboardStore((s) => s.resizeWidget);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [savingToLibraryId, setSavingToLibraryId] = useState<string | null>(null);
  // New widgets land at the bottom of the grid, usually below the fold — track
  // the last-added id so we can scroll it into view and flash it once rendered.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // Opening the master template editor unmounts this component (the swap lives
  // in `dashboard-view.tsx`, so each grid gets its own mount), hence a store
  // flag rather than local state. The master's content also backs Reset: it is
  // what a client with no saved view renders, so "the default layout" means the
  // master, with the built-in preset only the fallback until the fetch lands.
  const setEditingMasterTemplate = useDashboardStore((s) => s.setEditingMasterTemplate);
  const { data: master } = useMasterTemplate(canEdit);

  // The panel only exists on this view, so leaving it must drop the flag too —
  // otherwise <main> keeps its margin with nothing in the slot. Cleanup only,
  // so no setState runs during an effect body.
  useEffect(() => () => setBuilderOpen(false), [setBuilderOpen]);

  function handleAddWidget(spec: NewWidgetSpec) {
    setJustAddedId(addWidget(spec));
  }

  // A copy lands right below its original, which can still be off-screen on a
  // long dashboard — so it gets the same scroll-and-flash treatment.
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

  // Scroll the freshly added widget into view. RGL renders a new item one
  // commit after the draft updates (it mirrors layouts into internal state),
  // so the element may not exist yet when this effect first runs — retry
  // briefly. The flash class itself is applied declaratively via the
  // `highlight` prop on WidgetFrame, so RGL re-renders can't wipe it.
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

  // Leaving edit mode when the client changes avoids editing a stale draft. The
  // selection itself is per client, so it needs no reset here — and a selection
  // made earlier survives navigating away from /dashboard and back.
  useEffect(() => {
    cancelEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // A view deleted elsewhere (or unpublished) falls back to the default view.
  // `saved === null` is the same answer from the other direction: the GET came
  // back 404/403, so the selected view is gone or no longer visible.
  useEffect(() => {
    if (!selectedViewId) return;
    if (saved === null || (views && !views.some((v) => v.id === selectedViewId))) {
      selectView(clientId, null);
    }
  }, [views, saved, selectedViewId, selectView, clientId]);

  const config: DashboardConfig | null | undefined = editMode && draft ? draft : saved;

  // The Builder Assistant's whole change/undo/inventory apparatus, shared with
  // the report builder and the master template editors (see `use-builder-grid.ts`).
  // A dashboard view is usually NOT in edit mode, so a change made from the
  // panel is saved on the spot — hence `save`.
  const builder = useBuilderGrid<DashboardConfig>({
    store: useDashboardStore,
    surface: "dashboard",
    config,
    saved,
    save: (next) => saveDashboard.mutateAsync(next),
    resetSave: () => saveDashboard.reset(),
    // Keyed on the SELECTION, not on `config.id`: saving a view that had never
    // been saved gives it an id, and that must not invalidate the undo of the
    // very change that saved it.
    scope: `${clientId ?? ""}:${selectedViewId ?? "default"}`,
    onHighlight: setJustAddedId,
    onOpenPanel: () => setBuilderOpen(true),
  });

  const widgetsById = useMemo(() => {
    const m = new Map<string, WidgetInstance>();
    config?.widgets.forEach((w) => m.set(w.i, w));
    return m;
  }, [config]);

  const configuring = configuringId ? widgetsById.get(configuringId) ?? null : null;
  const savingToLibrary = savingToLibraryId ? widgetsById.get(savingToLibraryId) ?? null : null;
  const configuringWidth = configuring
    ? config?.layouts.lg.find((l) => l.i === configuring.i)?.w
    : undefined;

  function handleLayoutChange(_current: Layout, all: ResponsiveLayouts) {
    if (!editMode) return;
    const cur = useDashboardStore.getState().draft?.layouts;
    setLayouts({
      lg: [...(all.lg ?? cur?.lg ?? [])] as DashboardLayouts["lg"],
      md: [...(all.md ?? cur?.md ?? [])] as DashboardLayouts["md"],
      sm: [...(all.sm ?? cur?.sm ?? [])] as DashboardLayouts["sm"],
    });
  }

  async function handleSave() {
    if (draft) await saveDashboard.mutateAsync(draft);
    endEdit();
  }

  return (
    // The data provider spans the grid AND the dialogs: widgets publish their
    // rows here (see widget-data.tsx) so the view-mode menu can export them.
    <WidgetDataProvider>
      <div className={cn(editMode && "dash-editing")}>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap min-h-9">
          {config ? (
            <div className="flex items-center gap-2 min-w-0">
              <DashboardViewSwitcher
                clientId={clientId}
                views={views ?? []}
                current={config}
                canManage={canEdit}
                onEditMaster={() => {
                  // The draft and the Builder panel belong to this view, not to
                  // the template, so both are dropped on the way in.
                  cancelEdit();
                  setBuilderOpen(false);
                  setEditingMasterTemplate(true);
                }}
              />
              {editMode && (
                <span className="text-[11px] font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full shrink-0">
                  Editing
                </span>
              )}
            </div>
          ) : (
            <Skeleton className="h-6 w-40" />
          )}

          <div className="flex items-center gap-2">
            {!config ? (
              <Skeleton className="h-8 w-28" />
            ) : editMode ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
                  <BiPlus className="w-4 h-4" /> Add widget
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
                  <LuSparkles className="w-4 h-4" /> Builder Assistant
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    // Reset the widgets, not the view's identity — Save must still
                    // update THIS view rather than create a new row.
                    beginEdit(
                      master
                        ? {
                            ...config,
                            widgets: master.widgets,
                            layouts: master.layouts,
                            version: master.version,
                          }
                        : {
                            ...buildDefaultDashboard(config.name),
                            id: config.id,
                            visibility: config.visibility,
                            isDefault: config.isDefault,
                          }
                    )
                  }
                  title="Reset to the master dashboard template"
                >
                  <BiReset className="w-4 h-4" /> Reset to master
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <BiX className="w-4 h-4" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!isDirty || saveDashboard.isPending}>
                  <BiCheck className="w-4 h-4" /> {saveDashboard.isPending ? "Saving…" : "Save"}
                </Button>
                {saveDashboard.isError && (
                  <span role="alert" className="text-[12px] text-destructive">
                    {saveDashboard.error instanceof Error
                      ? saveDashboard.error.message
                      : "Failed to save layout"}
                  </span>
                )}
              </>
            ) : (
              canEdit && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
                    <LuSparkles className="w-4 h-4" /> Builder Assistant
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => beginEdit(config)}>
                    <BiPencil className="w-4 h-4" /> Customize
                  </Button>
                </>
              )
            )}
          </div>
        </div>

        {/* This wrapper is what `useContainerWidth` measures, and it must be in
            the tree on the very first render: the hook only looks for the node
            (and attaches its ResizeObserver) in a mount effect that never re-runs.
            Returning a skeleton instead of this div left the grid stuck at RGL's
            1280px default, so widgets came up narrower than the toolbar above. */}
        <div ref={containerRef}>
          {!config ? (
            <Skeleton className="h-[400px] w-full rounded-xl" />
          ) : config.widgets.length === 0 ? (
            <div className="border border-dashed border-hairline rounded-xl py-16 grid place-items-center text-center">
              <BiGridAlt className="w-8 h-8 text-ink-faint mb-3" />
              <p className="text-sm font-medium text-ink">This dashboard is empty</p>
              <p className="text-xs text-ink-muted mt-1 mb-4">
                {canEdit
                  ? "Add your first widget, or let the assistant build one for you."
                  : "No widgets have been configured yet."}
              </p>
              {canEdit && (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      // The catalog adds to the edit draft, so entering edit
                      // mode first makes the pick land somewhere.
                      if (!editMode) beginEdit(config);
                      setCatalogOpen(true);
                    }}
                  >
                    <BiPlus className="w-4 h-4" /> Add widget
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
                    <LuSparkles className="w-4 h-4" /> Builder Assistant
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <ResponsiveGridLayout
              className="layout"
              width={width}
              layouts={config.layouts as unknown as ResponsiveLayouts}
              breakpoints={GRID_BREAKPOINTS}
              cols={GRID_COLS}
              rowHeight={GRID_ROW_HEIGHT}
              margin={GRID_MARGIN}
              containerPadding={GRID_CONTAINER_PADDING}
              dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
              resizeConfig={{ enabled: editMode }}
              onLayoutChange={handleLayoutChange}
            >
              {config.widgets.map((w) => (
                <div key={w.i} data-widget-id={w.i}>
                  <WidgetFrame
                    instance={w}
                    editMode={editMode}
                    highlight={w.i === justAddedId}
                    onConfigure={setConfiguringId}
                    onRemove={removeWidget}
                    onSaveToLibrary={setSavingToLibraryId}
                    onDuplicate={handleDuplicateWidget}
                    onEditWithAi={
                      canEdit && builder.canEditWithAi(w) ? builder.editWithAi : undefined
                    }
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          )}
        </div>

        <WidgetCatalogDialog
          open={catalogOpen}
          onOpenChange={setCatalogOpen}
          onAdd={handleAddWidget}
          onAddSaved={handleAddSavedWidget}
        />
        <WidgetConfigDialog
          instance={configuring}
          currentWidth={configuringWidth}
          currentViewId={config?.id ?? null}
          open={!!configuringId}
          onOpenChange={(o) => !o && setConfiguringId(null)}
          onSave={(cfg, link) => configuring && updateWidgetConfig(configuring.i, cfg, link)}
          onResize={(w) => configuring && resizeWidget(configuring.i, w)}
        />
        <SaveWidgetDialog
          instance={savingToLibrary}
          open={!!savingToLibraryId}
          onOpenChange={(o) => !o && setSavingToLibraryId(null)}
          onSaved={(savedWidgetId) => savingToLibrary && linkWidget(savingToLibrary.i, savedWidgetId)}
        />
        {/* Stays mounted so the thread survives closing the panel; a client_user
            never gets it (the dashboards PUT behind it is agency-only). */}
        {canEdit && (
          <BuilderAssistant
            open={isBuilderOpen}
            onOpenChange={setBuilderOpen}
            clientId={clientId}
            dashboardId={config?.id ?? null}
            viewId={selectedViewId}
            viewName={config?.name}
            widgets={builder.widgets}
            targetWidgetId={builder.targetWidgetId}
            onTargetChange={builder.setTargetWidgetId}
            onCreateWidget={builder.onCreateWidget}
            onUpdateWidget={builder.onUpdateWidget}
            onRemoveWidget={builder.onRemoveWidget}
            onResizeWidget={builder.onResizeWidget}
            onArrangeWidgets={builder.onArrangeWidgets}
          />
        )}
      </div>
    </WidgetDataProvider>
  );
}
