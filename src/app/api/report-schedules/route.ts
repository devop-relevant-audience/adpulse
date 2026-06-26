import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildReport } from "@/lib/report/builder";
import { sendMockEmail } from "@/lib/mock-email";
import { format, subDays, subMonths, startOfMonth, endOfMonth, subQuarters, startOfQuarter, endOfQuarter } from "date-fns";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const scheduleSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly"]),
  day_of_week: z.number().min(0).max(6).nullable().optional(),
  day_of_month: z.number().min(1).max(31).nullable().optional(),
  time_of_day: z.string().default("09:00"),
  date_range_type: z.enum(["last_7", "last_14", "last_30", "last_month", "last_quarter", "month_to_date", "custom"]).default("last_30"),
  custom_days: z.number().nullable().optional(),
  include_comparison: z.boolean().default(true),
  recipients: z.array(z.string().email()),
  subject_template: z.string().default("{{clientName}} Performance Report"),
  message_template: z.string().default(""),
  require_approval: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

function getDateRangeForType(type: string, customDays?: number | null): { start: string; end: string } {
  const today = new Date();
  switch (type) {
    case "last_7":
      return { start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    case "last_14":
      return { start: format(subDays(today, 14), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    case "last_30":
      return { start: format(subDays(today, 30), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    case "last_month": {
      const lm = subMonths(today, 1);
      return { start: format(startOfMonth(lm), "yyyy-MM-dd"), end: format(endOfMonth(lm), "yyyy-MM-dd") };
    }
    case "last_quarter": {
      const lq = subQuarters(today, 1);
      return { start: format(startOfQuarter(lq), "yyyy-MM-dd"), end: format(endOfQuarter(lq), "yyyy-MM-dd") };
    }
    case "month_to_date":
      return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    case "custom":
      return { start: format(subDays(today, customDays || 30), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    default:
      return { start: format(subDays(today, 30), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");

    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("report_schedules")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch schedules";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action");

    if (action === "send-now") {
      return handleSendNow(request);
    }

    const body = await request.json();
    const parsed = scheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("report_schedules")
      .insert(parsed.data)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("report_schedules")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("report_schedules").delete().eq("id", id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleSendNow(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const scheduleId = searchParams.get("id");

  if (!scheduleId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: schedule, error: fetchError } = await supabase
    .from("report_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (fetchError || !schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", schedule.client_id)
    .single();

  const clientName = client?.name || "Unknown Client";
  const dateRange = getDateRangeForType(schedule.date_range_type, schedule.custom_days);

  const reportData = await buildReport({
    clientId: schedule.client_id,
    clientName,
    startDate: dateRange.start,
    endDate: dateRange.end,
  });

  const subject = (schedule.subject_template as string)
    .replace("{{clientName}}", clientName)
    .replace("{{dateRange}}", `${dateRange.start} to ${dateRange.end}`);

  const body = [
    schedule.message_template || `Hi,\n\nPlease find the latest performance report for ${clientName}.`,
    "",
    `Report Period: ${dateRange.start} to ${dateRange.end}`,
    "",
    "--- Executive Summary ---",
    reportData.narratives.executive,
    "",
    "--- Key Metrics ---",
    `Spend: $${reportData.comparison.current.totalSpend.toLocaleString()}`,
    `Conversions: ${reportData.comparison.current.totalConversions.toLocaleString()}`,
    `CPA: $${reportData.comparison.current.avgCpa}`,
    `CTR: ${reportData.comparison.current.avgCtr}%`,
    "",
    `Health Score: ${reportData.healthScore.overallScore}/100 (Grade ${reportData.healthScore.grade})`,
    "",
    "--- Recommendations ---",
    reportData.narratives.recommendations,
  ].join("\n");

  sendMockEmail({
    to: schedule.recipients,
    subject,
    body,
  });

  await supabase
    .from("report_schedules")
    .update({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", scheduleId);

  return NextResponse.json({
    success: true,
    message: `Report sent to ${schedule.recipients.length} recipient(s)`,
    sentAt: new Date().toISOString(),
  });
}
