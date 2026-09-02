import type {
  DashboardLayouts,
  GridItem,
  WidgetInstance,
  WidgetType,
} from "@/lib/dashboard/types";
import type { Breakpoint } from "@/lib/dashboard/types";
import { BREAKPOINTS, GRID_COLS } from "@/lib/dashboard/types";

// The generic "editing a widget grid" slice, shared by the dashboard store and
// the report-layout store. Both edit the same vocabulary (widget instances +
// react-grid-layout layouts), so the add/remove/resize/link behaviour lives
// here once and each store adds only what is genuinely its own (the dashboard's
// per-client view selection, for instance).

/** A column span is written on every breakpoint, so it must fit the narrow ones. */
function clampWidth(w: number, bp: Breakpoint): number {
  return Math.max(1, Math.min(w, GRID_COLS[bp]));
}

/**
 * Where a new item of width `w` goes on one breakpoint's grid.
 *
 * Skyline placement: each column carries the bottom edge of whatever already
 * occupies it, and the item takes the window of `w` columns whose deepest
 * column is highest up (leftmost wins a tie). Adding three narrow widgets in a
 * row therefore lines them up side by side instead of stacking each one under
 * the last, which is what `x: 0, y: bottom` used to do.
 *
 * The result is also where react-grid-layout's vertical compaction would settle
 * the item anyway, so nothing jumps after the add.
 */
function placeItem(existing: GridItem[], w: number, cols: number): { x: number; y: number } {
  const columnBottom = new Array<number>(cols).fill(0);
  for (const it of existing) {
    const from = Math.max(0, it.x);
    const to = Math.min(cols, it.x + it.w);
    for (let c = from; c < to; c++) {
      columnBottom[c] = Math.max(columnBottom[c], it.y + it.h);
    }
  }

  let best = { x: 0, y: Number.POSITIVE_INFINITY };
  for (let x = 0; x + w <= cols; x++) {
    let y = 0;
    for (let c = x; c < x + w; c++) y = Math.max(y, columnBottom[c]);
    if (y < best.y) best = { x, y };
  }
  return Number.isFinite(best.y) ? best : { x: 0, y: 0 };
}

// A widget definition, minus the React bits — passed in by the catalog so this
// store never imports the (client-only) widget registry.
export interface NewWidgetSpec {
  type: WidgetType;
  defaultSize: { w: number; h: number; minW: number; minH: number };
  defaultConfig: Record<string, unknown>;
  /** Set when adding from the saved widget library — links the new instance. */
  savedWidgetId?: string;
}

/**
 * How a config edit relates to the saved widget library, if the instance is
 * linked. Both live on the DRAFT instance only:
 *
 * - `syncToLibrary: true` — "update everywhere": the flag rides along on the
 *   dashboard PUT, which writes the config back to the library row. It is
 *   transient (never stored, never served), so cancelling the edit reverts the
 *   library write too — it never happened.
 * - `savedWidgetId: null` — "create a copy": the instance is unlinked and keeps
 *   the config inline from here on.
 */
export interface WidgetLinkChange {
  savedWidgetId?: string | null;
  syncToLibrary?: boolean;
}

/** What every editable grid config carries — a dashboard view, a report layout. */
export interface GridEditableConfig {
  widgets: WidgetInstance[];
  layouts: DashboardLayouts;
}

export interface GridEditState<TConfig extends GridEditableConfig> {
  editMode: boolean;
  /** Working copy while editing; null when viewing (render the saved config). */
  draft: TConfig | null;
  isDirty: boolean;

