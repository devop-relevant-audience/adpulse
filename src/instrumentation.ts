import * as Sentry from "@sentry/nextjs";

// Server + edge runtime init. Runs once per server instance (Next 16
// instrumentation hook). Sentry is a no-op unless SENTRY_DSN is set, so this is
// safe in local dev / CI where the DSN is absent.
export function register() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN),
    tracesSampleRate: 0,
  });
}

// Forwards errors Next captures during rendering / route handling to Sentry.
export const onRequestError = Sentry.captureRequestError;
