import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

/**
 * Per-campaign summed totals — the shared aggregation core behind the classic
 * campaign table and its dashboard-widget twin. Sums raw metric rows by
 * `campaign_id`; callers derive their own ratios (CTR/CPC/CPA) and rounding on
 * top so each view keeps its exact output shape.
 */
export interface CampaignTotals {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export function aggregateCampaignTotals(rows: CampaignPerformanceRow[]): CampaignTotals[] {
  const map = new Map<string, CampaignTotals>();

  for (const row of rows) {
    const existing = map.get(row.campaign_id);
    if (existing) {
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.spend += Number(row.spend);
      existing.conversions += Number(row.conversions);
    } else {
      map.set(row.campaign_id, {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        platform: row.platform,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(map.values());
}
