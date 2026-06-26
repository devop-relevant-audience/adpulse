"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, FileText, Zap, MessageCircle } from "lucide-react";
import { ReportViewer } from "./report-viewer";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { ReportData } from "@/lib/report/builder";

interface SharedReportViewProps {
  token: string;
}

function safeObj<T>(val: unknown, fallback: T): T {
  if (val && typeof val === "object" && !Array.isArray(val)) return val as T;
  return fallback;
}

function safeArr<T>(val: unknown, fallback: T[]): T[] {
  if (Array.isArray(val)) return val as T[];
  return fallback;
}

function safeStr(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  return fallback;
}

function safeNum(val: unknown, fallback: number): number {
  if (typeof val === "number" && isFinite(val)) return val;
  return fallback;
}

const emptyComparison = {
  current: {
    totalImpressions: 0, totalClicks: 0, totalSpend: 0, totalConversions: 0,
    avgCtr: 0, avgCpc: 0, avgCpa: 0, avgCpm: 0,
  },
  previous: {
    totalImpressions: 0, totalClicks: 0, totalSpend: 0, totalConversions: 0,
    avgCtr: 0, avgCpc: 0, avgCpa: 0, avgCpm: 0,
  },
  deltas: {
    totalImpressions: { absolute: 0, percentage: 0 },
    totalClicks: { absolute: 0, percentage: 0 },
    totalSpend: { absolute: 0, percentage: 0 },
    totalConversions: { absolute: 0, percentage: 0 },
    avgCtr: { absolute: 0, percentage: 0 },
    avgCpc: { absolute: 0, percentage: 0 },
    avgCpa: { absolute: 0, percentage: 0 },
    avgCpm: { absolute: 0, percentage: 0 },
  },
};

const emptyTrend = {
  dailyData: [],
  bestDay: { date: "", conversions: 0, spend: 0 },
  worstDay: { date: "", conversions: 0, spend: 0 },
  avgDailySpend: 0,
  spendVolatility: 0,
};

const emptyHealth = {
  overallScore: 0, grade: "F" as const, subScores: [],
  insight: "", summary: {}, recommendations: [],
};

interface ParsedReport {
  data: ReportData;
  clientId: string | null;
}

function parseReportResponse(raw: Record<string, unknown>): ParsedReport {
  const ms = safeObj(raw.metricsSummary, {} as Record<string, unknown>);

  const comparison = safeObj(ms.comparison, emptyComparison);
  const rawNarratives = safeObj(ms.narratives, {} as Record<string, unknown>);
  const dateRange = safeObj(raw.dateRange, { start: "", end: "" }) as { start: string; end: string };
  const comparisonRange = safeObj(raw.comparisonRange, { start: "", end: "" }) as { start: string; end: string };

  const narratives = {
    executive: safeStr(rawNarratives.executive, "") || safeStr(raw.narrative, ""),
    trends: safeStr(rawNarratives.trends, ""),
    platforms: safeStr(rawNarratives.platforms, ""),
    funnel: safeStr(rawNarratives.funnel, ""),
    campaigns: safeStr(rawNarratives.campaigns, ""),
    health: safeStr(rawNarratives.health, ""),
    creatives: safeStr(rawNarratives.creatives, ""),
    optimizer: safeStr(rawNarratives.optimizer, ""),
    recommendations: safeStr(rawNarratives.recommendations, ""),
  };

  const trendRaw = safeObj(ms.trendSummary, emptyTrend);
  const trendSummary = {
    dailyData: safeArr(trendRaw.dailyData, []),
    bestDay: safeObj(trendRaw.bestDay, emptyTrend.bestDay),
    worstDay: safeObj(trendRaw.worstDay, emptyTrend.worstDay),
    avgDailySpend: safeNum(trendRaw.avgDailySpend, 0),
    spendVolatility: safeNum(trendRaw.spendVolatility, 0),
  };

  const healthRaw = safeObj(ms.healthScore, emptyHealth);
  const healthScore = {
    overallScore: safeNum(healthRaw.overallScore, 0),
    grade: safeStr(healthRaw.grade, "F"),
    subScores: safeArr(healthRaw.subScores, []),
    insight: safeStr(healthRaw.insight, ""),
    summary: safeObj(healthRaw.summary, {}),
    recommendations: safeArr(healthRaw.recommendations, []),
  };

  const emptyCreatives = {
    totalCreatives: 0, activeCount: 0, fatiguedCount: 0, pausedCount: 0,
    avgCtr: 0, avgCpa: 0, totalCreativeSpend: 0,
    byType: [], topPerformers: [], fatiguedCreatives: [],
  };
  const emptyOptimizer = {
    currentAllocation: {}, recommendedAllocation: {},
    platforms: [], suggestions: [], projectedImpact: { additionalConversions: 0, cpaReduction: 0 },
  };

  const data: ReportData = {
    id: safeStr(raw.id, undefined as unknown as string),
    clientName: safeStr(raw.title, "Client").replace(" — Performance Report", ""),
    dateRange,
    comparisonRange,
    generatedAt: new Date().toISOString(),
    comparison: comparison as ReportData["comparison"],
    trendSummary: trendSummary as ReportData["trendSummary"],
    platformBreakdown: safeArr(ms.platformBreakdown, []) as ReportData["platformBreakdown"],
    funnel: safeObj(ms.funnel, { overall: [], byPlatform: {} }) as ReportData["funnel"],
    campaignBreakdown: safeArr(ms.campaignBreakdown, []) as ReportData["campaignBreakdown"],
    healthScore: healthScore as unknown as ReportData["healthScore"],
    creatives: safeObj(ms.creatives, emptyCreatives) as ReportData["creatives"],
    optimizer: safeObj(ms.optimizer, emptyOptimizer) as ReportData["optimizer"],
    narratives,
  };

  return {
    data,
    clientId: typeof raw.clientId === "string" ? raw.clientId : null,
  };
}

