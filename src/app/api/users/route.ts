import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientMembers, clients, userProfiles } from "@/lib/db/schema";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import { createAdminClient } from "@/lib/supabase/admin";

// Team management — agency_admin only. Every method gates on requireUser (there
// is a provisioned profile) then requireAgencyRole(ctx, "agency_admin").
//
// Email lives in auth.users, which Drizzle doesn't model (cross-schema), so the
// user list is assembled with a raw-SQL join to auth.users; memberships come
// from client_members joined to clients for their names.

const ROLES = ["agency_admin", "agency_member", "client_user"] as const;

const inviteSchema = z
  .object({
    email: z.string().email(),
    full_name: z.string().trim().min(1).optional(),
    role: z.enum(ROLES),
    client_ids: z.array(z.string().uuid()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.role === "client_user" && (!val.client_ids || val.client_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A client_user must be assigned at least one client",
        path: ["client_ids"],
      });
    }
  });

const updateSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(ROLES).optional(),
  full_name: z.string().trim().min(1).nullable().optional(),
  client_ids: z.array(z.string().uuid()).optional(),
});

// Returns true when every id resolves to an existing client (empty list is ok).
async function clientIdsExist(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(inArray(clients.id, ids));
  return rows.length === new Set(ids).size;
}

interface ProfileWithEmail {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
}

export const GET = withRoute("users.GET", async () => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  // auth.users lives outside Drizzle's schema — join it by raw SQL for email.
  const profileRows = (await db.execute(
    sql`SELECT p.id, u.email, p.full_name, p.role, p.created_at
        FROM user_profiles p
        JOIN auth.users u ON u.id = p.id
        ORDER BY p.created_at ASC`
  )) as unknown as ProfileWithEmail[];

  const memberRows = await db
    .select({
      userId: clientMembers.userId,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id));

  const clientsByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of memberRows) {
    const list = clientsByUser.get(row.userId) ?? [];
    list.push({ id: row.clientId, name: row.clientName });
    clientsByUser.set(row.userId, list);
  }

  const users = profileRows.map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    created_at: p.created_at,
    clients: clientsByUser.get(p.id) ?? [],
  }));

  return NextResponse.json(users);
});

export const POST = withRoute("users.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  const body = await request.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { email, full_name, role: newRole, client_ids } = parsed.data;
  const clientIds = client_ids ?? [];

  if (!(await clientIdsExist(clientIds))) {
    return NextResponse.json(
      { error: "One or more client_ids do not exist" },
      { status: 400 }
    );
  }

  // Origin drives the invite email's redirect target. Prefer an explicit
  // NEXT_PUBLIC_SITE_URL (stable public URL in prod) over the request origin.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/accept-invite`,
    data: full_name ? { full_name } : undefined,
  });

  if (error) {
    // Already-registered email → 409 so the UI can show a specific message.
    const alreadyExists =
      error.code === "email_exists" ||
      error.status === 422 ||
      /already.*regist|already.*exist/i.test(error.message);
    if (alreadyExists) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }
    // Everything else (e.g. rate limit 429) — surface the provider message.
    return NextResponse.json(
      { error: error.message },
      { status: error.status && error.status >= 400 ? error.status : 500 }
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Invite succeeded but no user id was returned" },
      { status: 500 }
    );
  }

  // Provision the profile. onConflictDoUpdate guards against any DB trigger
  // that may have already created a default profile row for the auth user.
  await db
    .insert(userProfiles)
    .values({ id: userId, role: newRole, fullName: full_name ?? null })
    .onConflictDoUpdate({
      target: userProfiles.id,
      set: { role: newRole, fullName: full_name ?? null, updatedAt: sql`now()` },
    });

  if (clientIds.length > 0) {
    await db
      .insert(clientMembers)
      .values(clientIds.map((clientId) => ({ userId, clientId })))
      .onConflictDoNothing();
  }

  return NextResponse.json(
    {
      id: userId,
      email,
      full_name: full_name ?? null,
      role: newRole,
      clients: clientIds,
    },
    { status: 200 }
  );
});

export const PATCH = withRoute("users.PATCH", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { user_id, role: newRole, full_name, client_ids } = parsed.data;

  // An admin must not demote/change themselves and lock the team out.
  if (user_id === gate.ctx.userId && newRole !== undefined) {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 403 }
    );
  }

  const [existing] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.id, user_id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (client_ids && !(await clientIdsExist(client_ids))) {
    return NextResponse.json(
      { error: "One or more client_ids do not exist" },
      { status: 400 }
    );
  }

  const profileSet: Partial<typeof userProfiles.$inferInsert> = {
    updatedAt: sql`now()` as unknown as string,
  };
  if (newRole !== undefined) profileSet.role = newRole;
  if (full_name !== undefined) profileSet.fullName = full_name;

  await db.transaction(async (tx) => {
    await tx.update(userProfiles).set(profileSet).where(eq(userProfiles.id, user_id));

    // Full membership replacement when client_ids is supplied (including []).
    if (client_ids) {
      await tx.delete(clientMembers).where(eq(clientMembers.userId, user_id));
      if (client_ids.length > 0) {
        await tx
          .insert(clientMembers)
          .values(client_ids.map((clientId) => ({ userId: user_id, clientId })));
      }
    }
  });

  return NextResponse.json({ success: true });
});

export const DELETE = withRoute("users.DELETE", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  if (userId === gate.ctx.userId) {
    return NextResponse.json(
      { error: "You cannot remove your own account" },
      { status: 403 }
    );
  }

  const [existing] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Deleting the auth user cascades to user_profiles and client_members via
  // the auth.users(id) FK (ON DELETE CASCADE — see drizzle/0004_auth_tenancy.sql).
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status && error.status >= 400 ? error.status : 500 }
    );
  }

  return NextResponse.json({ success: true });
});
