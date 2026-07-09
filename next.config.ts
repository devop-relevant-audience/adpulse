import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry build integration. Source-map upload only happens when SENTRY_AUTH_TOKEN
// (+ org/project) are set in CI/prod; without them the build just skips upload.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
