"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./dashboard-grid.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  BREAKPOINTS,
  GRID_COLS,
  GRID_BREAKPOINTS,
  GRID_ROW_HEIGHT,
  GRID_MARGIN,
  GRID_CONTAINER_PADDING,
  WIDGET_SIZE_WIDTH,
  type Breakpoint,
  type GridItem,
  type WidgetSizeKey,
  type DashboardConfig,
  type DashboardLayouts,
  type SavedWidget,
  type WidgetInstance,
} from "@/lib/dashboard/types";
import { chartDefaultSize, getWidget } from "@/lib/dashboard/widget-registry";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WidgetDataProvider } from "@/lib/dashboard/widget-data";
import { WidgetCatalogDialog } from "@/components/dashboard/widget-catalog-dialog";
import {
  BuilderAssistant,
  type BuilderApplyResult,
  type BuilderInsertResult,
} from "@/components/dashboard/builder-assistant";
import { normalizeCustomConfig } from "@/lib/dashboard/custom-widget";
import {
  isBuilderWidgetType,
  type BuilderWidgetType,
} from "@/lib/builder/widget-kinds";
import { WIDGET_META } from "@/lib/dashboard/widget-meta";
import type { BuilderWidgetRef } from "@/lib/builder/protocol";
import { SaveWidgetDialog } from "@/components/dashboard/save-widget-dialog";
import { DashboardViewSwitcher } from "@/components/dashboard/dashboard-view-switcher";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Mirrors MAX_INVENTORY_WIDGETS in the builder route's request schema. */
const MAX_BUILDER_INVENTORY = 40;

/** What one Builder change did to the view: how it persisted, and to which widget. */
interface AppliedChange {
  state: BuilderInsertResult;
  /** The instance the change touched; null when it could not be applied. */
  id: string | null;
}

const NOT_APPLIED: AppliedChange = { state: "failed", id: null };

/**
 * A widget's layout item on every breakpoint. Captured before a Builder change
 * removes or resizes the widget, so an undo can put back the exact footprint —
 * position included, which re-placing the widget would lose.
 */
