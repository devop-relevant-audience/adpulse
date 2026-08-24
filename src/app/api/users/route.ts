import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { atlasProjectUsers, atlasUserRoles } from "@/lib/db/atlas-schema";
import { mapAtlasRole } from "@/lib/auth/atlas-roles";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

// Read-only team directory — agency_admin only. User management (invites,
// roles, project assignments) moved to Atlas, the source of truth for the
// shared Clerk instance; this lists every Atlas user whose role grants AdPulse
// access, with the AdPulse clients a client_user can see via their Atlas
// project assignments. There is deliberately no POST/PATCH/DELETE here.

export const GET = withRoute("users.GET", async () => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  const [profileRows, memberRows] = await Promise.all([
    db
      .select({
        clerkUserId: atlasUserRoles.clerkUserId,
        email: atlasUserRoles.email,
        role: atlasUserRoles.role,
        createdAt: atlasUserRoles.createdAt,
      })
      .from(atlasUserRoles)
      .orderBy(asc(atlasUserRoles.createdAt)),
    db
      .select({
        clerkUserId: atlasProjectUsers.clerkUserId,
        clientId: clients.id,
        clientName: clients.name,
      })
      .from(atlasProjectUsers)
      .innerJoin(clients, eq(clients.atlasProjectId, atlasProjectUsers.projectId)),
  ]);

  const clientsByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of memberRows) {
    const list = clientsByUser.get(row.clerkUserId) ?? [];
    list.push({ id: row.clientId, name: row.clientName });
    clientsByUser.set(row.clerkUserId, list);
  }

  // Atlas users whose role maps to no AdPulse role (copywriters, designers, …)
  // can't sign in here — leave them out of the directory.
  const users = profileRows.flatMap((p) => {
    const mapped = mapAtlasRole(p.role);
    if (!mapped) return [];
    return [
      {
        id: p.clerkUserId,
        email: p.email,
        full_name: null,
        role: mapped,
        created_at: p.createdAt ?? "1970-01-01T00:00:00Z",
        clients: clientsByUser.get(p.clerkUserId) ?? [],
      },
    ];
  });

  return NextResponse.json(users);
});
