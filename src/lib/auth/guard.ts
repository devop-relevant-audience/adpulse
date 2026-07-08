// Per-route authorization helpers — defense in depth behind the proxy's
// optimistic session gate. The proxy only proves "there is a session"; these
// answer "may THIS user touch THIS client's data". `clientId` is a
// caller-supplied parameter on nearly every route, so routes must enforce
// access themselves. Server-only (import from route handlers).
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clientMembers } from "@/lib/db/schema";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";

// Discriminated union so handlers read cleanly:
//   const gate = await requireUser();
//   if (!gate.ok) return gate.response;
//   // gate.ctx is available here
export type GuardResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse };

function forbidden(): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}

// 401 when there is no verified session; 403 when authenticated but not yet
// provisioned (no user_profiles row). On success `ctx.profile` is guaranteed
// non-null.
export async function requireUser(): Promise<GuardResult> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!ctx.profile) {
    return forbidden();
  }
  return { ok: true, ctx };
}

// Agency staff (admin or member) see every client.
export function isAgency(ctx: AuthContext): boolean {
  return ctx.profile?.role === "agency_admin" || ctx.profile?.role === "agency_member";
}

// Agency roles pass unconditionally; a client_user passes only for a client
// they hold a membership row for. Single indexed lookup — runs per request.
export async function requireClientAccess(
  ctx: AuthContext,
  clientId: string
): Promise<GuardResult> {
  if (isAgency(ctx)) return { ok: true, ctx };

  const [row] = await db
    .select({ id: clientMembers.id })
    .from(clientMembers)
    .where(and(eq(clientMembers.userId, ctx.userId), eq(clientMembers.clientId, clientId)))
    .limit(1);

  return row ? { ok: true, ctx } : forbidden();
}

// Agency-only. Pass `"agency_admin"` to further restrict to admins.
export function requireAgencyRole(ctx: AuthContext, role?: "agency_admin"): GuardResult {
  const allowed = role === "agency_admin" ? ctx.profile?.role === "agency_admin" : isAgency(ctx);
  return allowed ? { ok: true, ctx } : forbidden();
}

// The set of client ids a caller may see: `null` means "all clients" (agency);
// otherwise the client_user's membership list (possibly empty).
export async function allowedClientIds(ctx: AuthContext): Promise<string[] | null> {
  if (isAgency(ctx)) return null;

  const rows = await db
    .select({ clientId: clientMembers.clientId })
    .from(clientMembers)
    .where(eq(clientMembers.userId, ctx.userId));

  return rows.map((r) => r.clientId);
}
