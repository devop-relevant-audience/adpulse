import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { withRoute } from "@/lib/http/with-route";

// Identity endpoint for the client. 401 = no session, 403 = authenticated but
// not provisioned (no user_profiles row), 200 = full profile.
export const GET = withRoute("me.GET", async () => {
  const ctx = await getAuthContext();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx.profile) {
    return NextResponse.json(
      { error: "No profile for this account" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    user: { id: ctx.userId, email: ctx.email },
    profile: { full_name: ctx.profile.full_name, role: ctx.profile.role },
  });
});
