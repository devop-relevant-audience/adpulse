import * as Sentry from "@sentry/nextjs";

// Structured logging seam. Emits one JSON object per line to stdout/stderr
// (captured by Vercel log drains) and forwards errors to Sentry. Use this
// instead of bare console.* so production incidents are diagnosable.
//
// Sentry itself is a no-op unless a DSN is configured (see instrumentation.ts),
// so this is safe everywhere; the structured logs are the always-on baseline.

type Meta = Record<string, unknown>;

function serialize(level: string, message: string, meta?: Meta): string {
  return JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...meta,
  });
}

function serializeError(error: unknown): Meta {
  if (error instanceof Error) {
    return { error: { name: error.name, message: error.message, stack: error.stack } };
  }
  return { error };
}

export const logger = {
  info(message: string, meta?: Meta): void {
    console.log(serialize("info", message, meta));
  },
  warn(message: string, meta?: Meta): void {
    console.warn(serialize("warn", message, meta));
  },
  error(message: string, error?: unknown, meta?: Meta): void {
    console.error(serialize("error", message, { ...meta, ...serializeError(error) }));
    if (error instanceof Error) {
      Sentry.captureException(error, meta ? { extra: meta } : undefined);
    } else {
      Sentry.captureMessage(message, "error");
    }
  },
};
