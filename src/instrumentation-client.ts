import * as Sentry from "@sentry/nextjs";

// Client-side init, runs before hydration (Next 16 instrumentation-client hook).
// No-op unless NEXT_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0,
});

// Lets Sentry tie client navigations to captured errors.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
