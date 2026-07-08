import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { buildReport } from "@/lib/report/builder";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { keysToCamel, keysToSnake } from "@/lib/db/case";
import { allowedClientIds, requireClientAccess, requireUser } from "@/lib/auth/guard";

const reportSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

export async function POST(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
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

    let savedReportId: string | undefined;
    try {
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
      savedReportId = saved?.id;
    } catch (error) {
      console.error("Failed to save report:", error);
    }

    return NextResponse.json({
      ...reportData,
      id: savedReportId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
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

    return NextResponse.json(rows.map(keysToSnake));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reports";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
