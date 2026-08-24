import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAuthContext } from "@/lib/auth/session";
import { withRoute } from "@/lib/http/with-route";

// Identity endpoint for the client. 401 = no Clerk session, 403 = signed in
// but no Atlas role grants AdPulse access, 200 = full profile.
export const GET = withRoute("me.GET", async () => {
  const ctx = await getAuthContext();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx.profile) {
    return NextResponse.json(
      { error: "No AdPulse access for this account" },
      { status: 403 }
    );
  }

  // Display name lives in Clerk (Atlas's user_roles stores no name). One Clerk
  // API call — useCurrentUser caches this response for the whole session.
  const user = await currentUser();

  return NextResponse.json({
    user: {
      id: ctx.userId,
      email: ctx.email ?? user?.primaryEmailAddress?.emailAddress ?? null,
    },
    profile: { full_name: user?.fullName ?? null, role: ctx.profile.role },
  });
});
