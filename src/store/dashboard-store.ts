import { create } from "zustand";
import type {
  DashboardConfig,
  DashboardLayouts,
  GridItem,
  WidgetType,
} from "@/lib/dashboard/types";
import { BREAKPOINTS, DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";

// A widget definition, minus the React bits — passed in by the catalog so this
// store never imports the (client-only) widget registry.
export interface NewWidgetSpec {
  type: WidgetType;
  defaultSize: { w: number; h: number; minW: number; minH: number };
  defaultConfig: Record<string, unknown>;
}

interface DashboardEditState {
  editMode: boolean;
  /** Working copy while editing; null when viewing (render the saved config). */
  draft: DashboardConfig | null;
  isDirty: boolean;

  beginEdit: (config: DashboardConfig) => void;
  cancelEdit: () => void;
  endEdit: () => void;
  setLayouts: (layouts: DashboardLayouts) => void;
  /** Adds the widget to the draft and returns its new instance id. */
  addWidget: (spec: NewWidgetSpec) => string;
  removeWidget: (i: string) => void;
  updateWidgetConfig: (i: string, config: Record<string, unknown>) => void;
  resizeWidget: (i: string, w: number) => void;
}

function clone(config: DashboardConfig): DashboardConfig {
  return JSON.parse(JSON.stringify(config)) as DashboardConfig;
}

function newId(type: WidgetType): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${type}-${rand}`;
}

export const useDashboardStore = create<DashboardEditState>((set) => ({
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
      const widgets = [...s.draft.widgets, { i, type: spec.type, config: { ...spec.defaultConfig } }];

      // Drop the new item at the bottom of each breakpoint (RGL compacts up).
      const layouts = { ...s.draft.layouts };
      for (const bp of BREAKPOINTS) {
        const existing = s.draft.layouts[bp] ?? [];
        const maxY = existing.reduce((m, it) => Math.max(m, it.y + it.h), 0);
        const item: GridItem = {
          i,
          x: 0,
          y: maxY,
          w: spec.defaultSize.w,
          h: spec.defaultSize.h,
          minW: spec.defaultSize.minW,
          minH: spec.defaultSize.minH,
        };
        layouts[bp] = [...existing, item];
      }
      return { draft: { ...s.draft, widgets, layouts }, isDirty: true };
    });
    return i;
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

  updateWidgetConfig: (i, config) =>
    set((s) => {
      if (!s.draft) return s;
      const widgets = s.draft.widgets.map((w) => (w.i === i ? { ...w, config } : w));
      return { draft: { ...s.draft, widgets }, isDirty: true };
    }),

  resizeWidget: (i, w) =>
    set((s) => {
      if (!s.draft) return s;
      const layouts = { ...s.draft.layouts };
      for (const bp of BREAKPOINTS) {
        layouts[bp] = (s.draft.layouts[bp] ?? []).map((it) =>
          it.i === i ? { ...it, w: Math.min(w, bp === "lg" ? 12 : bp === "md" ? 8 : 4) } : it
        );
      }
      return { draft: { ...s.draft, layouts }, isDirty: true };
    }),
}));

export function emptyDashboard(name = "My Dashboard"): DashboardConfig {
  return {
    name,
    version: DASHBOARD_CONFIG_VERSION,
    widgets: [],
    layouts: { lg: [], md: [], sm: [] },
  };
}
