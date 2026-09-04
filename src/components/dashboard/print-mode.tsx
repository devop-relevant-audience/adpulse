"use client";

// "Is this tree being rendered for paper?" — one flag, read by the leaf
// presentational components that have to behave differently in a PDF.
//
// Two things need it and neither is worth threading a prop through every call
// site for: Recharts animates its series over ~1.5s (a PDF captured mid-animation
// draws half a chart), and the tables render inside their own scroll container
// (which would clip every row past the fold instead of flowing onto page two).
//
// Default false, so nothing outside the print page changes: the dashboard and
// the on-screen ViewReport render with no provider and keep their behaviour.

import { createContext, useContext } from "react";

const PrintModeContext = createContext(false);

export function PrintModeProvider({ children }: { children: React.ReactNode }) {
  return <PrintModeContext.Provider value={true}>{children}</PrintModeContext.Provider>;
}

export function usePrintMode(): boolean {
  return useContext(PrintModeContext);
}

/** Recharts `isAnimationActive` — off on paper, on everywhere else. */
export function useChartAnimation(): boolean {
  return !useContext(PrintModeContext);
}
