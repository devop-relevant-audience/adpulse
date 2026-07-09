"use client";

import { useEffect } from "react";
import { logger } from "@/lib/log";

// global-error replaces the root layout when it (or something above the route
// segments) throws, so it must render its own <html>/<body>. It cannot rely on
// the app's global stylesheet being present, so styles are inlined.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Global (root layout) error", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8f8f7",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          color: "#191919",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            borderRadius: "16px",
            border: "1px solid #ececea",
            backgroundColor: "#ffffff",
            padding: "32px",
            textAlign: "center",
            boxShadow: "0 8px 24px -8px rgba(23,23,23,0.14), 0 2px 6px -2px rgba(23,23,23,0.06)",
          }}
        >
          <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: "13px", color: "#6b6b6b", marginTop: "6px", lineHeight: 1.5 }}>
            The application hit an unexpected error. Try again, or reload the page if the problem
            persists.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginTop: "24px",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                height: "32px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "32px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "1px solid #e2e2e0",
                backgroundColor: "#ffffff",
                color: "#191919",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
