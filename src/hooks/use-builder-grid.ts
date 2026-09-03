"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeCustomConfig } from "@/lib/dashboard/custom-widget";
import { chartDefaultSize, getWidget } from "@/lib/dashboard/widget-registry";
import { WIDGET_META } from "@/lib/dashboard/widget-meta";
import { isBuilderWidgetType, type BuilderWidgetType } from "@/lib/builder/widget-kinds";
import type { BuilderWidgetRef } from "@/lib/builder/protocol";
import type {
  BuilderApplyResult,
  BuilderInsertResult,
  BuilderWidgetSize,
} from "@/components/dashboard/builder-assistant";
import {
  BREAKPOINTS,
  WIDGET_HEIGHT_ROWS,
  WIDGET_SIZE_WIDTH,
  type Breakpoint,
  type DashboardLayouts,
  type GridItem,
  type GridSurface,
  type WidgetInstance,
  type WidgetType,
} from "@/lib/dashboard/types";
import type { GridEditState, GridEditableConfig, NewWidgetSpec } from "@/store/grid-edit-store";

// Everything the Builder Assistant needs to act on ONE widget grid, wired once
// for all four of them: a client's dashboard view, a client's report layout, the
// master dashboard template and the master report template.
//
// The four differ in exactly two ways, both passed in:
//
// 1. WHICH STORE holds the draft (`store`) and HOW a change persists (`save`).
//    A dashboard view is normally NOT in edit mode, so a change there runs a
//    throwaway begin/mutate/end batch and saves immediately — "created" means
//    created and saved. The report and template editors are always inside an
//    open edit session with a Save button of their own, so they pass no `save`
//    and a change simply joins the draft the user is already editing.
// 2. WHICH SURFACE the grid is (`surface`), which decides what the assistant may
//    configure — a cover block is editable on a report, unknown on a dashboard.
//
// Everything else — the inventory it is shown, the undo of each kind of change,
// the scope check that stops a late response landing on the grid the user has
// since left — is identical, and lives here.

/** Mirrors MAX_INVENTORY_WIDGETS in the builder route's request schema. */
const MAX_BUILDER_INVENTORY = 40;

/** What one Builder change did to the grid: how it persisted, and to which widget. */
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

/**
 * `current` with every widget that ALSO existed in `before` put back exactly
 * where it was. Used to undo an arrangement, which moves the widgets asked for
 * AND everything the new row pushed down, so no per-widget snapshot covers it.
 *
 * Merging rather than replacing wholesale matters because an undo can be
 * pressed after other changes: a widget added since the snapshot keeps its slot
 * instead of losing its layout item, and one deleted since is not resurrected.
 */
function mergeLayouts(current: DashboardLayouts, before: DashboardLayouts): DashboardLayouts {
  const merged = {} as DashboardLayouts;
  for (const bp of BREAKPOINTS) {
    const restored = new Map((before[bp] ?? []).map((it) => [it.i, it]));
    merged[bp] = (current[bp] ?? []).map((it) => restored.get(it.i) ?? it);
  }
  return merged;
}

/**
 * A widget's natural footprint — per chart shape for the `custom` builder, the
 * registry default for every other type. Also the source of the MINIMUMS a
 * resize is held to: layout items saved before those minimums existed (the
 * built-in presets among them) carry none of their own, so a floor read off the
 * item would be 1 and "make the trend chart compact" would squash it to nothing.
 */
function naturalFootprint(type: WidgetType, config: Record<string, unknown>) {
  return type === "custom"
    ? chartDefaultSize(normalizeCustomConfig(config).visualization)
    : WIDGET_META[type].defaultSize;
}

/**
 * The assistant's size WORDS as raw grid units, held to the widget type's own
 * minimums. Only the dimensions it actually named come back, so a height-only
 * request leaves a hand-dragged width alone.
 */
function gridSize(
  size: BuilderWidgetSize,
  floor: { minW: number; minH: number }
): { w?: number; h?: number } {
  return {
    ...(size.width ? { w: Math.max(floor.minW, WIDGET_SIZE_WIDTH[size.width]) } : {}),
    ...(size.height ? { h: Math.max(floor.minH, WIDGET_HEIGHT_ROWS[size.height]) } : {}),
  };
}

/**
 * The bit of a zustand grid-edit store this hook uses. Narrower than any of the
 * three stores, so each can be passed straight in.
 */
