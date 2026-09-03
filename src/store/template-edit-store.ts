import { create } from "zustand";
import type { TemplateContent } from "@/lib/dashboard/types";
import { createGridEditSlice, type GridEditState } from "@/store/grid-edit-store";

// Edit state for the master template editor — a third instance of the shared
// grid-edit slice (see `grid-edit-store.ts`). One store serves both kinds of
// master (dashboard and report) because only one of them is ever open at a
// time, and dashboard and report templates hold the identical content shape.

export const useTemplateEditStore = create<GridEditState<TemplateContent>>((set) =>
  createGridEditSlice<TemplateContent>(set)
);
