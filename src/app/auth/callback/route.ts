import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// PKCE / magic-link callback. The email link lands here with a `?code=` that we
// exchange for a session; the server client writes the auth cookies back via
// its setAll handler (route handlers can mutate the cookie store).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", origin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, origin)
    );
  }

  // Only allow same-origin relative redirects to avoid open-redirect abuse.
  const target = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(target, origin));
}
