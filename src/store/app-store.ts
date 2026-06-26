import { create } from "zustand";
import { format, subDays } from "date-fns";
import type { Platform } from "@/lib/types/database";

export const VIEWS = {
  dashboard: "dashboard",
  anomalies: "anomalies",
  pacing: "pacing",
  funnel: "funnel",
  optimizer: "optimizer",
  health: "health",
  creatives: "creatives",
  alerts: "alerts",
  compare: "compare",
  reports: "reports",
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
  selectedPlatform: Platform | undefined;
  referenceContext: ReferenceContext | null;
  isChatOpen: boolean;
  activeView: ViewId;

  setSelectedClientId: (id: string) => void;
  setDateRange: (range: { start: string; end: string }) => void;
  setSelectedPlatform: (platform: Platform | undefined) => void;
  setReferenceContext: (ctx: ReferenceContext | null) => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setActiveView: (view: ViewId) => void;
}

function getDefaultDateRange() {
  const today = new Date();
  return {
    start: format(subDays(today, 30), "yyyy-MM-dd"),
    end: format(today, "yyyy-MM-dd"),
  };
}

export const useAppStore = create<AppState>((set) => ({
  selectedClientId: null,
  dateRange: getDefaultDateRange(),
  selectedPlatform: undefined,
  referenceContext: null,
  isChatOpen: false,
  activeView: VIEWS.dashboard,

  setSelectedClientId: (id) => set({ selectedClientId: id }),
  setDateRange: (range) => set({ dateRange: range }),
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  setReferenceContext: (ctx) => set({ referenceContext: ctx, isChatOpen: true }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setChatOpen: (open) => set({ isChatOpen: open }),
  setActiveView: (view) => set({ activeView: view }),
}));
