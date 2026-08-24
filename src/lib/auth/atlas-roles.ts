// Atlas (ai-page-generator) is the single source of truth for identity: users
// sign in with the shared Clerk instance and hold one Atlas role in the shared
// public.user_roles table. This maps that role onto AdPulse's coarser AppRole.
// Atlas roles absent from the map (user/copywriter, viewer, designer tiers,
// developer) get NO AdPulse access — extend the map deliberately, never default
// a new role to access.
import type { AppRole } from "@/lib/types/database";

const ATLAS_ROLE_TO_APP_ROLE: Record<string, AppRole> = {
  admin: "agency_admin",
  manager: "agency_member",
  account_manager: "agency_member",
  head_account_manager: "agency_member",
  client: "client_user",
};

export function mapAtlasRole(
  atlasRole: string | null | undefined
): AppRole | null {
  if (!atlasRole) return null;
  return ATLAS_ROLE_TO_APP_ROLE[atlasRole] ?? null;
}