export function SharedReportView({ token }: SharedReportViewProps) {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const isChatOpen = useAppStore((s) => s.isChatOpen);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const setSelectedClientId = useAppStore((s) => s.setSelectedClientId);
  const setDateRange = useAppStore((s) => s.setDateRange);

  async function handleAccess() {
    if (!password) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/reports/share?token=${encodeURIComponent(token)}&password=${encodeURIComponent(password)}`);

      if (res.status === 401) {
        setError("Invalid password. Please try again.");
        setIsLoading(false);
        return;
      }

      if (res.status === 404) {
        setError("This report link is invalid or has expired.");
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to access report");
      }

      const raw = await res.json();
      const parsed = parseReportResponse(raw);
      if (parsed.clientId) {
        setSelectedClientId(parsed.clientId);
      }
      if (parsed.data.dateRange.start && parsed.data.dateRange.end) {
        setDateRange(parsed.data.dateRange);
      }
      setReportData(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to access report");
    } finally {
      setIsLoading(false);
    }
  }

  if (reportData) {
    return (
      <div className="flex h-screen overflow-hidden bg-[#f8f7f6]">
        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden transition-[margin] duration-300 ease-in-out",
            isChatOpen ? "mr-[420px]" : "mr-0"
          )}
        >
          <header className="bg-white border-b border-hairline sticky top-0 z-10 shrink-0">
            <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary to-primary/70 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{reportData.clientName}</p>
                  <p className="text-[11px] text-ink-muted">
                    {reportData.dateRange.start} to {reportData.dateRange.end}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleChat}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors",
                    isChatOpen
                      ? "bg-primary/10 text-primary"
                      : "bg-canvas-soft text-ink-muted hover:text-ink hover:bg-canvas-soft/80"
                  )}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  AI Assistant
                </button>
                <span className="text-[10px] text-ink-faint uppercase tracking-wider font-medium">Shared Report</span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-8">
              <div className="bg-white rounded-xl border border-hairline p-6 shadow-sm">
                <ReportViewer data={reportData} interactive />
              </div>
              <p className="text-center text-[11px] text-ink-faint mt-6 mb-8">
                Generated by AdPulse &middot; This is a read-only shared view
              </p>
            </div>
          </main>
        </div>
        <ChatPanel />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f6] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-hairline shadow-sm p-8 max-w-sm w-full">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <FileText className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-lg font-semibold text-ink">Shared Report</h1>
          <p className="text-sm text-ink-muted mt-1">
            Enter the password to view this report
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAccess(); }}
              className="pl-10 text-sm"
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-600 text-center">{error}</p>
          )}

          <Button
            onClick={handleAccess}
            disabled={isLoading || !password}
            className="w-full gap-2 bg-primary hover:bg-primary/90 text-white"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            {isLoading ? "Verifying..." : "Access Report"}
          </Button>
        </div>

        <p className="text-[10px] text-ink-faint text-center mt-4">
          Powered by AdPulse
        </p>
      </div>
    </div>
  );
}
