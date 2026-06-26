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
