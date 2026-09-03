import { create } from "zustand";
import type { DashboardConfig } from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { createGridEditSlice, type GridEditState } from "@/store/grid-edit-store";

// The dashboard's edit state: the shared grid-edit slice (draft/dirty/add/
// remove/resize — see `grid-edit-store.ts`) plus the one thing that is
// dashboard-only, the per-client view selection.

export type { NewWidgetSpec, WidgetLinkChange } from "@/store/grid-edit-store";

interface DashboardEditState extends GridEditState<DashboardConfig> {
  /**
   * Which saved view the dashboard shows, PER CLIENT. A missing entry (or
   * `null`) = that client's default view, resolved server-side. Keyed by client
   * so switching clients yields the new client's own selection during render —
   * no effect, so no request ever goes out with client B and a view id from A.
   */
  selectedViewByClient: Record<string, string | null>;
  selectView: (clientId: string | null, id: string | null) => void;
  /**
   * Whether the master dashboard template is being edited instead of a view.
   * Lives here rather than in the dashboard component because the editor
   * REPLACES it: react-grid-layout 2.x measures its container in a mount-only
   * effect, so the grid has to unmount and remount around the editor to be
   * measured again (see `dashboard-view.tsx`).
   */
  editingMasterTemplate: boolean;
  setEditingMasterTemplate: (open: boolean) => void;
}

export const useDashboardStore = create<DashboardEditState>((set) => ({
  ...createGridEditSlice<DashboardConfig>(set),

  selectedViewByClient: {},

  // Switching views drops any in-progress edit — the draft belongs to the view
  // that was open when editing started.
  selectView: (clientId, id) =>
    set((s) => ({
      selectedViewByClient: clientId
        ? { ...s.selectedViewByClient, [clientId]: id }
        : s.selectedViewByClient,
      editMode: false,
      draft: null,
      isDirty: false,
    })),

  editingMasterTemplate: false,

  // Opening the template editor drops any in-progress edit — the draft belongs
  // to the view, not to the template.
  setEditingMasterTemplate: (open) =>
    set(
      open
        ? { editingMasterTemplate: true, editMode: false, draft: null, isDirty: false }
        : { editingMasterTemplate: false }
    ),
}));

export function emptyDashboard(name = "My Dashboard"): DashboardConfig {
  return {
    id: null,
    name,
    visibility: "internal",
    isDefault: false,
    version: DASHBOARD_CONFIG_VERSION,
    widgets: [],
    layouts: { lg: [], md: [], sm: [] },
  };
}
