// Print surface for a saved view report: the frozen snapshot as a linear,
// paper-shaped document. Two readers open it — the server's own headless Chrome
// (with a short-lived signed `t` token, which the proxy lets past the Clerk
// gate) and a signed-in human who wants Ctrl+P. Everything unauthorized 404s
// rather than 403s: the page should not confirm that a report id exists.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReportById } from "@/lib/data/reports";
import { getAuthContext } from "@/lib/auth/session";
import { canAccessClient, isAgency } from "@/lib/auth/guard";
import { verifyPrintToken } from "@/lib/reports/print-token";
import { isViewSnapshot, stripInternalProvenance } from "@/lib/reports/view-snapshot";
import { PrintReport } from "@/components/reports/print-report";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The root layout pins `body` to `h-full overflow-hidden` so the app shell
 * scrolls its own panes. A printed document has to be as tall as it is, or
 * Chrome captures one clipped page — hence the override, scoped to this route
 * by living in the page itself.
 */
const DOCUMENT_STYLES = `
html, body { height: auto !important; overflow: visible !important; background: #fff; }
* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
@page { size: A4 portrait; margin: 14mm 12mm; }
`;

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = (await searchParams).t;
  const token = Array.isArray(raw) ? raw[0] : raw;

  // A valid token stands in for a session; without one the caller must be a
  // signed-in user with access to the report's client.
  const tokenOk = verifyPrintToken(id, token);
  const ctx = tokenOk ? null : await getAuthContext();
  if (!tokenOk && !ctx?.profile) notFound();

  const report = await getReportById(id);
  if (!report) notFound();

  // Classic narrative reports have no snapshot and no block layout to draw.
  const snapshot = report.view_snapshot;
  if (!isViewSnapshot(snapshot)) notFound();

  if (ctx && !(await canAccessClient(ctx, report.client_id))) notFound();

  // Token-only readers are treated as client viewers: the token proves the
  // request came from us, not that whoever holds the PDF is agency staff.
  const agency = ctx ? isAgency(ctx) : false;

  return (
    <>
      <style>{DOCUMENT_STYLES}</style>
      <PrintReport
        snapshot={agency ? snapshot : stripInternalProvenance(snapshot)}
        title={report.title}
      />
    </>
  );
}
