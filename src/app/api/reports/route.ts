import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { buildReport } from "@/lib/report/builder";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { keysToCamel, keysToSnake } from "@/lib/db/case";
import {
  allowedClientIds,
  isAgency,
  requireAgencyRole,
  requireClientAccess,
  requireUser,
} from "@/lib/auth/guard";
import type { AuthContext } from "@/lib/auth/session";
import {
  buildReportLayoutSnapshot,
  buildViewSnapshot,
  ViewNotFoundError,
} from "@/lib/reports/build-view-snapshot";
import { isViewSnapshot, stripInternalProvenance } from "@/lib/reports/view-snapshot";
import type { ViewSnapshot } from "@/lib/reports/view-snapshot";
import { withRoute } from "@/lib/http/with-route";

// A layout report waits on the AI summary's OpenRouter call (30s ceiling) on
// top of every widget's query, so the route needs more than the default budget.
export const maxDuration = 60;

const reportSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// A report built FROM a saved dashboard view: the server computes every
// widget's data once and freezes it on the row. Distinguished from the classic
// payload above by `fromDashboardId`.
const viewReportSchema = z.object({
  clientId: z.string().uuid(),
  fromDashboardId: z.string().uuid(),
  title: z.string().min(1).max(200),
  dateRange: dateRangeSchema,
});

// A report built FROM a report layout — the report builder's own blocks, frozen
// the same way and drawn as a document page.
const layoutReportSchema = z.object({
  clientId: z.string().uuid(),
  fromReportLayoutId: z.string().uuid(),
  title: z.string().min(1).max(200),
  dateRange: dateRangeSchema,
});

export const POST = withRoute("reports.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const body = await request.json();

  if (body && typeof body === "object" && "fromDashboardId" in body) {
    return createViewReport(gate.ctx, body);
  }

  if (body && typeof body === "object" && "fromReportLayoutId" in body) {
    return createLayoutReport(gate.ctx, body);
  }

  const parsed = reportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const access = await requireClientAccess(gate.ctx, parsed.data.clientId);
  if (!access.ok) return access.response;

  const reportData = await buildReport(parsed.data);

  // A failed persist is a real failure — let the error propagate to withRoute
  // (sanitized 500 + Sentry) rather than returning success with an undefined id.
  const [saved] = await db
    .insert(reports)
    .values(
      keysToCamel({
        client_id: parsed.data.clientId,
        title: `${parsed.data.clientName} — Performance Report`,
        date_range_start: parsed.data.startDate,
        date_range_end: parsed.data.endDate,
        comparison_start: reportData.comparisonRange.start,
        comparison_end: reportData.comparisonRange.end,
        narrative: reportData.narratives.executive,
        metrics_summary: {
          currency: reportData.currency,
          comparison: reportData.comparison,
          campaignBreakdown: reportData.campaignBreakdown,
          platformBreakdown: reportData.platformBreakdown,
          trendSummary: reportData.trendSummary,
          funnel: reportData.funnel,
          healthScore: reportData.healthScore,
          narratives: reportData.narratives,
        },
      }) as typeof reports.$inferInsert
    )
    .returning({ id: reports.id });

  return NextResponse.json({
    ...reportData,
    id: saved?.id,
  });
});

/**
 * Creates a view report: build the frozen snapshot, then store it alongside the
 * classic columns so the list, the share flow and the row shape stay uniform.
 * Agency-only, like every other dashboard-view write: a view report exposes a
 * view's whole definition (including internal, unpublished ones), so a client
 * user must never be able to snapshot one for themselves.
 */
async function createViewReport(ctx: AuthContext, body: unknown) {
  const parsed = viewReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { clientId, fromDashboardId, title, dateRange } = parsed.data;

  if (dateRange.start > dateRange.end) {
    return NextResponse.json({ error: "Start date must be on or before end date" }, { status: 400 });
  }

  const access = await requireClientAccess(ctx, clientId);
  if (!access.ok) return access.response;

  const role = requireAgencyRole(ctx);
  if (!role.ok) return role.response;

  let snapshot;
  try {
    snapshot = await buildViewSnapshot({ clientId, dashboardId: fromDashboardId, dateRange });
  } catch (error) {
    if (error instanceof ViewNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return insertSnapshotReport(clientId, title, snapshot);
}

/**
 * Creates a document report from a report LAYOUT. Agency-only for the same
 * reason a view report is: layouts are internal, so a client user may read the
 * generated report but never snapshot one.
 */
async function createLayoutReport(ctx: AuthContext, body: unknown) {
  const parsed = layoutReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { clientId, fromReportLayoutId, title, dateRange } = parsed.data;

  if (dateRange.start > dateRange.end) {
    return NextResponse.json({ error: "Start date must be on or before end date" }, { status: 400 });
  }

  const access = await requireClientAccess(ctx, clientId);
  if (!access.ok) return access.response;

  const role = requireAgencyRole(ctx);
  if (!role.ok) return role.response;

  let snapshot;
  try {
    snapshot = await buildReportLayoutSnapshot({
      clientId,
      layoutId: fromReportLayoutId,
      dateRange,
    });
  } catch (error) {
    if (error instanceof ViewNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return insertSnapshotReport(clientId, title, snapshot);
}

/**
 * Stores a frozen snapshot alongside the classic columns, so the list, the
 * share flow and the row shape stay uniform whichever grid it came from.
 */
async function insertSnapshotReport(clientId: string, title: string, snapshot: ViewSnapshot) {
  const [saved] = await db
    .insert(reports)
    .values(
      keysToCamel({
        client_id: clientId,
        title,
        date_range_start: snapshot.dateRange.start,
        date_range_end: snapshot.dateRange.end,
        comparison_start: snapshot.comparison.start,
        comparison_end: snapshot.comparison.end,
        // A snapshot report carries no prose and no classic metrics summary —
        // the snapshot is the whole report.
        narrative: "",
        metrics_summary: {},
        view_snapshot: snapshot,
      }) as typeof reports.$inferInsert
    )
    .returning();

  return NextResponse.json(keysToSnake(saved));
}

export const GET = withRoute("reports.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("clientId");

  if (clientId) {
    const access = await requireClientAccess(gate.ctx, clientId);
    if (!access.ok) return access.response;
  }

  // No clientId: agency sees all; a client_user is scoped to their memberships.
  const allowed = await allowedClientIds(gate.ctx);
  let filter;
  if (clientId) {
    filter = eq(reports.clientId, clientId);
  } else if (allowed !== null) {
    if (allowed.length === 0) return NextResponse.json([]);
    filter = inArray(reports.clientId, allowed);
  }

  const rows = await db
    .select()
    .from(reports)
    .where(filter)
    .orderBy(desc(reports.createdAt));

  // The report's content is meant for the client, but the id of the internal
  // view it was taken from is not — it is agency-side provenance only.
  const agency = isAgency(gate.ctx);
  return NextResponse.json(
    rows.map((row) => {
      const mapped = keysToSnake(row);
      if (!agency && isViewSnapshot(mapped.view_snapshot)) {
        mapped.view_snapshot = stripInternalProvenance(mapped.view_snapshot);
      }
      return mapped;
    })
  );
});
