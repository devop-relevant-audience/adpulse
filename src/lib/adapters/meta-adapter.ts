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
    const purchaseValueAction = row.action_values.find(
      (a) => a.action_type === "purchase"
    );
    const revenue = purchaseValueAction ? Number(purchaseValueAction.value) : 0;

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
      revenue: round(revenue, 2),
      currency: "USD",
      raw_payload: row as unknown as Record<string, unknown>,
    };
  });
}
