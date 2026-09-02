import { create } from "zustand";
import type { ReportLayoutConfig } from "@/lib/dashboard/types";
import { createGridEditSlice, type GridEditState } from "@/store/grid-edit-store";

// Edit state for the report builder's canvas — a second instance of the shared
// grid-edit slice (see `grid-edit-store.ts`). It needs nothing beyond that: the
// layout being edited is held by the reports view, not by the store, because
// the editor is opened for one layout at a time.

export const useReportLayoutStore = create<GridEditState<ReportLayoutConfig>>((set) =>
  createGridEditSlice<ReportLayoutConfig>(set)
);
