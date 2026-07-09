import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/log";

// Top-level error boundary for API route handlers. Wrap every exported handler
// so a thrown/rejected error becomes a sanitized 500 with a correlation id
// (logged + forwarded to Sentry) instead of leaking `error.message` to the
// client.
//
// It ONLY adds a catch: the handler's own response is returned untouched on
// success, so guard early-returns (401/403), zod validation (400), rate-limit
// (429), and any other explicit NextResponse control flow pass through as-is.
// `...args` is forwarded verbatim, so dynamic `[id]` routes keep their
// `{ params }` context argument.
export function withRoute<Args extends unknown[]>(
  name: string,
  handler: (request: NextRequest, ...args: Args) => Promise<Response>,
): (request: NextRequest, ...args: Args) => Promise<Response> {
  return async (request: NextRequest, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      const errorId = crypto.randomUUID();
      logger.error(`Unhandled error in ${name}`, error, { route: name, errorId });
      return NextResponse.json(
        { error: "Internal server error", errorId },
        { status: 500 },
      );
    }
  };
}
