"use client";

import { useEffect, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { AccountNotProvisioned } from "@/components/layout/account-not-provisioned";
import { NoClientsState } from "@/components/layout/no-clients-state";
import { FullPageSkeleton } from "@/components/layout/dashboard-skeleton";
import { UrlFilterSync } from "@/components/layout/url-filter-sync";
import { useClients } from "@/hooks/use-metrics";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAppStore } from "@/store/app-store";

/**
 * Shell + guard for every client-scoped view. Renders once and persists across
 * view navigation (that's the code-splitting / no-reflash win over the old SPA).
 *
 * Responsibilities:
 *  - identity gate: 401 → /login, 403 → account-not-provisioned
 *  - client access: an unknown/forbidden `[clientId]` bounces to the first
 *    accessible client (the server already filters `useClients()` by access)
 *  - URL → store sync: mirrors the route's clientId into the store and gates
 *    children until it matches, so no view fetches with a stale client
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const clientId = typeof params.clientId === "string" ? params.clientId : "";
  const router = useRouter();

  const { data: clients, isLoading: clientsLoading } = useClients();
  const { isLoading: userLoading, error: userError } = useCurrentUser();

  const storeClientId = useAppStore((s) => s.selectedClientId);
  const setSelectedClientId = useAppStore((s) => s.setSelectedClientId);

  // Session expired after load (proxy handles the no-session case on navigation).
  const sessionExpired = userError?.status === 401;
  useEffect(() => {
    if (sessionExpired) window.location.assign("/login");
  }, [sessionExpired]);

  // Mirror the route's client into the store for the existing consumers.
  useEffect(() => {
    if (clientId && clientId !== storeClientId) {
      setSelectedClientId(clientId);
    }
  }, [clientId, storeClientId, setSelectedClientId]);

  // Unknown/forbidden client → bounce to the first the caller can actually see.
  const known = !!clients?.some((c) => c.id === clientId);
  useEffect(() => {
    if (clients && !known && clients.length > 0) {
      router.replace(`/${clients[0].id}/dashboard`);
    }
  }, [clients, known, router]);

  if (userError?.status === 403) return <AccountNotProvisioned />;
  if (sessionExpired) return null;
  if (userLoading || clientsLoading) return <FullPageSkeleton />;
  if (clients && clients.length === 0) return <NoClientsState />;
  // Redirecting away from an unknown client, or waiting for the store to catch
  // up to the URL — hold the shell so children never see a stale client.
  if (!known || storeClientId !== clientId) return <FullPageSkeleton />;

  return (
    <AppShell>
      <UrlFilterSync />
      <div className="space-y-5">
        <DashboardHeader />
        {children}
      </div>
    </AppShell>
  );
}
