import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildReport } from "@/lib/report/builder";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const reportSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = reportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const reportData = await buildReport(parsed.data);

    const supabase = getSupabase();
    const daysDiff = Math.round(
      (new Date(parsed.data.endDate).getTime() -
        new Date(parsed.data.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const { data: savedReport, error } = await supabase
      .from("reports")
      .insert({
        client_id: parsed.data.clientId,
        title: `${parsed.data.clientName} — Performance Report`,
        date_range_start: parsed.data.startDate,
        date_range_end: parsed.data.endDate,
        comparison_start: reportData.comparisonRange.start,
        comparison_end: reportData.comparisonRange.end,
        narrative: reportData.narrative,
        metrics_summary: {
          comparison: reportData.comparison,
          campaignBreakdown: reportData.campaignBreakdown,
        },
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to save report:", error);
    }

    return NextResponse.json({
      ...reportData,
      id: savedReport?.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");

    const supabase = getSupabase();
    let query = supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reports";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
