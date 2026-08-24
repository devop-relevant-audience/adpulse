// Server-only auth context. Identity comes from the shared Clerk session
// (AdPulse runs on the same Clerk instance as Atlas, so one login covers both
// apps); authorization comes from Atlas's public.user_roles row for that Clerk
// user, mapped onto AdPulse's AppRole. Import only from server code (route
// handlers, server components); it reads request auth state.
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { atlasUserRoles } from "@/lib/db/atlas-schema";
import { mapAtlasRole } from "@/lib/auth/atlas-roles";
import type { AppRole } from "@/lib/types/database";

export interface AuthContext {
  // Clerk user id (shared with Atlas).
  userId: string;
  email: string | null;
  // null when the Clerk user has no Atlas role row, or an Atlas role that
  // grants no AdPulse access — callers decide how to treat an
  // authenticated-but-unprovisioned account (see /api/me → 403).
  profile: { full_name: string | null; role: AppRole } | null;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [row] = await db
    .select({ email: atlasUserRoles.email, role: atlasUserRoles.role })
    .from(atlasUserRoles)
    .where(eq(atlasUserRoles.clerkUserId, userId))
    .limit(1);

  const role = mapAtlasRole(row?.role);

  return {
    userId,
    email: row?.email ?? null,
    // full_name lives in Clerk, not in Atlas's user_roles — /api/me enriches
    // it via currentUser(); guards only need the role.
    profile: role ? { full_name: null, role } : null,
  };
}
