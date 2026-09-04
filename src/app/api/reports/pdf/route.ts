import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { withRoute } from "@/lib/http/with-route";
import { getReportById } from "@/lib/data/reports";
import { isViewSnapshot } from "@/lib/reports/view-snapshot";
import { signPrintToken } from "@/lib/reports/print-token";
import { renderReportPdf, ReportPdfError } from "@/lib/reports/pdf";

// Chrome runs in-process, so this needs the Node runtime, must never be cached,
// and needs more than the default budget: a launch on a cold instance plus the
// print page's own queries can take tens of seconds.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({ id: z.string().uuid() });

/**
 * Origin the headless browser should call back on. The configured canonical
 * origin wins; behind Vercel's proxy the forwarded headers carry the public
 * host (request.url is the internal one); otherwise the request's own origin.
 * The forwarded headers are only trusted on Vercel, which sets them itself —
 * anywhere else a caller could point our browser (and the token) at any host.
 */
function resolveOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const forwardedHost = process.env.VERCEL ? request.headers.get("x-forwarded-host") : null;
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

/** ASCII, filesystem-safe stem for the `filename=` fallback. */
function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "report";
}

export const GET = withRoute("reports.pdf.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Each call holds a Chrome page for seconds — the costliest route in the app.
  const rl = await checkRateLimit(gate.ctx.userId || getClientIp(request), {
    prefix: "reports-pdf",
    limit: 6,
    windowSeconds: 60,
  });
  if (!rl.ok) return rateLimitResponse(rl);

  const parsed = querySchema.safeParse({ id: request.nextUrl.searchParams.get("id") });
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid report id is required" }, { status: 400 });
  }

  const report = await getReportById(parsed.data.id);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const access = await requireClientAccess(gate.ctx, report.client_id);
  if (!access.ok) return access.response;

  // Only snapshot reports have a print page. Classic narrative reports keep the
  // legacy client-side popup export.
  if (!isViewSnapshot(report.view_snapshot)) {
    return NextResponse.json(
      { error: "This report has no PDF export" },
      { status: 400 }
    );
  }

  const url = `${resolveOrigin(request)}/print/reports/${report.id}?t=${signPrintToken(report.id)}`;

  let pdf: Uint8Array;
  try {
    pdf = await renderReportPdf({ url });
  } catch (error) {
    if (error instanceof ReportPdfError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }

  const stem = `${slugify(report.title)}-${report.date_range_start}_${report.date_range_end}`;
  const fullName = `${report.title}-${report.date_range_start}_${report.date_range_end}.pdf`;

  // Copied into a plain ArrayBuffer-backed view: Chrome's bytes come back as
  // Uint8Array<ArrayBufferLike>, which BodyInit does not accept.
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${stem}.pdf"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
      "Cache-Control": "no-store",
    },
  });
});
