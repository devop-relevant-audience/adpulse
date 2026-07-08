// Next 16 proxy (formerly middleware). Refreshes the Supabase session on every
// matched request and enforces an optimistic auth gate — "is there a verified
// session?". Per-route authorization (which client a user may see) lands in a
// later stage; keep this file to session refresh + coarse gating.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

export async function proxy(request: NextRequest) {
  // Start from a passthrough response; setAll recreates it so refreshed auth
  // cookies ride along on the request (upstream) and the response (to browser).
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() refreshes + verifies against the Auth server. Do NOT trust
  // getSession() for gating.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, searchParams } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  // Public surfaces that must work without a session.
  const isPublic =
    pathname === "/login" ||
    pathname === "/auth/callback" ||
    // Invite acceptance: the session materializes client-side from the URL
    // (hash tokens) on this page, so it must load without a prior session.
    pathname === "/auth/accept-invite" ||
    // Public shared-report links land on `/` with a ?share= token.
    (pathname === "/" && searchParams.has("share")) ||
    // Public share-view API (token + password checked inside the route).
    (pathname === "/api/reports/share" && request.method === "GET");

  // Signed-in users have no business on the login page.
  if (user && pathname === "/login") {
    return redirectPreservingCookies(new URL("/", request.url), response);
  }

  if (!user && !isPublic) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return redirectPreservingCookies(loginUrl, response);
  }

  return response;
}

// Redirects mint a fresh response, which would drop any Set-Cookie headers the
// session refresh just wrote. Copy them onto the redirect so the refreshed
// session survives the hop.
function redirectPreservingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // Run on everything except Next internals, the favicon, and static assets by
  // extension. API routes are intentionally included so the gate covers them.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff|woff2|ttf|otf)$).*)",
  ],
};
