// Short-lived signed token that lets the server's own headless browser open
// `/print/reports/[id]` without a Clerk session. HMAC-SHA256 over
// `<reportId>.<expiresAtMs>`; the secret is PRINT_TOKEN_SECRET, falling back to
// CLERK_SECRET_KEY so nothing new has to be provisioned for the token to work.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const value = process.env.PRINT_TOKEN_SECRET || process.env.CLERK_SECRET_KEY;
  if (!value) throw new Error("PRINT_TOKEN_SECRET (or CLERK_SECRET_KEY) must be set to sign print tokens");
  return value;
}

function sign(reportId: string, expiresAt: number): string {
  return createHmac("sha256", secret()).update(`${reportId}.${expiresAt}`).digest("base64url");
}

/** `<expiresAtMs>.<signature>` — pass as the `t` query param of the print page. */
export function signPrintToken(reportId: string, ttlMs = DEFAULT_TTL_MS): string {
  const expiresAt = Date.now() + ttlMs;
  return `${expiresAt}.${sign(reportId, expiresAt)}`;
}

export function verifyPrintToken(reportId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = sign(reportId, expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
