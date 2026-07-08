import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getMetrics, compareMetrics } from "@/lib/data/queries";
import { db } from "@/lib/db";
import { alertHistory, alertRules } from "@/lib/db/schema";
import { keysToCamel, keysToSnake } from "@/lib/db/case";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { sendMockEmail } from "@/lib/mock-email";
import type { AlertRuleRow, Platform } from "@/lib/types/database";
import { format, subDays, subWeeks } from "date-fns";

const alertRuleSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().min(1),
  metric: z.enum(["spend", "cpa", "ctr", "cpc", "conversions", "impressions"]),
  condition: z.enum(["above", "below", "increases_by_pct", "decreases_by_pct"]),
  threshold: z.number(),
  evaluation_window: z.enum(["daily", "weekly"]).default("daily"),
  platform: z.enum(["google", "meta", "tiktok"]).nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  recipients: z.array(z.string().email()),
  frequency: z.enum(["realtime", "hourly_digest", "daily_digest"]).default("realtime"),
  severity: z.enum(["critical", "warning", "info"]).default("warning"),
  quiet_hours_enabled: z.boolean().default(false),
  quiet_hours_start: z.string().nullable().optional(),
  quiet_hours_end: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const action = searchParams.get("action");

    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }

    if (action === "history") {
      const rows = await db
        .select()
        .from(alertHistory)
        .where(eq(alertHistory.clientId, clientId))
        .orderBy(desc(alertHistory.triggeredAt))
        .limit(100);

      return NextResponse.json(rows.map(keysToSnake));
    }

    const rows = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.clientId, clientId))
      .orderBy(desc(alertRules.createdAt));

    return NextResponse.json(rows.map(keysToSnake));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch alerts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action");

    if (action === "evaluate") {
      return handleEvaluate(request);
    }

    const body = await request.json();
    const parsed = alertRuleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const [row] = await db
      .insert(alertRules)
      .values(keysToCamel(parsed.data) as typeof alertRules.$inferInsert)
      .returning();

    return NextResponse.json(keysToSnake(row), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create alert rule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    // History rows carry a `status` (and no `rule_id`); rule rows are everything
    // else. alert_history has no `updated_at` column, so only stamp rule updates.
    const isHistory = updates.status !== undefined && updates.rule_id === undefined;

    if (isHistory) {
      const [row] = await db
        .update(alertHistory)
        .set(keysToCamel(updates) as Partial<typeof alertHistory.$inferInsert>)
        .where(eq(alertHistory.id, id))
        .returning();
      return NextResponse.json(keysToSnake(row));
    }

    const [row] = await db
      .update(alertRules)
      .set(
        keysToCamel({
          ...updates,
          updated_at: new Date().toISOString(),
        }) as Partial<typeof alertRules.$inferInsert>
      )
      .where(eq(alertRules.id, id))
      .returning();
    return NextResponse.json(keysToSnake(row));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    await db.delete(alertRules).where(eq(alertRules.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete alert rule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleEvaluate(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const ruleRows = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.clientId, clientId), eq(alertRules.enabled, true)));

  const rules = ruleRows.map((r) => keysToSnake(r) as unknown as AlertRuleRow);
  if (rules.length === 0) {
    return NextResponse.json({ triggered: [], message: "No enabled rules" });
  }

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const triggered: Array<{ ruleId: string; ruleName: string; metric: string; value: number; threshold: number }> = [];

  for (const rule of rules) {
    const windowStart = rule.evaluation_window === "weekly"
      ? format(subWeeks(today, 1), "yyyy-MM-dd")
      : format(subDays(today, 1), "yyyy-MM-dd");

    const isPercentChange = rule.condition === "increases_by_pct" || rule.condition === "decreases_by_pct";

    let actualValue: number;
    let shouldTrigger = false;

    if (isPercentChange) {
      const prevEnd = format(subDays(new Date(windowStart), 1), "yyyy-MM-dd");
      const daysDiff = Math.round(
        (new Date(todayStr).getTime() - new Date(windowStart).getTime()) / (1000 * 60 * 60 * 24)
      );
      const prevStart = format(subDays(new Date(windowStart), daysDiff), "yyyy-MM-dd");

      const comparison = await compareMetrics({
        clientId,
        currentStart: windowStart,
        currentEnd: todayStr,
        previousStart: prevStart,
        previousEnd: prevEnd,
        platform: rule.platform as Platform | undefined,
      });

      const metricMap: Record<string, string> = {
        spend: "totalSpend", cpa: "avgCpa", ctr: "avgCtr",
        cpc: "avgCpc", conversions: "totalConversions", impressions: "totalImpressions",
      };
      const deltaKey = metricMap[rule.metric] || rule.metric;
      const delta = comparison.deltas[deltaKey];
      actualValue = delta ? delta.percentage : 0;

      if (rule.condition === "increases_by_pct") shouldTrigger = actualValue >= rule.threshold;
      else shouldTrigger = actualValue <= -rule.threshold;
    } else {
      const rows = await getMetrics({
        clientId,
        startDate: windowStart,
        endDate: todayStr,
        platform: rule.platform as Platform | undefined,
        campaignId: rule.campaign_id || undefined,
      });

      const totals = rows.reduce(
        (acc, r) => ({
          spend: acc.spend + Number(r.spend),
          clicks: acc.clicks + Number(r.clicks),
          impressions: acc.impressions + Number(r.impressions),
          conversions: acc.conversions + Number(r.conversions),
        }),
        { spend: 0, clicks: 0, impressions: 0, conversions: 0 }
      );

      const computedMetrics: Record<string, number> = {
        spend: totals.spend,
        conversions: totals.conversions,
        impressions: totals.impressions,
        cpa: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
        ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
        cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
      };

      actualValue = computedMetrics[rule.metric] ?? 0;
      if (rule.condition === "above") shouldTrigger = actualValue > rule.threshold;
      else shouldTrigger = actualValue < rule.threshold;
    }

    if (shouldTrigger) {
      try {
        await db.insert(alertHistory).values(
          keysToCamel({
            rule_id: rule.id,
            client_id: clientId,
            metric: rule.metric,
            actual_value: Number(actualValue.toFixed(4)),
            threshold_value: rule.threshold,
            severity: rule.severity,
            status: "triggered",
            notification_sent: true,
            rule_name: rule.name,
          }) as typeof alertHistory.$inferInsert
        );
      } catch (insertError) {
        console.error("Failed to insert alert history:", insertError);
      }

      sendMockEmail({
        to: rule.recipients,
        subject: `[AdPulse Alert - ${rule.severity.toUpperCase()}] ${rule.name}`,
        body:
          `Alert "${rule.name}" has been triggered.\n\n` +
          `Metric: ${rule.metric}\n` +
          `Condition: ${rule.condition} ${rule.threshold}\n` +
          `Actual Value: ${actualValue.toFixed(2)}\n` +
          `Severity: ${rule.severity}\n` +
          `Evaluation Window: ${rule.evaluation_window}\n` +
          `Time: ${new Date().toISOString()}`,
      });

      triggered.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        value: Number(actualValue.toFixed(4)),
        threshold: rule.threshold,
      });
    }
  }

  return NextResponse.json({
    triggered,
    evaluated: rules.length,
    message: triggered.length > 0
      ? `${triggered.length} alert(s) triggered`
      : "All clear — no alerts triggered",
  });
}
