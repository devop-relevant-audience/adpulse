import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

/**
 * Derive a bare origin (scheme + host + port, no path/credentials) from a URL
 * string so it can be listed in a CSP source list. Returns null for
 * missing/invalid values so unset optional integrations simply contribute
 * nothing to the policy.
 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Clerk's browser SDK loads clerk-js from, and talks to, the instance's
 * Frontend API domain, which is embedded (base64, `$`-terminated) in the
 * publishable key — derive it so the CSP can never drift from the configured
 * instance (dev: *.clerk.accounts.dev; prod: clerk.<root domain>).
 */
function clerkOriginFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const encoded = key.replace(/^pk_(test|live)_/, "");
  try {
    const domain = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return domain ? `https://${domain}` : null;
  } catch {
    return null;
  }
}

// Browser-reached origins are derived from the SAME build-time env the client
// code is compiled against, so the CSP can never drift from what the bundle
// actually calls:
//  - The Clerk browser SDK (auth) loads from and calls the instance's Frontend
//    API origin derived above.
//  - The Sentry browser SDK (src/instrumentation-client.ts) ingests errors to
//    the origin embedded in NEXT_PUBLIC_SENTRY_DSN. URL.origin strips the DSN's
//    public-key credential automatically.
// OpenRouter and Upstash are deliberately absent: they are only ever called
// from server routes (chat, creatives/generate, rate-limit), never the browser.
const clerkOrigin = clerkOriginFromKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

const connectSrc = ["'self'", clerkOrigin, sentryOrigin].filter(Boolean);

// The PDF export (src/components/report/report-generator.tsx) opens a blank
// popup and document.write()s HTML that @imports Google Fonts. A window opened
// with an empty URL inherits the opener's CSP, so fonts.googleapis.com
// (stylesheet) and fonts.gstatic.com (font files) must be allowed here or the
// print view renders with the wrong typeface. The main app itself self-hosts
// its font via next/font (served same-origin, covered by 'self').
const cspDirectives = [
  `default-src 'self'`,
  // 'unsafe-inline': Next.js App Router injects inline bootstrap/hydration
  // scripts (self.__next_f, streaming data) with no nonce. Eliminating this
  // would require nonce + 'strict-dynamic' generated in proxy.ts with forced
  // dynamic rendering (disables static/PPR) — out of scope for this change.
  // 'unsafe-eval' is added in dev only, where React/Turbopack use eval for
  // error stacks and HMR; production never needs it.
  // clerk-js is loaded from the Clerk Frontend API origin; the sign-in widget
  // can load Cloudflare Turnstile (Clerk's bot protection) from
  // challenges.cloudflare.com.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${clerkOrigin ? ` ${clerkOrigin}` : ""} https://challenges.cloudflare.com`,
  // 'unsafe-inline': Tailwind v4, react-grid-layout (inline transform/size on
  // every grid item), and Recharts all set inline style attributes at runtime.
  // fonts.googleapis.com covers the print-popup stylesheet @import above.
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  // Creative thumbnails render as raw <img src="https://placehold.co/...">
  // (creative-gallery.tsx, creative-generator.tsx, buildThumbnailUrl). data:
  // covers inline/canvas images; blob: covers URL.createObjectURL used by the
  // CSV/asset export flows.
  // img.clerk.com serves user avatars in Clerk components.
  `img-src 'self' data: blob: https://placehold.co https://img.clerk.com`,
  // 'self' = next/font self-hosted files; gstatic = print-popup font files;
  // data: = any base64-inlined font.
  `font-src 'self' data: https://fonts.gstatic.com`,
  `connect-src ${connectSrc.join(" ")}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  // Clickjacking defense: the app (incl. public share pages) must not be
  // embeddable. frame-ancestors is the modern control; X-Frame-Options below
  // is the legacy belt-and-suspenders. frame-src allows only Cloudflare
  // Turnstile (Clerk bot protection renders it in an iframe on sign-in); the
  // app itself embeds no other frames (the PDF export uses window.open).
  `frame-ancestors 'none'`,
  `frame-src https://challenges.cloudflare.com`,
  // clerk-js spins up a web worker for session refresh scheduling.
  `worker-src 'self' blob:`,
  `upgrade-insecure-requests`,
];

const contentSecurityPolicy = cspDirectives.join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // 2 years + subdomains. Only honored over HTTPS, so it is inert in local
    // dev. Omitting `preload` intentionally — that is a permanent, hard-to-undo
    // commitment for every subdomain.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    // Lock down device/APIs the app never uses.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route (pages, API, and static assets).
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Sentry build integration. Source-map upload only happens when SENTRY_AUTH_TOKEN
// (+ org/project) are set in CI/prod; without them the build just skips upload.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
