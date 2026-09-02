import type { Platform } from "@/lib/types/database";

/**
 * Canonical chart + platform theming. Import from here instead of redefining
 * per-file color maps, so every chart, table, and legend agrees.
 */

// Platform brand identity colors (one canonical set — do not fork per-file).
export const PLATFORM_COLORS: Record<Platform, string> = {
  google: "#4285F4",
  meta: "#0668E1",
  tiktok: "#121212",
};

// Long labels for legends / tables where space allows.
export const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  tiktok: "TikTok Ads",
};

// Short labels for dense/space-constrained contexts.
export const PLATFORM_LABELS_SHORT: Record<Platform, string> = {
  google: "Google",
  meta: "Meta",
  tiktok: "TikTok",
};

/**
 * Categorical palette for arbitrary series identity (campaigns, metrics,
 * attribution models). Deliberately excludes red / green / amber, which are
 * reserved for good/bad status signaling below — so a series color never
 * reads as an alarm.
 *
 * Ten slots so a top-10 campaign breakdown gets distinct colors. Assign by
 * index in this fixed order (validated so consecutive entries stay apart for
 * normal vision); identity is always backed by a labeled legend + tooltip,
 * never color alone.
 */
export const SERIES_PALETTE = [
  "#2563eb", // blue
  "#db2777", // pink
  "#0d9488", // teal
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#c026d3", // fuchsia
  "#4f46e5", // indigo
  "#9d174d", // dark rose
  "#0e7490", // dark cyan
  "#a21caf", // dark fuchsia
];

// Semantic status colors — use ONLY to signal good / warning / bad.
export const STATUS_COLORS = {
  good: "#16a34a",
  warning: "#f59e0b",
  bad: "#dc2626",
} as const;

// Chart neutrals (grid lines, axis text) — token-aligned, readable.
export const CHART_GRID = "#e8e8e8"; // === --border / hairline
export const CHART_AXIS_TEXT = "#6b6b6b"; // === ink-muted, passes contrast
