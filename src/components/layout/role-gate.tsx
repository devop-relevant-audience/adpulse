"use client";

import { useEffect, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAgencyRole, isAdminRole } from "@/lib/auth/roles";
import { DashboardSkeleton } from "@/components/layout/dashboard-skeleton";

/**
 * Route-level RBAC for role-gated views (alerts = agency, team = admin). This is
 * UX enforcement only — the API routes remain the real authority — but it keeps
 * a client_user who deep-links to a forbidden view from seeing a broken page,
 * bouncing them to their dashboard instead.
 */
export function RoleGate({
  require: requirement,
  children,
}: {
  require: "agency" | "admin";
  children: ReactNode;
}) {
  const params = useParams();
  const clientId = typeof params.clientId === "string" ? params.clientId : "";
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const role = me?.profile.role;

  const allowed =
    requirement === "admin" ? isAdminRole(role) : isAgencyRole(role);

  useEffect(() => {
    if (!isLoading && me && !allowed && clientId) {
      router.replace(`/${clientId}/dashboard`);
    }
  }, [isLoading, me, allowed, clientId, router]);

  if (isLoading || !me || !allowed) {
    return <DashboardSkeleton />;
  }

  return <>{children}</>;
}
