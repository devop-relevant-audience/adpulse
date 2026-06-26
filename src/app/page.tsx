"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { CampaignTable } from "@/components/dashboard/campaign-table";
import { PlatformBreakdown } from "@/components/dashboard/platform-breakdown";
import { AnomalyDetector } from "@/components/dashboard/anomaly-detector";
import { CampaignPacing } from "@/components/dashboard/campaign-pacing";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { ChannelOptimizer } from "@/components/dashboard/channel-optimizer";
import { HealthScore } from "@/components/dashboard/health-score";
import { useAppStore } from "@/store/app-store";
import { VIEWS } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-hairline p-4 space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-hairline p-5">
          <Skeleton className="h-[340px] w-full" />
        </div>
        <div className="bg-white rounded-xl border border-hairline p-5">
          <Skeleton className="h-[340px] w-full" />
        </div>
      </div>
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[200px] w-full" />
      </div>
    </div>
  );
}

function DashboardView() {
  return (
    <div className="space-y-4">
      <MetricCards />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <TrendChart />
        </div>
        <PlatformBreakdown />
      </div>
      <CampaignTable />
    </div>
  );
}

function ActiveView() {
  const activeView = useAppStore((s) => s.activeView);

  switch (activeView) {
    case VIEWS.anomalies:
      return <AnomalyDetector />;
    case VIEWS.pacing:
      return <CampaignPacing />;
    case VIEWS.funnel:
      return <FunnelChart />;
    case VIEWS.optimizer:
      return <ChannelOptimizer />;
    case VIEWS.health:
      return <HealthScore />;
    case VIEWS.dashboard:
    default:
      return <DashboardView />;
  }
}

export default function DashboardPage() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const setSelectedClientId = useAppStore((s) => s.setSelectedClientId);
  const { data: clients, isLoading: clientsLoading } = useClients();

  useEffect(() => {
    if (!clientId && clients && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clientId, clients, setSelectedClientId]);

  const isReady = !!clientId;

  return (
    <AppShell>
      <div className="space-y-5">
        <DashboardHeader />

        {clientsLoading || !isReady ? (
          <DashboardSkeleton />
        ) : (
          <ActiveView />
        )}
      </div>
    </AppShell>
  );
}