interface GridStoreHandle<TConfig extends GridEditableConfig> {
  getState: () => GridEditState<TConfig>;
}

export interface UseBuilderGridOptions<TConfig extends GridEditableConfig> {
  /** The store holding this grid's edit draft. */
  store: GridStoreHandle<TConfig>;
  /** Which grid this is, for what the assistant may configure. */
  surface: GridSurface;
  /** What the grid renders right now — the draft while editing, else the saved row. */
  config: TConfig | null | undefined;
  /**
   * The saved row. Only read when a change arrives with NO edit session open,
   * which is the dashboard case; the always-editing surfaces can leave it out.
   */
  saved?: TConfig | null;
  /**
   * Persists a change made outside an edit session. Absent = this surface is
   * always inside one (the report and template editors), so changes join the
   * draft and the user saves them with everything else.
   */
  save?: (config: TConfig) => Promise<TConfig>;
  /** Clears a failed save's error state, so the toolbar doesn't show a stale one. */
  resetSave?: () => void;
  /**
   * Identity of what is open — client + view/layout/template. A change (or an
   * undo) captured under another scope refuses rather than landing on the wrong
   * grid.
   */
  scope: string;
  /** Scroll-and-flash a widget a change touched. */
  onHighlight?: (i: string) => void;
  /** Opens the assistant panel, for "Edit with AI" on a widget. */
  onOpenPanel?: () => void;
}

export interface UseBuilderGrid {
  /** The inventory to hand the panel: what is on the grid, and what may change. */
  widgets: BuilderWidgetRef[];
  /** The pinned edit target, or null once it is gone from the grid. */
  targetWidgetId: string | null;
  setTargetWidgetId: (i: string | null) => void;
  /** Pins a widget as the assistant's target and opens the panel. */
  editWithAi: (i: string) => void;
  /** Whether a widget may be pinned at all — the same rule the inventory applies. */
  canEditWithAi: (widget: WidgetInstance) => boolean;
  /** The five change handlers, as `BuilderAssistant` takes them. */
  onCreateWidget: (
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: BuilderWidgetSize
  ) => Promise<BuilderApplyResult>;
  onUpdateWidget: (
    widgetId: string,
    type: BuilderWidgetType,
    config: Record<string, unknown>,
    size?: BuilderWidgetSize
  ) => Promise<BuilderApplyResult>;
  onRemoveWidget: (widgetId: string) => Promise<BuilderApplyResult>;
  onResizeWidget: (widgetId: string, size: BuilderWidgetSize) => Promise<BuilderApplyResult>;
  onArrangeWidgets: (widgetIds: string[]) => Promise<BuilderApplyResult>;
}

