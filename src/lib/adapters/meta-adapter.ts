import type { MetaAdsRow } from "@/lib/mock-data/meta-ads";
import type { CampaignPerformanceInsert } from "@/lib/types/database";
import { round } from "@/lib/mock-data/helpers";

export function normalizeMetaAds(
  rows: MetaAdsRow[],
  clientId: string
): CampaignPerformanceInsert[] {
  return rows.map((row) => {
    const purchaseAction = row.actions.find(
      (a) => a.action_type === "purchase"
    );
    const conversions = purchaseAction ? Number(purchaseAction.value) : 0;

    return {
      client_id: clientId,
      platform: "meta" as const,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      date: row.date_start,
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      spend: round(Number(row.spend), 2),
      conversions,
      ctr: round(Number(row.ctr) * 100, 2),
      cpc: round(Number(row.cpc), 4),
      cpm: round(Number(row.cpm), 4),
      raw_payload: row as unknown as Record<string, unknown>,
    };
  });
}
