import type { GoogleAdsRow } from "@/lib/mock-data/google-ads";
import type { CampaignPerformanceInsert } from "@/lib/types/database";
import { round } from "@/lib/mock-data/helpers";

export function normalizeGoogleAds(
  rows: GoogleAdsRow[],
  clientId: string
): CampaignPerformanceInsert[] {
  return rows.map((row) => {
    const costMicros = Number(row.metrics.costMicros);
    const spend = round(costMicros / 1_000_000, 2);

    return {
      client_id: clientId,
      platform: "google" as const,
      campaign_id: row.campaign.id,
      campaign_name: row.campaign.name,
      date: row.segments.date,
      impressions: Number(row.metrics.impressions),
      clicks: Number(row.metrics.clicks),
      spend,
      conversions: round(Number(row.metrics.conversions), 4),
      revenue: round(Number(row.metrics.conversionsValue), 2),
      currency: "USD",
      raw_payload: row as unknown as Record<string, unknown>,
    };
  });
}