  beginEdit: (config: TConfig) => void;
  cancelEdit: () => void;
  endEdit: () => void;
  setLayouts: (layouts: DashboardLayouts) => void;
  /** Adds the widget to the draft and returns its new instance id. */
  addWidget: (spec: NewWidgetSpec) => string;
  /**
   * Copies an existing draft widget (config + library link) and returns the new
   * instance id, or null when there is nothing to copy.
   */
  duplicateWidget: (i: string) => string | null;
  removeWidget: (i: string) => void;
  /**
   * Puts a widget back exactly as it was — same config, same footprint on the
   * breakpoints given. Used to undo a Builder Assistant removal or resize:
   * re-adding through `addWidget` would put it wherever there is room now, not
   * where it was. An id already in the draft is replaced, not duplicated.
   */
  restoreWidget: (
    widget: WidgetInstance,
    items: Partial<Record<Breakpoint, GridItem>>
  ) => void;
  updateWidgetConfig: (
    i: string,
    config: Record<string, unknown>,
    link?: WidgetLinkChange
  ) => void;
  /** Link a draft instance to a library entry (after "Save to library"). */
  linkWidget: (i: string, savedWidgetId: string) => void;
  resizeWidget: (i: string, w: number) => void;
  /**
   * Replaces a widget's whole footprint (width, height and minimums), unlike
   * `resizeWidget` which only sets the column span. Used when a widget CHANGES
   * SHAPE — the Builder Assistant turning a number into a table — because the
   * old height belongs to the old chart type.
   */
  setWidgetSize: (i: string, size: { w: number; h: number; minW: number; minH: number }) => void;
}

/**
 * The subset of zustand's `set` this slice needs. Narrower than the host
 * store's own setter, so a store whose state extends `GridEditState` can pass
 * its `set` straight in.
 */
type GridSetter<TConfig extends GridEditableConfig> = (
  partial:
    | Partial<GridEditState<TConfig>>
    | ((state: GridEditState<TConfig>) => Partial<GridEditState<TConfig>>)
) => void;

function clone<TConfig extends GridEditableConfig>(config: TConfig): TConfig {
  return JSON.parse(JSON.stringify(config)) as TConfig;
}

