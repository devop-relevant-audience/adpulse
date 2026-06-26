import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const createShareSchema = z.object({
  password: z.string().min(4, "Password must be at least 4 characters"),
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createShareSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const token = generateToken();
    const passwordHash = await hashPassword(parsed.data.password);

    // If we have an existing report ID, update it
    if (parsed.data.reportId) {
      const { data: report, error } = await supabase
        .from("reports")
        .update({
          share_token: token,
          share_password_hash: passwordHash,
        })
        .eq("id", parsed.data.reportId)
        .select()
        .single();

      if (!error && report) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
        return NextResponse.json({ shareUrl: `${baseUrl}/?share=${token}`, token, reportId: report.id });
      }
    }

    // Otherwise create a new report entry with share fields
    if (parsed.data.clientId) {
      const { data: report, error } = await supabase
        .from("reports")
        .insert({
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
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      return NextResponse.json({ shareUrl: `${baseUrl}/?share=${token}`, token, reportId: report.id });
    }

    return NextResponse.json({ error: "Either reportId or clientId is required" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create share link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const token = searchParams.get("token");
    const password = searchParams.get("password");

    const parsed = accessShareSchema.safeParse({ token, password });
    if (!parsed.success) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: report, error } = await supabase
      .from("reports")
      .select("*")
      .eq("share_token", parsed.data.token)
      .single();

    if (error || !report) {
      return NextResponse.json({ error: "Report not found or link expired" }, { status: 404 });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    if (report.share_password_hash !== passwordHash) {
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to access report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
