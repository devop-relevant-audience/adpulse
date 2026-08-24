"use client";

import { useMemo } from "react";
import { BiGroup, BiError, BiBuildings } from "react-icons/bi";
import { format, parseISO } from "date-fns";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useTeam } from "@/hooks/use-team";
import { roleLabel } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AppRole } from "@/lib/types/database";

const ROLE_BADGE: Record<AppRole, "default" | "secondary" | "outline"> = {
  agency_admin: "default",
  agency_member: "secondary",
  client_user: "outline",
};

function RoleBadge({ role }: { role: AppRole }) {
  return <Badge variant={ROLE_BADGE[role]}>{roleLabel(role)}</Badge>;
}

// Read-only directory: identity and access come from Atlas (shared Clerk
// instance + Atlas roles/project assignments), so invites, role changes, and
// removals happen there — this view only shows who can reach AdPulse.
export function TeamView() {
  const { data: me } = useCurrentUser();
  const { data: users, isLoading, error } = useTeam();
  const selfId = me?.user.id;

  const sorted = useMemo(
    () => [...(users ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [users]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Team</h1>
        <p className="text-[13px] text-ink-muted mt-0.5">
          Everyone with AdPulse access. Roles and client assignments are managed
          in Atlas and update here automatically.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <BiError className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-[13px] text-destructive">
            {error instanceof Error ? error.message : "Failed to load team"}
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12">
          <BiGroup className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-[13px] text-ink-muted">No team members yet.</p>
          <p className="text-[12px] text-ink-muted mt-1">
            Grant someone an Atlas role to give them access here.
          </p>
        </div>
      ) : (
        <Panel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-hairline">
                <TableHead className="text-[11px] font-medium text-ink-muted h-9 pl-4">
                  Member
                </TableHead>
                <TableHead className="text-[11px] font-medium text-ink-muted h-9">
                  Role
                </TableHead>
                <TableHead className="text-[11px] font-medium text-ink-muted h-9">
                  Client access
                </TableHead>
                <TableHead className="text-[11px] font-medium text-ink-muted h-9 pr-4">
                  Joined
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((user) => {
                const isSelf = user.id === selfId;
                const isClientUser = user.role === "client_user";
                return (
                  <TableRow key={user.id} className="border-hairline">
                    <TableCell className="pl-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-md bg-canvas-soft text-ink flex items-center justify-center text-[11px] font-semibold shrink-0 uppercase">
                          {(user.email || user.full_name || "?").charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-ink truncate">
                            {user.full_name || user.email || "—"}
                            {isSelf && (
                              <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                                (You)
                              </span>
                            )}
                          </p>
                          {user.full_name && (
                            <p className="text-[11px] text-ink-muted truncate">{user.email}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      {!isClientUser ? (
                        <span className="text-[12px] text-ink-muted">All clients</span>
                      ) : user.clients.length === 0 ? (
                        <span className="text-[12px] text-amber-600">No clients</span>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap">
                          <BiBuildings className="w-3 h-3 text-ink-muted shrink-0" />
                          <span className="text-[12px] text-ink truncate max-w-[220px]">
                            {user.clients.map((c) => c.name).join(", ")}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-[12px] text-ink-muted tabular-nums">
                      {format(parseISO(user.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
