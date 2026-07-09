"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { AnomalyDetector } from "@/components/dashboard/anomaly-detector";
import { CampaignPacing } from "@/components/dashboard/campaign-pacing";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { ChannelOptimizer } from "@/components/dashboard/channel-optimizer";
import { HealthScore } from "@/components/dashboard/health-score";
import { AlertsManager } from "@/components/dashboard/alerts-manager";
import { ReportsView } from "@/components/dashboard/reports-view";
import { ComparisonView } from "@/components/dashboard/comparison-view";
import { AttributionView } from "@/components/dashboard/attribution-view";
import { CreativeGallery } from "@/components/dashboard/creative-gallery";
import { CustomizableDashboard } from "@/components/dashboard/customizable-dashboard";
import { TeamView } from "@/components/team/team-view";
import { SharedReportView } from "@/components/report/shared-report-view";
import { useAppStore } from "@/store/app-store";
import { VIEWS } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AccountNotProvisioned } from "@/components/layout/account-not-provisioned";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { ErrorBoundary } from "@/components/error-boundary";

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Panel key={i} className="p-5 space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-16" />
          </Panel>
        ))}
      </div>
      <Panel className="p-5">
        <Skeleton className="h-[340px] w-full" />
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-[200px] w-full" />
        </Panel>
      </div>
      <Panel className="p-5">
        <Skeleton className="h-[200px] w-full" />
      </Panel>
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
    case VIEWS.attribution:
      return <AttributionView />;
    case VIEWS.health:
      return <HealthScore />;
    case VIEWS.creatives:
      return <CreativeGallery />;
    case VIEWS.alerts:
      return <AlertsManager />;
    case VIEWS.compare:
      return <ComparisonView />;
    case VIEWS.reports:
      return <ReportsView />;
    case VIEWS.team:
      return <TeamView />;
    case VIEWS.dashboard:
    default:
      return <CustomizableDashboard />;
  }
}

function DashboardPageInner() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share");

  if (shareToken) {
    return <SharedReportView token={shareToken} />;
  }

  return <MainDashboard />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardPageInner />
    </Suspense>
  );
}

function MainDashboard() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const activeView = useAppStore((s) => s.activeView);
  const setSelectedClientId = useAppStore((s) => s.setSelectedClientId);
  const { data: clients, isLoading: clientsLoading } = useClients();
  const { isLoading: userLoading, error: userError } = useCurrentUser();

  useEffect(() => {
    if (!clientId && clients && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clientId, clients, setSelectedClientId]);

  // A 401 here means the session expired after the page loaded (the proxy
  // handles the no-session case on navigation).
  const sessionExpired = userError?.status === 401;
  useEffect(() => {
    if (sessionExpired) {
      window.location.assign("/login");
    }
  }, [sessionExpired]);

  // Authenticated but unprovisioned (no user_profiles row): dedicated full-page
  // state, no app shell.
  if (userError?.status === 403) {
    return <AccountNotProvisioned />;
  }
  if (sessionExpired) {
    return null;
  }

  // Gate the shell on identity too, so the sidebar/header never flash for an
  // unprovisioned account before the 403 resolves.
  if (userLoading) {
    return (
      <div className="min-h-screen bg-background px-8 py-6">
        <div className="max-w-[1400px] mx-auto">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  const isReady = !!clientId;

  return (
    <AppShell>
      <div className="space-y-5">
        <DashboardHeader />

        {clientsLoading || !isReady ? (
          <DashboardSkeleton />
        ) : (
          <ErrorBoundary resetKey={activeView}>
            <ActiveView />
          </ErrorBoundary>
        )}
      </div>
    </AppShell>
  );
}
