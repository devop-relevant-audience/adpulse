// Client-safe role helpers. No server imports — safe to use in components so
// role checks aren't string-compared ad hoc across the UI. Server-side
// authorization still lives in `src/lib/auth/guard.ts`; these only drive UX.
import type { AppRole } from "@/lib/types/database";

type MaybeRole = AppRole | null | undefined;

/** Agency staff (admin or member) — the accounts that manage clients. */
export function isAgencyRole(role: MaybeRole): boolean {
  return role === "agency_admin" || role === "agency_member";
}

/** Agency owner — the only role allowed to seed/reset data. */
export function isAdminRole(role: MaybeRole): boolean {
  return role === "agency_admin";
}

/** Short, human label for a role badge. */
export function roleLabel(role: MaybeRole): string {
  switch (role) {
    case "agency_admin":
      return "Agency admin";
    case "agency_member":
      return "Agency";
    case "client_user":
      return "Client";
    default:
      return "";
  }
}
