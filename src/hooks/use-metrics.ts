"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Platform, CampaignPerformanceRow, ClientRow, AlertRuleRow, AlertHistoryRow, AlertRuleInsert, ReportScheduleRow, ReportScheduleInsert, ReportRow, AdCreativeRow, CreativeStatus, ChartAnnotationRow } from "@/lib/types/database";
import type { ComparisonResult, AnomalyPoint, FunnelData, PacingData, FatigueAnalysisItem } from "@/lib/data/queries";
import type { ChannelMixAnalysis } from "@/lib/data/optimizer";
import type { HealthScoreResult } from "@/lib/data/health-score";

export function useClients() {
  return useQuery<ClientRow[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients");
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });
}

export function useMetrics(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
  platform?: Platform;
}) {
  return useQuery<CampaignPerformanceRow[]>({
    queryKey: ["metrics", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useComparison(params: {
  clientId: string | null;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  platform?: Platform;
}) {
  return useQuery<ComparisonResult>({
    queryKey: ["comparison", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "compare",
        clientId: params.clientId!,
        startDate: params.currentStart,
        endDate: params.currentEnd,
        previousStart: params.previousStart,
        previousEnd: params.previousEnd,
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch comparison");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useDailyTrend(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
  platform?: Platform;
}) {
  return useQuery<
    Array<{
      date: string;
      impressions: number;
      clicks: number;
      spend: number;
      conversions: number;
      ctr: number;
      cpc: number;
      cpa: number;
    }>
  >({
    queryKey: ["trend", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "trend",
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch trend");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useCampaigns(clientId: string | null) {
  return useQuery<
    Array<{ campaign_id: string; campaign_name: string; platform: string }>
  >({
    queryKey: ["campaigns", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns?clientId=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch campaigns");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useAnomalies(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
  platform?: Platform;
}) {
  return useQuery<AnomalyPoint[]>({
    queryKey: ["anomalies", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "anomalies",
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch anomalies");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useFunnel(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
  platform?: Platform;
}) {
  return useQuery<FunnelData>({
    queryKey: ["funnel", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "funnel",
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch funnel data");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function usePacing(params: {
  clientId: string | null;
  month: string;
}) {
  return useQuery<PacingData>({
    queryKey: ["pacing", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "pacing",
        clientId: params.clientId!,
        startDate: `${params.month}-01`,
        endDate: `${params.month}-28`,
        month: params.month,
      });

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch pacing data");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useOptimizer(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
}) {
  return useQuery<ChannelMixAnalysis>({
    queryKey: ["optimizer", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      const res = await fetch(`/api/optimizer?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch optimizer data");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useHealthScore(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
}) {
  return useQuery<HealthScoreResult>({
    queryKey: ["health-score", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "health",
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch health score");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

// --- Ad Creatives ---

export function useCreatives(params: {
  clientId: string | null;
  platform?: Platform;
  status?: CreativeStatus;
  sort?: string;
  order?: "asc" | "desc";
}) {
  return useQuery<AdCreativeRow[]>({
    queryKey: ["creatives", params],
    queryFn: async () => {
      const sp = new URLSearchParams({ clientId: params.clientId! });
      if (params.platform) sp.set("platform", params.platform);
      if (params.status) sp.set("status", params.status);
      if (params.sort) sp.set("sort", params.sort);
      if (params.order) sp.set("order", params.order);

      const res = await fetch(`/api/creatives?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch creatives");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useCreativeFatigue(clientId: string | null) {
  return useQuery<FatigueAnalysisItem[]>({
    queryKey: ["creative-fatigue", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/creatives?clientId=${clientId}&action=fatigue`);
      if (!res.ok) throw new Error("Failed to fetch fatigue analysis");
      return res.json();
    },
    enabled: !!clientId,
  });
}

// --- Alert Rules ---

export function useAlertRules(clientId: string | null) {
  return useQuery<AlertRuleRow[]>({
    queryKey: ["alert-rules", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/alerts?clientId=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch alert rules");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useAlertHistory(clientId: string | null) {
  return useQuery<AlertHistoryRow[]>({
    queryKey: ["alert-history", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/alerts?clientId=${clientId}&action=history`);
      if (!res.ok) throw new Error("Failed to fetch alert history");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: AlertRuleInsert) => {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create rule");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["alert-rules", variables.client_id] });
    },
  });
}

export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (update: { id: string; [key: string]: unknown }) => {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      qc.invalidateQueries({ queryKey: ["alert-history"] });
    },
  });
}

export function useEvaluateAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const res = await fetch(`/api/alerts?action=evaluate&clientId=${clientId}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to evaluate alerts");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-history"] });
    },
  });
}

export function useUpdateAlertHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (update: { id: string; status: string; resolved_at?: string }) => {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error("Failed to update alert");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-history"] });
    },
  });
}

// --- Report Schedules ---

export function useReportSchedules(clientId: string | null) {
  return useQuery<ReportScheduleRow[]>({
    queryKey: ["report-schedules", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/report-schedules?clientId=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch schedules");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useCreateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (schedule: ReportScheduleInsert) => {
      const res = await fetch("/api/report-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedule),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create schedule");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["report-schedules", variables.client_id] });
    },
  });
}

export function useUpdateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (update: { id: string; [key: string]: unknown }) => {
      const res = await fetch("/api/report-schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error("Failed to update schedule");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
    },
  });
}

export function useDeleteReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/report-schedules?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete schedule");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
    },
  });
}

export function useSendReportNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await fetch(`/api/report-schedules?action=send-now&id=${scheduleId}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to send report");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
    },
  });
}

export function useGeneratedReports(clientId: string | null) {
  return useQuery<ReportRow[]>({
    queryKey: ["reports", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/reports?clientId=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
    enabled: !!clientId,
  });
}

// --- Campaign Comparison ---

export interface CampaignComparisonData {
  campaignId: string;
  campaignName: string;
  platform: string;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number;
  avgCpa: number;
  daily: Array<{ date: string; impressions: number; clicks: number; spend: number; conversions: number }>;
}

export function useCampaignComparison(params: {
  clientId: string | null;
  campaignIds: string[];
  startDate: string;
  endDate: string;
  platform?: Platform;
}) {
  return useQuery<Record<string, CampaignComparisonData>>({
    queryKey: ["campaign-comparison", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        action: "compare-campaigns",
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
        campaignIds: params.campaignIds.join(","),
      });
      if (params.platform) sp.set("platform", params.platform);

      const res = await fetch(`/api/metrics?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch campaign comparison");
      return res.json();
    },
    enabled: !!params.clientId && params.campaignIds.length >= 2,
  });
}

// --- Chart Annotations ---

export function useAnnotations(params: {
  clientId: string | null;
  startDate: string;
  endDate: string;
}) {
  return useQuery<ChartAnnotationRow[]>({
    queryKey: ["annotations", params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        clientId: params.clientId!,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      const res = await fetch(`/api/annotations?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch annotations");
      return res.json();
    },
    enabled: !!params.clientId,
  });
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (annotation: { client_id: string; date: string; content: string }) => {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotation),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create annotation");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
    },
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/annotations?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete annotation");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations"] });
    },
  });
}
