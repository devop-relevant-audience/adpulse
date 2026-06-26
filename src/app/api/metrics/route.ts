import { NextRequest, NextResponse } from "next/server";
import { getMetrics, compareMetrics, getDailyTrend, detectAnomalies, getFunnelData, getCampaignPacing } from "@/lib/data/queries";
import { calculateHealthScore } from "@/lib/data/health-score";
import { z } from "zod";
import type { Platform } from "@/lib/types/database";

const metricsSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
  campaignId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") || "raw";

    const parsed = metricsSchema.safeParse({
      clientId: searchParams.get("clientId"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      platform: searchParams.get("platform") || undefined,
      campaignId: searchParams.get("campaignId") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const params = {
      ...parsed.data,
      platform: parsed.data.platform as Platform | undefined,
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
        });
        return NextResponse.json(result);
      }

      case "trend": {
        const trend = await getDailyTrend(params);
        return NextResponse.json(trend);
      }

      case "anomalies": {
        const anomalies = await detectAnomalies(params);
        return NextResponse.json(anomalies);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
