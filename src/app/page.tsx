"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SharedReportView } from "@/components/report/shared-report-view";
import { AccountNotProvisioned } from "@/components/layout/account-not-provisioned";
import { NoClientsState } from "@/components/layout/no-clients-state";
import { FullPageSkeleton } from "@/components/layout/dashboard-skeleton";
import { useClients } from "@/hooks/use-metrics";
import { useCurrentUser } from "@/hooks/use-current-user";

// The root path has two jobs: serve public shared reports (`/?share=<token>`,
// which the proxy allows without a session) and, for signed-in users, redirect
// to their first client's dashboard (client scope now lives in the URL path).
function RootInner() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share");

  if (shareToken) {
    return <SharedReportView token={shareToken} />;
  }

  return <RootRedirect />;
}

function RootRedirect() {
  const router = useRouter();
  const { data: clients, isLoading: clientsLoading } = useClients();
  const { isLoading: userLoading, error: userError } = useCurrentUser();

  const sessionExpired = userError?.status === 401;
  useEffect(() => {
    if (sessionExpired) window.location.assign("/login");
  }, [sessionExpired]);

  const firstClientId = clients?.[0]?.id;
  useEffect(() => {
    if (firstClientId) router.replace(`/${firstClientId}/dashboard`);
  }, [firstClientId, router]);

  if (userError?.status === 403) return <AccountNotProvisioned />;
  if (sessionExpired) return null;
  if (userLoading || clientsLoading) return <FullPageSkeleton />;
  if (clients && clients.length === 0) return <NoClientsState />;
  return <FullPageSkeleton />;
}

export default function RootPage() {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <RootInner />
    </Suspense>
  );
}
