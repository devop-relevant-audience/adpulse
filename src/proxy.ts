// Next 16 proxy (formerly middleware), running on the shared Atlas Clerk
// instance. Coarse gate only — "is there a Clerk session?". Per-route
// authorization (which client a user may see) lives in src/lib/auth/guard.ts.
// Users already signed in to Atlas (same Clerk instance, same root domain in
// production) pass straight through without seeing /login.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isLoginRoute = createRouteMatcher(["/login(.*)"]);
const isPrintRoute = createRouteMatcher(["/print/reports/(.*)"]);

// Public surfaces that must work without a session: the sign-in page, public
// shared-report links (`/?share=<token>`), the share-view API (token +
// password are checked inside the route, which is also rate-limited), and a
// print page carrying a `t` token — that is the PDF exporter's own headless
// browser, which has no session. The signature is verified inside the page,
// which 404s without a valid one; a print request WITHOUT `t` is a human and
// keeps going through the normal gate.
function isPublic(req: NextRequest): boolean {
  const { pathname, searchParams } = req.nextUrl;
  return (
    isLoginRoute(req) ||
    (pathname === "/" && searchParams.has("share")) ||
    (pathname === "/api/reports/share" && req.method === "GET") ||
    (isPrintRoute(req) && searchParams.has("t"))
  );
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { userId } = await auth();

  // Signed-in users have no business on the login page.
  if (userId && isLoginRoute(req)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (!userId && !isPublic(req)) {
    if (req.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect_url", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next internals, the favicon, and static assets by
  // extension. API routes are intentionally included so the gate covers them.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff|woff2|ttf|otf)$).*)",
  ],
};