export function useBuilderGrid<TConfig extends GridEditableConfig>({
  store,
  surface,
  config,
  saved,
  save,
  resetSave,
  scope,
  onHighlight,
  onOpenPanel,
}: UseBuilderGridOptions<TConfig>): UseBuilderGrid {
  // The grid as the Builder last saved it. A second widget in the same assistant
  // turn is built on this rather than on `saved`, whose query-cache update may
  // not have re-rendered yet — otherwise widget 1 would be dropped. Unused on a
  // surface that never saves on its own (`save` absent).
  const builderSavedRef = useRef<TConfig | null>(null);
  // The widget "Edit with AI" pinned in the panel. Null = the assistant builds
  // new widgets unless the user names one.
  const [targetWidgetId, setTargetWidgetId] = useState<string | null>(null);

  const highlight = useCallback((i: string) => onHighlight?.(i), [onHighlight]);

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
    (type: BuilderWidgetType, widgetConfig: Record<string, unknown>, size?: BuilderWidgetSize) => {
      const natural = naturalFootprint(type, widgetConfig);
      return {
        ...natural,
        ...(size?.width ? { w: WIDGET_SIZE_WIDTH[size.width] } : {}),
        // A height word can ask for less than the type's own minimum (a trend
        // chart has nowhere to draw at 3 rows), so the minimum wins — the same
        // floor the grid enforces on a hand-drag.
        ...(size?.height ? { h: Math.max(natural.minH, WIDGET_HEIGHT_ROWS[size.height]) } : {}),
      };
    },
    []
  );

  /**
   * The grid the next Builder change lands on — the open edit draft, else the
   * copy the Builder last saved, else the server's. Resolved exactly the way
   * `applyChange` resolves it, so a "before" snapshot taken here is of what the
   * change is about to mutate.
   */
  const builderBase = useCallback((): TConfig | null => {
    const state = store.getState();
    if (state.editMode && state.draft) return state.draft;
    return builderSavedRef.current ?? saved ?? null;
  }, [saved, store]);

  /**
   * Runs one Builder Assistant change against the grid and reports how it
   * persisted. Inside an open edit session the change joins the draft (the user
   * saves as usual); otherwise a throwaway begin/mutate/end batch runs
   * synchronously — the grid never flips into edit mode on screen — and the
   * result is saved immediately, so "created" means created and saved.
   *
   * `mutate` returns the instance id it touched, or null when it could not be
   * applied (a target that vanished between the request and the response).
   * `flash` is off for a removal — there is nothing left to scroll to.
   */
  const applyChange = useCallback(
    async (mutate: () => string | null, flash = true): Promise<AppliedChange> => {
      const state = store.getState();

      if (state.editMode && state.draft) {
        const id = mutate();
        if (!id) return NOT_APPLIED;
        if (flash) highlight(id);
        return { state: "draft", id };
      }

      // No edit session open. A surface with no `save` of its own has nowhere
      // to put the change: it is always meant to be inside one, so a change
      // arriving before the draft is seeded is refused rather than lost.
      if (!save) return NOT_APPLIED;

      const base = builderSavedRef.current ?? saved;
      if (!base) return NOT_APPLIED;
      state.beginEdit(base);
      const id = mutate();
      const pending = store.getState().draft;
      state.endEdit();
      if (!id || !pending) return NOT_APPLIED;

      try {
        builderSavedRef.current = await save(pending);
        if (flash) highlight(id);
        return { state: "saved", id };
      } catch {
        // Clear the mutation's error so the edit toolbar doesn't later show a
        // stale "Failed to save" for a failure the panel already owns.
        resetSave?.();
        return NOT_APPLIED;
      }
    },
    [highlight, resetSave, save, saved, store]
  );

  // An undo is pressed long after the change that produced it, so it must not
  // close over the `applyChange` of that render: that one still holds the grid
  // (and the save mutation) that was open back then.
  const applyRef = useRef(applyChange);
  useEffect(() => {
    applyRef.current = applyChange;
  }, [applyChange]);

  // What the Builder is pointed at right now. A change (or an undo) captured
  // under another client, view or template refuses instead of landing on the
  // wrong one. Keyed on the SELECTION, not on `config.id`: saving a view that
  // had never been saved gives it an id, and that must not invalidate the undo
  // of the very change that saved it.
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const runUndo = useCallback(
    async (at: string, mutate: () => string | null, flash = true): Promise<BuilderInsertResult> => {
      if (scopeRef.current !== at) return "failed";
      const { state } = await applyRef.current(mutate, flash);
      return state;
    },
    []
  );

  /** New widget: the catalog's exact add path, sized for its type. */
  const onCreateWidget = useCallback(
    async (
      type: BuilderWidgetType,
      widgetConfig: Record<string, unknown>,
      size?: BuilderWidgetSize
    ): Promise<BuilderApplyResult> => {
      // The panel's in-flight turn closed over this handler, so it can be the
      // one from before a client, view or template switch. Applying it now would
      // insert into the grid the user has left (or, in an open edit, into the
      // draft of the one they moved to), so a stale scope reports failure.
      if (scopeRef.current !== scope) return { state: "failed" };
      const { state, id } = await applyChange(() => {
        const spec: NewWidgetSpec = {
          type,
          defaultSize: builderSize(type, widgetConfig, size),
          defaultConfig: { ...widgetConfig },
        };
        return store.getState().addWidget(spec);
      });
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(
            scope,
            () => {
              const s = store.getState();
              if (!s.draft?.widgets.some((w) => w.i === id)) return null;
              s.removeWidget(id);
              return id;
            },
            false
          ),
      };
    },
    [applyChange, builderSize, runUndo, scope, store]
  );

  /**
   * Existing widget: replace its config in place. The footprint only moves when
   * the assistant asked for a size or a chart changed shape — otherwise a
   * widget the user has hand-resized would snap back on every small edit, and
   * the undo would have a footprint to put back that never moved.
   */
  const onUpdateWidget = useCallback(
    async (
      widgetId: string,
      type: BuilderWidgetType,
      widgetConfig: Record<string, unknown>,
      size?: BuilderWidgetSize
    ): Promise<BuilderApplyResult> => {
      if (scopeRef.current !== scope) return { state: "failed" };
      const base = builderBase();
      const before = base?.widgets.find((w) => w.i === widgetId);
      const reshaped =
        type === "custom" &&
        !!before &&
        normalizeCustomConfig(before.config).visualization !==
          normalizeCustomConfig(widgetConfig).visualization;
      const resized = !!before && (!!size?.width || !!size?.height || reshaped);
      const beforeItems = resized && base ? layoutSnapshot(base.layouts, widgetId) : {};

      const { state, id } = await applyChange(() => {
        const s = store.getState();
        const current = s.draft?.widgets.find((w) => w.i === widgetId);
        // The panel only offers ids the server took from this grid, but the grid
        // can change under an in-flight request, so the target is re-checked —
        // including that it is still the same type the config was written for.
        if (!current || current.type !== type || current.savedWidgetId) return null;

        s.updateWidgetConfig(widgetId, { ...widgetConfig });
        // A new chart shape owns its whole footprint, so the height goes with
        // it. A plain "make it full width" is a WIDTH change only — the same
        // thing the config dialog's size picker does — because the height may
        // have been dragged to what the user wanted and is not ours to reset.
        if (reshaped) s.setWidgetSize(widgetId, builderSize(type, widgetConfig, size));
        else if (size) {
          s.setWidgetGeometry(
            widgetId,
            gridSize(size, naturalFootprint(current.type, current.config))
          );
        }
        return widgetId;
      });
      if (!id || !before) return { state };

      return {
        state,
        undo: () =>
          runUndo(scope, () => {
            const s = store.getState();
            if (!s.draft?.widgets.some((w) => w.i === widgetId)) return null;
            s.restoreWidget(before, beforeItems);
            return widgetId;
          }),
      };
    },
    [applyChange, builderBase, builderSize, runUndo, scope, store]
  );

  /**
   * Existing widget, deleted. The instance and its layout item on every
   * breakpoint are captured first: an undo restores those, because re-adding
   * the widget would drop it wherever the grid has room now.
   */
  const onRemoveWidget = useCallback(
    async (widgetId: string): Promise<BuilderApplyResult> => {
      if (scopeRef.current !== scope) return { state: "failed" };
      const base = builderBase();
      const before = base?.widgets.find((w) => w.i === widgetId);
      if (!base || !before) return { state: "failed" };
      const beforeItems = layoutSnapshot(base.layouts, widgetId);

      const { state, id } = await applyChange(() => {
        const s = store.getState();
        if (!s.draft?.widgets.some((w) => w.i === widgetId)) return null;
        s.removeWidget(widgetId);
        return widgetId;
      }, false);
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(scope, () => {
            store.getState().restoreWidget(before, beforeItems);
            return widgetId;
          }),
      };
    },
    [applyChange, builderBase, runUndo, scope, store]
  );

  /**
   * Existing widget, resized and nothing else. Works on ANY widget on the grid,
   * library-linked ones included: a footprint is stored on the layout, not in
   * the config the library row owns, so there is nothing here for a save to
   * strip. The undo restores the exact footprint on every breakpoint.
   */
  const onResizeWidget = useCallback(
    async (widgetId: string, size: BuilderWidgetSize): Promise<BuilderApplyResult> => {
      if (scopeRef.current !== scope) return { state: "failed" };
      const base = builderBase();
      const before = base?.widgets.find((w) => w.i === widgetId);
      if (!base || !before) return { state: "failed" };
      const beforeItems = layoutSnapshot(base.layouts, widgetId);

      const { state, id } = await applyChange(() => {
        const s = store.getState();
        const current = s.draft?.widgets.find((w) => w.i === widgetId);
        if (!current) return null;
        s.setWidgetGeometry(
          widgetId,
          gridSize(size, naturalFootprint(current.type, current.config))
        );
        return widgetId;
      });
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(scope, () => {
            const s = store.getState();
            if (!s.draft?.widgets.some((w) => w.i === widgetId)) return null;
            s.restoreWidget(before, beforeItems);
            return widgetId;
          }),
      };
    },
    [applyChange, builderBase, runUndo, scope, store]
  );

  /**
   * Widgets put side by side on one row. The WHOLE layout is the undo unit, not
   * the widgets named: the row also pushes down whatever was under it and the
   * grid then compacts everything upwards, so putting two footprints back would
   * leave the rest of the page where the row left it.
   */
  const onArrangeWidgets = useCallback(
    async (widgetIds: string[]): Promise<BuilderApplyResult> => {
      if (scopeRef.current !== scope) return { state: "failed" };
      const base = builderBase();
      if (!base) return { state: "failed" };
      const beforeLayouts = JSON.parse(JSON.stringify(base.layouts)) as DashboardLayouts;

      const { state, id } = await applyChange(() => {
        const s = store.getState();
        // The grid can change under an in-flight request, so the row is rebuilt
        // from the widgets that are still on it — and two of them are the least
        // that makes a row.
        const present = widgetIds.filter((i) => s.draft?.widgets.some((w) => w.i === i));
        if (present.length < 2) return null;
        return s.arrangeRow(present) ? present[0] : null;
      });
      if (!id) return { state };

      return {
        state,
        undo: () =>
          runUndo(scope, () => {
            const s = store.getState();
            if (!s.draft) return null;
            s.setLayouts(mergeLayouts(s.draft.layouts, beforeLayouts));
            return id;
          }),
      };
    },
    [applyChange, builderBase, runUndo, scope, store]
  );

  /**
   * Whether the assistant may rewrite this widget's settings: the builder needs
   * a schema for its type ON THIS SURFACE, and the instance must not be linked
   * to the saved-widget library — a linked instance stores no inline config (the
   * library row owns it), so an inline rewrite would be stripped on save and
   * silently lost.
   */
  const canEditWithAi = useCallback(
    (widget: WidgetInstance) =>
      isBuilderWidgetType(widget.type, surface) && !widget.savedWidgetId,
    [surface]
  );

  /**
   * What the assistant is shown. The route re-checks every config against the
   * same builder schema and may still demote one to read-only, so this is an
   * offer rather than a promise.
   */
  const widgets: BuilderWidgetRef[] = useMemo(() => {
    if (!config) return [];
    // Capped to the route's inventory limit — a grid longer than this loses its
    // tail as an edit target rather than 400ing the whole request.
    // Footprints come from the DESKTOP grid only: it is the one the user is
    // looking at (the report canvas edits nothing else), and the narrow
    // breakpoints are derived from the same resize or arrange request by the
    // store.
    const desktop = new Map((config.layouts?.lg ?? []).map((it) => [it.i, it]));
    return config.widgets.slice(0, MAX_BUILDER_INVENTORY).map((w) => {
      const def = getWidget(w.type);
      // The title the grid prints, so the user can name a widget by what they see.
      const title = def?.getTitle ? def.getTitle(w.config) : def?.title ?? w.type;
      // Sent for every widget, whatever the builder may do to its config: size
      // and position are changeable even when the settings are not.
      const item = desktop.get(w.i);
      const layout = item ? { layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : {};
      if (!isBuilderWidgetType(w.type, surface)) {
        return {
          i: w.i,
          title,
          type: w.type,
          ...layout,
          locked: `it is a "${def?.title ?? w.type}" widget, which the builder cannot configure`,
        };
      }
      if (w.savedWidgetId) {
        return {
          i: w.i,
          title,
          type: w.type,
          ...layout,
          locked: "it is linked to the saved widget library",
        };
      }
      // A chart is normalized first so the model always sees a complete config;
      // the fixed types are sent as stored and validated server-side.
      const current: Record<string, unknown> =
        w.type === "custom" ? { ...normalizeCustomConfig(w.config) } : w.config;
      return { i: w.i, title, type: w.type, ...layout, config: current };
    });
  }, [config, surface]);

  /** Pins a widget as the assistant's edit target and opens the panel. */
  const editWithAi = useCallback(
    (i: string) => {
      setTargetWidgetId(i);
      onOpenPanel?.();
    },
    [onOpenPanel]
  );

  // Derived rather than cleared in an effect (the repo's lint rejects setState
  // in an effect body): a pinned widget that is gone — removed, or the grid
  // switched — simply stops being the target.
  const target =
    targetWidgetId && widgets.some((w) => w.i === targetWidgetId) ? targetWidgetId : null;

  return {
    widgets,
    targetWidgetId: target,
    setTargetWidgetId,
    editWithAi,
    canEditWithAi,
    onCreateWidget,
    onUpdateWidget,
    onRemoveWidget,
    onResizeWidget,
    onArrangeWidgets,
  };
}
