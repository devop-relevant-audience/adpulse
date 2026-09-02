import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { keysToCamel, keysToSnake } from "@/lib/db/case";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import { isViewSnapshot, stripInternalProvenance } from "@/lib/reports/view-snapshot";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import type { ReportRow } from "@/lib/types/database";

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += chars.charAt(bytes[i] % chars.length);
  }
  return result;
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// bcrypt.compare is constant-time. A non-bcrypt stored hash (e.g. a legacy
// SHA-256 hex digest) compares as false rather than matching; the try/catch is
// defensive insurance so any malformed input degrades to a mismatch, never a
// 500 — old non-bcrypt hashes simply stop validating.
async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

const createShareSchema = z.object({
  password: z.string().min(12, "Password must be at least 12 characters"),
  expiresInDays: z.number().int().positive().max(365).default(30),
  reportId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
  comparisonRange: z.object({ start: z.string(), end: z.string() }).optional(),
  narrative: z.string().optional(),
  metricsSummary: z.record(z.string(), z.unknown()).optional(),
});

const accessShareSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

export const POST = withRoute("reports.share.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  const body = await request.json();
  const parsed = createShareSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const token = generateToken();
  const passwordHash = await hashPassword(parsed.data.password);
  const shareExpiresAt = new Date(
    Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // If we have an existing report ID, update it
  if (parsed.data.reportId) {
    const [report] = await db
      .update(reports)
      .set({ shareToken: token, sharePasswordHash: passwordHash, shareExpiresAt })
      .where(eq(reports.id, parsed.data.reportId))
      .returning({ id: reports.id });

    if (report) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      return NextResponse.json({ shareUrl: `${baseUrl}/?share=${token}`, token, reportId: report.id });
    }
  }

  // Otherwise create a new report entry with share fields
  if (parsed.data.clientId) {
    const [report] = await db
      .insert(reports)
      .values(
        keysToCamel({
          client_id: parsed.data.clientId,
          title: `${parsed.data.clientName || "Client"} — Performance Report`,
          date_range_start: parsed.data.dateRange?.start || "",
          date_range_end: parsed.data.dateRange?.end || "",
          comparison_start: parsed.data.comparisonRange?.start || "",
          comparison_end: parsed.data.comparisonRange?.end || "",
          narrative: parsed.data.narrative || "",
          metrics_summary: parsed.data.metricsSummary || {},
          share_token: token,
          share_password_hash: passwordHash,
          share_expires_at: shareExpiresAt,
        }) as typeof reports.$inferInsert
      )
      .returning({ id: reports.id });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return NextResponse.json({ shareUrl: `${baseUrl}/?share=${token}`, token, reportId: report.id });
  }

  return NextResponse.json({ error: "Either reportId or clientId is required" }, { status: 400 });
});

export const GET = withRoute("reports.share.GET", async (request: NextRequest) => {
  // Throttle brute-force attempts against the public share endpoint by IP,
  // before any DB work. Fails open when Upstash isn't configured.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, { prefix: "share-access", limit: 10, windowSeconds: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const { searchParams } = request.nextUrl;
  const token = searchParams.get("token");
  const password = searchParams.get("password");

  const parsed = accessShareSchema.safeParse({ token, password });
  if (!parsed.success) {
    return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
  }

  const [reportRow] = await db
    .select()
    .from(reports)
    .where(eq(reports.shareToken, parsed.data.token))
    .limit(1);

  if (!reportRow) {
    return NextResponse.json({ error: "Report not found or link expired" }, { status: 404 });
  }

  // Treat an elapsed expiry as a dead link (same opaque message as not-found).
  if (reportRow.shareExpiresAt && new Date(reportRow.shareExpiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "Report not found or link expired" }, { status: 404 });
  }

  const report = keysToSnake(reportRow) as unknown as ReportRow;

  const valid = await verifyPassword(parsed.data.password, report.share_password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  return NextResponse.json({
    id: report.id,
    clientId: report.client_id,
    title: report.title,
    dateRange: { start: report.date_range_start, end: report.date_range_end },
    comparisonRange: { start: report.comparison_start, end: report.comparison_end },
    narrative: report.narrative,
    metricsSummary: report.metrics_summary,
    // Only reached once the token, expiry and password checks above have all
    // passed. NULL for a classic report; the public view branches on it. The
    // reader here is anonymous, so the internal view/layout ids come off it —
    // the same strip the report list applies to a non-agency reader.
    viewSnapshot: isViewSnapshot(report.view_snapshot)
      ? stripInternalProvenance(report.view_snapshot)
      : report.view_snapshot,
  });
});
