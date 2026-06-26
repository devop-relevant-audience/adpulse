"use client";

import { useQuery } from "@tanstack/react-query";
import type { Platform, CampaignPerformanceRow, ClientRow } from "@/lib/types/database";
import type { ComparisonResult, AnomalyPoint, FunnelData, PacingData } from "@/lib/data/queries";
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