function newId(type: WidgetType): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${type}-${rand}`;
}

/** Builds the shared slice against a host store's `set`. */
export function createGridEditSlice<TConfig extends GridEditableConfig>(
  set: GridSetter<TConfig>
): GridEditState<TConfig> {
  return {
    editMode: false,
    draft: null,
    isDirty: false,

    beginEdit: (config) => set({ editMode: true, draft: clone(config), isDirty: false }),
    cancelEdit: () => set({ editMode: false, draft: null, isDirty: false }),
    endEdit: () => set({ editMode: false, draft: null, isDirty: false }),

    setLayouts: (layouts) =>
      set((s) => (s.draft ? { draft: { ...s.draft, layouts }, isDirty: true } : s)),

    addWidget: (spec) => {
      const i = newId(spec.type);
      set((s) => {
        if (!s.draft) return s;
        const widgets = [
          ...s.draft.widgets,
          {
            i,
            type: spec.type,
            config: { ...spec.defaultConfig },
            ...(spec.savedWidgetId ? { savedWidgetId: spec.savedWidgetId } : {}),
          },
        ];

        // Fit the new item into the first free slot of each breakpoint, beside
        // what is already there when it fits (see placeItem).
        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          const existing = s.draft.layouts[bp] ?? [];
          const w = clampWidth(spec.defaultSize.w, bp);
          const { x, y } = placeItem(existing, w, GRID_COLS[bp]);
          const item: GridItem = {
            i,
            x,
            y,
            w,
            h: spec.defaultSize.h,
            minW: Math.min(spec.defaultSize.minW, GRID_COLS[bp]),
            minH: spec.defaultSize.minH,
          };
          layouts[bp] = [...existing, item];
        }
        return { draft: { ...s.draft, widgets, layouts }, isDirty: true };
      });
      return i;
    },

    duplicateWidget: (i) => {
      let created: string | null = null;
      set((s) => {
        if (!s.draft) return s;
        const src = s.draft.widgets.find((w) => w.i === i);
        if (!src) return s;

        const copyId = newId(src.type);
        created = copyId;
        // The copy keeps the library link (both instances then render the same
        // library row), but never the transient "write back to the library" flag.
        const copy: WidgetInstance = {
          i: copyId,
          type: src.type,
          config: JSON.parse(JSON.stringify(src.config)) as Record<string, unknown>,
          ...(src.savedWidgetId ? { savedWidgetId: src.savedWidgetId } : {}),
        };
        const at = s.draft.widgets.findIndex((w) => w.i === i);
        const widgets = [
          ...s.draft.widgets.slice(0, at + 1),
          copy,
          ...s.draft.widgets.slice(at + 1),
        ];

        // Same size, directly below the original in every breakpoint (RGL pushes
        // the rest down and compacts up).
        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          const existing = s.draft.layouts[bp] ?? [];
          const srcItem = existing.find((it) => it.i === i);
          const item: GridItem = srcItem
            ? { ...srcItem, i: copyId, y: srcItem.y + srcItem.h }
            : {
                i: copyId,
                x: 0,
                y: existing.reduce((m, it) => Math.max(m, it.y + it.h), 0),
                w: bp === "lg" ? 6 : bp === "md" ? 4 : 4,
                h: 4,
                minW: 2,
                minH: 2,
              };
          layouts[bp] = [...existing, item];
        }
        return { draft: { ...s.draft, widgets, layouts }, isDirty: true };
      });
      return created;
    },

    removeWidget: (i) =>
      set((s) => {
        if (!s.draft) return s;
        const widgets = s.draft.widgets.filter((w) => w.i !== i);
        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          layouts[bp] = (s.draft.layouts[bp] ?? []).filter((it) => it.i !== i);
        }
        return { draft: { ...s.draft, widgets, layouts }, isDirty: true };
      }),

    restoreWidget: (widget, items) =>
      set((s) => {
        if (!s.draft) return s;
        const exists = s.draft.widgets.some((w) => w.i === widget.i);
        const widgets = exists
          ? s.draft.widgets.map((w) => (w.i === widget.i ? widget : w))
          : [...s.draft.widgets, widget];

        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          const existing = s.draft.layouts[bp] ?? [];
          const item = items[bp];
          if (!item) {
            layouts[bp] = existing;
            continue;
          }
          layouts[bp] = existing.some((it) => it.i === widget.i)
            ? existing.map((it) => (it.i === widget.i ? item : it))
            : [...existing, item];
        }
        return { draft: { ...s.draft, widgets, layouts }, isDirty: true };
      }),

    updateWidgetConfig: (i, config, link) =>
      set((s) => {
        if (!s.draft) return s;
        const widgets = s.draft.widgets.map((w) => {
          if (w.i !== i) return w;
          const next: WidgetInstance = { ...w, config };
          if (link?.savedWidgetId === null) {
            delete next.savedWidgetId;
            delete next.syncToLibrary;
          } else if (link?.savedWidgetId) {
            next.savedWidgetId = link.savedWidgetId;
          }
          if (next.savedWidgetId && link?.syncToLibrary) next.syncToLibrary = true;
          return next;
        });
        return { draft: { ...s.draft, widgets }, isDirty: true };
      }),

    linkWidget: (i, savedWidgetId) =>
      set((s) => {
        if (!s.draft) return s;
        const widgets = s.draft.widgets.map((w) => (w.i === i ? { ...w, savedWidgetId } : w));
        return { draft: { ...s.draft, widgets }, isDirty: true };
      }),

    resizeWidget: (i, w) =>
      set((s) => {
        if (!s.draft) return s;
        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          layouts[bp] = (s.draft.layouts[bp] ?? []).map((it) =>
            it.i === i ? { ...it, w: clampWidth(w, bp) } : it
          );
        }
        return { draft: { ...s.draft, layouts }, isDirty: true };
      }),

    setWidgetSize: (i, size) =>
      set((s) => {
        if (!s.draft) return s;
        const layouts = { ...s.draft.layouts };
        for (const bp of BREAKPOINTS) {
          layouts[bp] = (s.draft.layouts[bp] ?? []).map((it) =>
            it.i === i
              ? {
                  ...it,
                  w: clampWidth(size.w, bp),
                  h: size.h,
                  minW: Math.min(size.minW, GRID_COLS[bp]),
                  minH: size.minH,
                }
              : it
          );
        }
        return { draft: { ...s.draft, layouts }, isDirty: true };
      }),
  };
}
