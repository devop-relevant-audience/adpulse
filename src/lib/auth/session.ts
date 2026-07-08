// Server-only auth context. Resolves the current Supabase user from a
// locally-verified JWT (getClaims) — falling back to getUser() — then loads the
// matching user_profiles row via Drizzle in a single query. Import only from
// server code (route handlers, server components); it reads request cookies.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types/database";

export interface AuthContext {
  userId: string;
  email: string | null;
  // null when the auth user has no user_profiles row yet — callers decide how
  // to treat an authenticated-but-unprovisioned account (see /api/me → 403).
  profile: { full_name: string | null; role: AppRole } | null;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();

  let userId: string | null = null;
  let email: string | null = null;

  // getClaims verifies the JWT (locally via JWKS for asymmetric keys) — cheaper
  // and safe for authorization. Fall back to getUser() if it yields nothing.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claims?.sub) {
    userId = claims.sub;
    email = typeof claims.email === "string" ? claims.email : null;
  } else {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      userId = userData.user.id;
      email = userData.user.email ?? null;
    }
  }

  if (!userId) return null;

  const [row] = await db
    .select({ fullName: userProfiles.fullName, role: userProfiles.role })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1);

  return {
    userId,
    email,
    profile: row ? { full_name: row.fullName, role: row.role as AppRole } : null,
  };
}
