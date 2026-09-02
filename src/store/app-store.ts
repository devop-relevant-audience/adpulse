import { create } from "zustand";
import { format, subDays } from "date-fns";
import type { Platform } from "@/lib/types/database";
import type { CompareMode } from "@/lib/dashboard/date-presets";

export const VIEWS = {
  dashboard: "dashboard",
  pacing: "pacing",
  funnel: "funnel",
  attribution: "attribution",
  health: "health",
  creatives: "creatives",
  alerts: "alerts",
  compare: "compare",
  reports: "reports",
  team: "team",
} as const;

export type ViewId = (typeof VIEWS)[keyof typeof VIEWS];

export interface ComparisonCampaignSummary {
  name: string;
  platform: string;
  spend: number;
  conversions: number;
  cpa: number;
  ctr: number;
  cpc: number;
  impressions: number;
  clicks: number;
}

export interface ReferenceContext {
  campaignId?: string;
  campaignName?: string;
  platform?: Platform;
  metric?: string;
  dateRange?: { start: string; end: string };
  value?: number;
  comparisonType?: "campaigns" | "periods";
  comparisonCampaigns?: ComparisonCampaignSummary[];
  comparisonPeriods?: {
    periodA: { start: string; end: string; label: string };
    periodB: { start: string; end: string; label: string };
    metrics: Record<string, { a: number; b: number; delta: number }>;
  };
}

interface AppState {
  selectedClientId: string | null;
  dateRange: { start: string; end: string };
  compareMode: CompareMode;
  selectedPlatform: Platform | undefined;
  referenceContext: ReferenceContext | null;
  /**
   * The two right-hand panels share one fixed slot (and the <main> margin that
   * pushes the page aside), so at most one is ever open: every setter below
   * closes the other.
   */
  isChatOpen: boolean;
  isBuilderOpen: boolean;

  setSelectedClientId: (id: string) => void;
  setDateRange: (range: { start: string; end: string }) => void;
  setCompareMode: (mode: CompareMode) => void;
  setSelectedPlatform: (platform: Platform | undefined) => void;
  setReferenceContext: (ctx: ReferenceContext | null) => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setBuilderOpen: (open: boolean) => void;
}

// 30 days ending yesterday — presets never include today's partial data.
function getDefaultDateRange() {
  const today = new Date();
  return {
    start: format(subDays(today, 30), "yyyy-MM-dd"),
    end: format(subDays(today, 1), "yyyy-MM-dd"),
  };
}

export const useAppStore = create<AppState>((set) => ({
  selectedClientId: null,
  dateRange: getDefaultDateRange(),
  compareMode: "none",
  selectedPlatform: undefined,
  referenceContext: null,
  isChatOpen: false,
  isBuilderOpen: false,

  setSelectedClientId: (id) => set({ selectedClientId: id }),
  setDateRange: (range) => set({ dateRange: range }),
  setCompareMode: (mode) => set({ compareMode: mode }),
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  setReferenceContext: (ctx) =>
    set({ referenceContext: ctx, isChatOpen: true, isBuilderOpen: false }),
  toggleChat: () =>
    set((s) => (s.isChatOpen ? { isChatOpen: false } : { isChatOpen: true, isBuilderOpen: false })),
  setChatOpen: (open) => set(open ? { isChatOpen: true, isBuilderOpen: false } : { isChatOpen: false }),
  setBuilderOpen: (open) =>
    set(open ? { isBuilderOpen: true, isChatOpen: false } : { isBuilderOpen: false }),
}));
