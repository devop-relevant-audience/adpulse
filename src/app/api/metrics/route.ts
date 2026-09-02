import { NextRequest, NextResponse } from "next/server";
import { getMetrics, compareMetrics, getDailyTrend, getFunnelData, getCampaignPacing } from "@/lib/data/queries";
import { calculateHealthScore } from "@/lib/data/health-score";
import { z } from "zod";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import type { Platform } from "@/lib/types/database";
import { runMetricQuery } from "@/lib/data/metric-query";
import {
  QUERY_GROUP_BYS,
  QUERY_MAX_LIMIT,
  QUERY_METRICS,
  QUERY_SORT_DIRS,
  QUERY_TIME_BUCKETS,
  parseThreshold,
} from "@/lib/dashboard/custom-widget";

// Extra params for `action=query` (custom widget aggregation).
const querySchema = z.object({
  groupBy: z.enum(QUERY_GROUP_BYS).default("none"),
  timeBucket: z.enum(QUERY_TIME_BUCKETS).default("none"),
  limit: z.coerce.number().int().min(1).max(QUERY_MAX_LIMIT).optional(),
  sortBy: z.enum(QUERY_METRICS).optional(),
  sortDir: z.enum(QUERY_SORT_DIRS).optional(),
});

const metricsSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
  campaignId: z.string().optional(),
  platforms: z.string().optional(),
  campaignIds: z.string().optional(),
});

