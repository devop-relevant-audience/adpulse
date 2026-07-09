// Shared rate-limit helper backed by Upstash Redis (@upstash/ratelimit).
// Fails OPEN: when the Upstash env vars are absent (local dev, CI builds) it
// allows every request and never touches the network, so unconfigured
// environments behave exactly as before. Server-only (uses process.env and is
// imported from route handlers).
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitOptions {
  prefix: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

// Lazily-built singletons. The Redis client is created once (only when both env
// vars are present); Ratelimit instances are cached per config so we don't
// rebuild them on every request.
let redis: Redis | null = null;
let redisResolved = false;
const limiters = new Map<string, Ratelimit>();
let warnedDisabled = false;

function getRedis(): Redis | null {
  if (redisResolved) return redis;
  redisResolved = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
  return redis;
}

function getLimiter(client: Redis, opts: RateLimitOptions): Ratelimit {
  const key = `${opts.prefix}:${opts.limit}:${opts.windowSeconds}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowSeconds} s`),
      prefix: opts.prefix,
      analytics: false,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

export async function checkRateLimit(
  identifier: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const client = getRedis();

  // Fail open when Upstash isn't configured.
  if (!client) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.warn(
        "Rate limiting disabled: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. Requests will not be limited.",
      );
    }
    return { ok: true, limit: opts.limit, remaining: opts.limit, reset: 0 };
  }

  const { success, limit, remaining, reset } = await getLimiter(client, opts).limit(identifier);
  return { ok: success, limit, remaining, reset };
}

// Best-effort client IP from proxy headers. `x-forwarded-for` may carry a
// comma-separated chain; the first entry is the original client.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

// 429 with a Retry-After header. Upstash's `reset` is a ms epoch timestamp, so
// convert to whole seconds from now (at least 1).
export function rateLimitResponse(result: { limit: number; reset: number }): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