function layoutSnapshot(
  layouts: DashboardLayouts,
  i: string
): Partial<Record<Breakpoint, GridItem>> {
  const snapshot: Partial<Record<Breakpoint, GridItem>> = {};
  for (const bp of BREAKPOINTS) {
    const item = layouts[bp]?.find((it) => it.i === i);
    if (item) snapshot[bp] = { ...item };
  }
  return snapshot;
}

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
  // The view as the Builder Assistant last saved it. A second widget in the same
  // assistant turn is built on this rather than on `saved`, whose query-cache
  // update may not have re-rendered yet — otherwise widget 1 would be dropped.
  const builderSavedRef = useRef<DashboardConfig | null>(null);
  // The widget "Edit with AI" pinned in the Builder panel. Null = the assistant
  // builds new widgets unless the user names one.
  const [builderTargetId, setBuilderTargetId] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [savingToLibraryId, setSavingToLibraryId] = useState<string | null>(null);
  // New widgets land at the bottom of the grid, usually below the fold — track
  // the last-added id so we can scroll it into view and flash it once rendered.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

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

  // Anything else that writes the cache (a manual save, a view switch) makes the
  // builder's copy stale, so it stops being used as a base.
  useEffect(() => {
    if (builderSavedRef.current && builderSavedRef.current !== saved) {
      builderSavedRef.current = null;
    }
  }, [saved]);

  /**
   * Footprint for a widget the assistant produced: the type's natural size —
   * per chart shape for the `custom` builder, the registry default for every
   * other type — with the width overridden when the assistant asked for one of
   * the four size words the config dialog also offers.
   */
  const builderSize = useCallback(
    (type: BuilderWidgetType, widgetConfig: Record<string, unknown>, size?: WidgetSizeKey) => {
      const natural =
        type === "custom"
          ? chartDefaultSize(normalizeCustomConfig(widgetConfig).visualization)
          : WIDGET_META[type].defaultSize;
      return size ? { ...natural, w: WIDGET_SIZE_WIDTH[size] } : natural;
    },
    []
  );

  /**
   * The view the next Builder change lands on — the open edit draft, else the
   * copy the Builder last saved, else the server's. Resolved exactly the way
   * `applyBuilderChange` resolves it, so a "before" snapshot taken here is of
   * what the change is about to mutate.
   */
  const builderBase = useCallback(
    (): DashboardConfig | null => {
      const store = useDashboardStore.getState();
      if (store.editMode && store.draft) return store.draft;
      return builderSavedRef.current ?? saved ?? null;
    },
    [saved]
  );

  /**
   * Runs one Builder Assistant change against the view and reports how it
   * persisted. Inside an open edit session the change joins the draft (the user
   * saves as usual); otherwise a throwaway begin/mutate/end batch runs
   * synchronously — the grid never flips into edit mode on screen — and the
   * result is saved immediately, so "created" means created and saved.
   *
   * `mutate` returns the instance id it touched, or null when it could not be
   * applied (a target that vanished between the request and the response).
   * `highlight` is off for a removal — there is nothing left to scroll to.
   */
  const applyBuilderChange = useCallback(
    async (mutate: () => string | null, highlight = true): Promise<AppliedChange> => {
      const store = useDashboardStore.getState();

      if (store.editMode && store.draft) {
        const id = mutate();
        if (!id) return NOT_APPLIED;
        if (highlight) setJustAddedId(id);
        return { state: "draft", id };
      }

      const base = builderSavedRef.current ?? saved;
      if (!base) return NOT_APPLIED;
      store.beginEdit(base);
      const id = mutate();
      const pending = useDashboardStore.getState().draft;
      store.endEdit();
      if (!id || !pending) return NOT_APPLIED;

      try {
        builderSavedRef.current = await saveDashboard.mutateAsync(pending);
        if (highlight) setJustAddedId(id);
        return { state: "saved", id };
      } catch {
        // Clear the mutation's error so the edit toolbar doesn't later show a
        // stale "Failed to save layout" for a failure the panel already owns.
        saveDashboard.reset();
        return NOT_APPLIED;
      }
    },
    [saved, saveDashboard]
  );

  // An undo is pressed long after the change that produced it, so it must not
  // close over the `applyBuilderChange` of that render: that one still holds the
  // view (and the save mutation) that was open back then.
  const applyRef = useRef(applyBuilderChange);
  useEffect(() => {
    applyRef.current = applyBuilderChange;
  }, [applyBuilderChange]);

  // What the Builder is pointed at right now. A change (or an undo) captured
  // under another client or view refuses instead of landing on the wrong one.
  // Keyed on the SELECTION, not on `config.id`: saving a view that had never
  // been saved gives it an id, and that must not invalidate the undo of the
  // very change that saved it.
  const builderScope = `${clientId ?? ""}:${selectedViewId ?? "default"}`;
  const builderScopeRef = useRef(builderScope);
  useEffect(() => {
    builderScopeRef.current = builderScope;
  }, [builderScope]);

  const runUndo = useCallback(
    async (
      scope: string,
      mutate: () => string | null,
      highlight = true
    ): Promise<BuilderInsertResult> => {
      if (builderScopeRef.current !== scope) return "failed";
      const { state } = await applyRef.current(mutate, highlight);
      return state;
    },
    []
  );

  /** New widget: the catalog's exact add path, sized for its type. */
  const handleBuilderWidget = useCallback(
    async (
      type: BuilderWidgetType,
      widgetConfig: Record<string, unknown>,
      size?: WidgetSizeKey
    ): Promise<BuilderApplyResult> => {
      // The panel's in-flight turn closed over this handler, so it can be the
      // one from before a client or view switch. Applying it now would insert
      // into the view the user has left (or, in an open edit, into the draft of
      // the one they moved to), so a stale scope reports failure instead.
      if (builderScopeRef.current !== builderScope) return { state: "failed" };
      const { state, id } = await applyBuilderChange(() => {
        const spec: NewWidgetSpec = {
          type,
          defaultSize: builderSize(type, widgetConfig, size),
          defaultConfig: { ...widgetConfig },
        };
        return useDashboardStore.getState().addWidget(spec);
      });
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(
            builderScope,
            () => {
              const store = useDashboardStore.getState();
              if (!store.draft?.widgets.some((w) => w.i === id)) return null;
              store.removeWidget(id);
              return id;
            },
            false
          ),
      };
    },
    [applyBuilderChange, builderScope, builderSize, runUndo]
  );

  /**
   * Existing widget: replace its config in place. The footprint only moves when
   * the assistant asked for a size or a chart changed shape — otherwise a
   * widget the user has hand-resized would snap back on every small edit, and
   * the undo would have a footprint to put back that never moved.
   */
  const handleBuilderUpdate = useCallback(
    async (
      widgetId: string,
      type: BuilderWidgetType,
      widgetConfig: Record<string, unknown>,
      size?: WidgetSizeKey
    ): Promise<BuilderApplyResult> => {
      if (builderScopeRef.current !== builderScope) return { state: "failed" };
      const base = builderBase();
      const before = base?.widgets.find((w) => w.i === widgetId);
      const reshaped =
        type === "custom" &&
        !!before &&
        normalizeCustomConfig(before.config).visualization !==
          normalizeCustomConfig(widgetConfig).visualization;
      const resized = !!before && (!!size || reshaped);
      const beforeItems = resized && base ? layoutSnapshot(base.layouts, widgetId) : {};

      const { state, id } = await applyBuilderChange(() => {
        const store = useDashboardStore.getState();
        const current = store.draft?.widgets.find((w) => w.i === widgetId);
        // The panel only offers ids the server took from this view, but the view
        // can change under an in-flight request, so the target is re-checked —
        // including that it is still the same type the config was written for.
        if (!current || current.type !== type || current.savedWidgetId) return null;

        store.updateWidgetConfig(widgetId, { ...widgetConfig });
        // A new chart shape owns its whole footprint, so the height goes with
        // it. A plain "make it full width" is a WIDTH change only — the same
        // thing the config dialog's size picker does — because the height may
        // have been dragged to what the user wanted and is not ours to reset.
        if (reshaped) store.setWidgetSize(widgetId, builderSize(type, widgetConfig, size));
        else if (size) store.resizeWidget(widgetId, WIDGET_SIZE_WIDTH[size]);
        return widgetId;
      });
      if (!id || !before) return { state };

      return {
        state,
        undo: () =>
          runUndo(builderScope, () => {
            const store = useDashboardStore.getState();
            if (!store.draft?.widgets.some((w) => w.i === widgetId)) return null;
            store.restoreWidget(before, beforeItems);
            return widgetId;
          }),
      };
    },
    [applyBuilderChange, builderBase, builderScope, builderSize, runUndo]
  );

  /**
   * Existing widget, deleted. The instance and its layout item on every
   * breakpoint are captured first: an undo restores those, because re-adding
   * the widget would drop it wherever the grid has room now.
   */
  const handleBuilderRemove = useCallback(
    async (widgetId: string): Promise<BuilderApplyResult> => {
      if (builderScopeRef.current !== builderScope) return { state: "failed" };
      const base = builderBase();
      const before = base?.widgets.find((w) => w.i === widgetId);
      if (!base || !before) return { state: "failed" };
      const beforeItems = layoutSnapshot(base.layouts, widgetId);

      const { state, id } = await applyBuilderChange(() => {
        const store = useDashboardStore.getState();
        if (!store.draft?.widgets.some((w) => w.i === widgetId)) return null;
        store.removeWidget(widgetId);
        return widgetId;
      }, false);
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(builderScope, () => {
            useDashboardStore.getState().restoreWidget(before, beforeItems);
            return widgetId;
          }),
      };
    },
    [applyBuilderChange, builderBase, builderScope, runUndo]
  );

  /**
   * What the assistant is allowed to change. A widget is editable only if the
   * builder has a schema for its type (BUILDER_WIDGET_TYPES) AND it is not
   * linked to the saved-widget library — a linked instance stores no inline
   * config (the library row owns it), so an inline rewrite would be stripped on
   * save and silently lost. The route re-checks the config against that
   * schema and may still demote it.
   */
  const builderWidgets: BuilderWidgetRef[] = useMemo(() => {
    if (!config) return [];
    // Capped to the route's inventory limit — a view longer than this loses its
    // tail as an edit target rather than 400ing the whole request.
    return config.widgets.slice(0, MAX_BUILDER_INVENTORY).map((w) => {
      const def = getWidget(w.type);
      // The title the grid prints, so the user can name a widget by what they see.
      const title = def?.getTitle ? def.getTitle(w.config) : def?.title ?? w.type;
      if (!isBuilderWidgetType(w.type)) {
        return {
          i: w.i,
          title,
          type: w.type,
          locked: `it is a "${def?.title ?? w.type}" widget, which the builder cannot configure`,
        };
      }
      if (w.savedWidgetId) {
        return { i: w.i, title, type: w.type, locked: "it is linked to the saved widget library" };
      }
      // A chart is normalized first so the model always sees a complete config;
      // the fixed types are sent as stored and validated server-side.
      const current: Record<string, unknown> =
        w.type === "custom" ? { ...normalizeCustomConfig(w.config) } : w.config;
      return { i: w.i, title, type: w.type, config: current };
    });
  }, [config]);

  /** Pins a widget as the assistant's edit target and opens the panel. */
  const handleEditWithAi = useCallback(
    (i: string) => {
      setBuilderTargetId(i);
      setBuilderOpen(true);
    },
    [setBuilderOpen]
  );

  // Derived rather than cleared in an effect (the repo's lint rejects setState
  // in an effect body): a pinned widget that is gone — removed, or the view or
  // client switched — simply stops being the target.
  const builderTarget =
    builderTargetId && builderWidgets.some((w) => w.i === builderTargetId) ? builderTargetId : null;

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
                    beginEdit({
                      ...buildDefaultDashboard(config.name),
                      id: config.id,
                      visibility: config.visibility,
                      isDefault: config.isDefault,
                    })
                  }
                  title="Reset to the default layout"
                >
                  <BiReset className="w-4 h-4" /> Reset
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
                      canEdit && isBuilderWidgetType(w.type) && !w.savedWidgetId
                        ? handleEditWithAi
                        : undefined
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
            widgets={builderWidgets}
            targetWidgetId={builderTarget}
            onTargetChange={setBuilderTargetId}
            onCreateWidget={handleBuilderWidget}
            onUpdateWidget={handleBuilderUpdate}
            onRemoveWidget={handleBuilderRemove}
          />
        )}
      </div>
    </WidgetDataProvider>
  );
}
