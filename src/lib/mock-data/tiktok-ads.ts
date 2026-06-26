import {
  generateDateRange,
  randomBetween,
  round,
  weekdayMultiplier,
  trendMultiplier,
  monthlySeasonality,
  generateAnomalies,
  isInAnomalyWindow,
  type AnomalyConfig,
} from "./helpers";

export interface TikTokAdsRow {
  dimensions: {
    campaign_id: string;
    campaign_name: string;
    stat_time_day: string;
  };
  metrics: {
    impressions: string;
    clicks: string;
    spend: string;
    conversion: string;
    ctr: string;
    cpc: string;
    cpm: string;
  };
}

export interface TikTokAdsResponse {
  code: number;
  message: string;
  data: {
    list: TikTokAdsRow[];
    page_info: {
      total_number: number;
      page: number;
      page_size: number;
    };
  };
}

interface CampaignSeed {
  id: string;
  name: string;
  baseImpressions: number;
  baseCtr: number;
  baseCpc: number;
  trend: "up" | "down" | "stable";
}

const TIKTOK_CAMPAIGNS: CampaignSeed[] = [
  {
    id: "tt-camp-001",
    name: "In-Feed — UGC Creative A",
    baseImpressions: 150000,
    baseCtr: 0.009,
    baseCpc: 0.18,
    trend: "up",
  },
  {
    id: "tt-camp-002",
    name: "TopView — Brand Awareness",
    baseImpressions: 320000,
    baseCtr: 0.006,
    baseCpc: 0.12,
    trend: "stable",
  },
  {
    id: "tt-camp-003",
    name: "Spark Ads — Influencer Boost",
    baseImpressions: 95000,
    baseCtr: 0.015,
    baseCpc: 0.42,
    trend: "down",
  },
  {
    id: "tt-camp-004",
    name: "Catalog — Smart+ Shopping",
    baseImpressions: 180000,
    baseCtr: 0.011,
    baseCpc: 0.25,
    trend: "up",
  },
];

export function generateTikTokAdsData(
  startDate: Date,
  endDate: Date
): TikTokAdsResponse {
  const dates = generateDateRange(startDate, endDate);
  const anomalies = generateAnomalies(dates.length);
  const list: TikTokAdsRow[] = [];

  for (const campaign of TIKTOK_CAMPAIGNS) {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const wdm = weekdayMultiplier(date);
      const tm = trendMultiplier(i, dates.length, campaign.trend);
      const sm = monthlySeasonality(date);

      let impressions = Math.round(
        campaign.baseImpressions * wdm * tm * sm * randomBetween(0.85, 1.15)
      );
      let ctr = campaign.baseCtr * randomBetween(0.9, 1.1);
      let cpc = campaign.baseCpc * randomBetween(0.85, 1.15);
      let conversionRate = randomBetween(0.01, 0.035);

      for (const anomaly of anomalies) {
        if (isInAnomalyWindow(i, anomaly)) {
          ({ impressions, ctr, cpc, conversionRate } = applyAnomaly(
            anomaly, impressions, ctr, cpc, conversionRate
          ));
        }
      }

      const clicks = Math.round(impressions * ctr);
      const spend = round(clicks * cpc, 2);
      const conversions = Math.round(clicks * conversionRate);
      const cpm = round((spend / impressions) * 1000, 2);

      list.push({
        dimensions: {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          stat_time_day: `${date} 00:00:00`,
        },
        metrics: {
          impressions: String(impressions),
          clicks: String(clicks),
          spend: String(spend),
          conversion: String(conversions),
          ctr: String(round(ctr, 4)),
          cpc: String(round(cpc, 2)),
          cpm: String(cpm),
        },
      });
    }
  }

  return {
    code: 0,
    message: "OK",
    data: {
      list,
      page_info: { total_number: list.length, page: 1, page_size: list.length },
    },
  };
}

function applyAnomaly(
  anomaly: AnomalyConfig,
  impressions: number,
  ctr: number,
  cpc: number,
  conversionRate: number
) {
  switch (anomaly.type) {
    case "ctr_drop":
    case "creative_fatigue":
      return { impressions, ctr: ctr * anomaly.multiplier, cpc, conversionRate };
    case "cpm_spike":
      return { impressions, ctr, cpc: cpc * anomaly.multiplier, conversionRate };
    case "conversion_cliff":
      return { impressions, ctr, cpc, conversionRate: conversionRate * anomaly.multiplier };
    case "spend_surge":
      return { impressions: Math.round(impressions * anomaly.multiplier), ctr, cpc, conversionRate };
    case "budget_cut":
      return { impressions: Math.round(impressions * anomaly.multiplier), ctr, cpc: cpc * 0.8, conversionRate };
    case "audience_saturation":
      return { impressions, ctr: ctr * anomaly.multiplier, cpc: cpc * 1.3, conversionRate: conversionRate * 0.7 };
  }
}
