import type { TikTokAdsResponse } from "@/lib/mock-data/tiktok-ads";
import type { CampaignPerformanceInsert } from "@/lib/types/database";
import { round } from "@/lib/mock-data/helpers";

export function normalizeTikTokAds(
  response: TikTokAdsResponse,
  clientId: string
): CampaignPerformanceInsert[] {
  return response.data.list.map((row) => {
    const dateStr = row.dimensions.stat_time_day.split(" ")[0];

    return {
      client_id: clientId,
      platform: "tiktok" as const,
      campaign_id: row.dimensions.campaign_id,
      campaign_name: row.dimensions.campaign_name,
      date: dateStr,
      impressions: Number(row.metrics.impressions),
      clicks: Number(row.metrics.clicks),
      spend: round(Number(row.metrics.spend), 2),
      conversions: Number(row.metrics.conversion),
      ctr: round(Number(row.metrics.ctr) * 100, 2),
      cpc: round(Number(row.metrics.cpc), 4),
      cpm: round(Number(row.metrics.cpm), 4),
      raw_payload: row as unknown as Record<string, unknown>,
    };
  });
}