const PLATFORM_VALUES: readonly Platform[] = ["google", "meta", "tiktok"];
const MAX_CAMPAIGN_IDS = 200;

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const GET = withRoute("metrics.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action") || "raw";

  const parsed = metricsSchema.safeParse({
    clientId: searchParams.get("clientId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
    platform: searchParams.get("platform") || undefined,
    campaignId: searchParams.get("campaignId") || undefined,
    platforms: searchParams.get("platforms") || undefined,
    campaignIds: searchParams.get("campaignIds") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const access = await requireClientAccess(gate.ctx, parsed.data.clientId);
  if (!access.ok) return access.response;

  const platformList = splitList(parsed.data.platforms);
  if (platformList.some((p) => !PLATFORM_VALUES.includes(p as Platform))) {
    return NextResponse.json({ error: "Invalid platforms" }, { status: 400 });
  }
  const campaignIdList = Array.from(new Set(splitList(parsed.data.campaignIds)));
  if (campaignIdList.length > MAX_CAMPAIGN_IDS) {
    return NextResponse.json(
      { error: `Too many campaignIds (max ${MAX_CAMPAIGN_IDS})` },
      { status: 400 }
    );
  }

  const params = {
    clientId: parsed.data.clientId,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    campaignId: parsed.data.campaignId,
    platform: parsed.data.platform as Platform | undefined,
    platforms: platformList.length ? (platformList as Platform[]) : undefined,
    campaignIds: campaignIdList.length ? campaignIdList : undefined,
  };

  switch (action) {
    case "compare": {
      const previousStart = searchParams.get("previousStart");
      const previousEnd = searchParams.get("previousEnd");
      if (!previousStart || !previousEnd) {
        return NextResponse.json(
          { error: "previousStart and previousEnd required for compare action" },
          { status: 400 }
        );
      }
      const result = await compareMetrics({
        clientId: params.clientId,
        currentStart: params.startDate,
        currentEnd: params.endDate,
        previousStart,
        previousEnd,
        platform: params.platform,
        platforms: params.platforms,
        campaignIds: params.campaignIds,
      });
      return NextResponse.json(result);
    }

    case "trend": {
      const trend = await getDailyTrend(params);
      return NextResponse.json(trend);
    }

    case "funnel": {
      const funnel = await getFunnelData(params);
      return NextResponse.json(funnel);
    }

    case "pacing": {
      const month = searchParams.get("month") || params.startDate.substring(0, 7);
      const pacing = await getCampaignPacing({ clientId: params.clientId, month });
      return NextResponse.json(pacing);
    }

    case "health": {
      const health = await calculateHealthScore(params);
      return NextResponse.json(health);
    }

    case "query": {
      const query = querySchema.safeParse({
        groupBy: searchParams.get("groupBy") || undefined,
        timeBucket: searchParams.get("timeBucket") || undefined,
        limit: searchParams.get("limit") || undefined,
        sortBy: searchParams.get("sortBy") || undefined,
        sortDir: searchParams.get("sortDir") || undefined,
      });
      if (!query.success) {
        return NextResponse.json(
          { error: "Invalid query parameters", details: query.error.flatten() },
          { status: 400 }
        );
      }
      // Malformed rather than absent: charting the unfiltered groups would
      // quietly answer a different question than the widget asked.
      const thresholdRaw = searchParams.get("threshold");
      const threshold = parseThreshold(thresholdRaw);
      if (thresholdRaw && !threshold) {
        return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
      }

      const result = await runMetricQuery({
        clientId: params.clientId,
        startDate: params.startDate,
        endDate: params.endDate,
        platforms: params.platforms,
        campaignIds: params.campaignIds,
        groupBy: query.data.groupBy,
        timeBucket: query.data.timeBucket,
        limit: query.data.limit,
        sortBy: query.data.sortBy,
        sortDir: query.data.sortDir,
        ...(threshold ? { threshold } : {}),
      });
      return NextResponse.json(result);
    }

    case "compare-campaigns": {
      const campaignIdsRaw = searchParams.get("campaignIds");
      if (!campaignIdsRaw) {
        return NextResponse.json(
          { error: "campaignIds required (comma-separated)" },
          { status: 400 }
        );
      }
      const campaignIds = campaignIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);

      const allRows = await getMetrics({
        clientId: params.clientId,
        startDate: params.startDate,
        endDate: params.endDate,
        platform: params.platform,
      });

      const campaigns: Record<string, {
        campaignId: string;
        campaignName: string;
        platform: string;
        totalImpressions: number;
        totalClicks: number;
        totalSpend: number;
        totalConversions: number;
        avgCtr: number;
        avgCpc: number;
        avgCpa: number;
        daily: Array<{ date: string; impressions: number; clicks: number; spend: number; conversions: number }>;
      }> = {};

      for (const id of campaignIds) {
        const rows = allRows.filter((r) => r.campaign_id === id);
        const totals = rows.reduce(
          (acc, r) => ({
            impressions: acc.impressions + Number(r.impressions),
            clicks: acc.clicks + Number(r.clicks),
            spend: acc.spend + Number(r.spend),
            conversions: acc.conversions + Number(r.conversions),
          }),
          { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
        );

        const dailyMap = new Map<string, { date: string; impressions: number; clicks: number; spend: number; conversions: number }>();
        for (const r of rows) {
          const existing = dailyMap.get(r.date);
          if (existing) {
            existing.impressions += Number(r.impressions);
            existing.clicks += Number(r.clicks);
            existing.spend += Number(r.spend);
            existing.conversions += Number(r.conversions);
          } else {
            dailyMap.set(r.date, {
              date: r.date,
              impressions: Number(r.impressions),
              clicks: Number(r.clicks),
              spend: Number(r.spend),
              conversions: Number(r.conversions),
            });
          }
        }

        campaigns[id] = {
          campaignId: id,
          campaignName: rows[0]?.campaign_name || id,
          platform: rows[0]?.platform || "unknown",
          totalImpressions: totals.impressions,
          totalClicks: totals.clicks,
          totalSpend: Number(totals.spend.toFixed(2)),
          totalConversions: totals.conversions,
          avgCtr: totals.impressions > 0 ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
          avgCpc: totals.clicks > 0 ? Number((totals.spend / totals.clicks).toFixed(2)) : 0,
          avgCpa: totals.conversions > 0 ? Number((totals.spend / totals.conversions).toFixed(2)) : 0,
          daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        };
      }

      return NextResponse.json(campaigns);
    }

    default: {
      const data = await getMetrics(params);
      return NextResponse.json(data);
    }
  }
});
