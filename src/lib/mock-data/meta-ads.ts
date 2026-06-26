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

export interface MetaAdsAction {
  action_type: string;
  value: string;
}

export interface MetaAdsRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  date_stop: string;
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
  cpc: string;
  cpm: string;
  actions: MetaAdsAction[];
}

interface CampaignSeed {
  id: string;
  name: string;
  baseImpressions: number;
  baseCtr: number;
  baseCpc: number;
  trend: "up" | "down" | "stable";
}

const META_CAMPAIGNS: CampaignSeed[] = [
  {
    id: "m-camp-001",
    name: "Prospecting — Lookalike 1%",
    baseImpressions: 65000,
    baseCtr: 0.018,
    baseCpc: 0.52,
    trend: "up",
  },
  {
    id: "m-camp-002",
    name: "Retargeting — Website Visitors",
    baseImpressions: 22000,
    baseCtr: 0.042,
    baseCpc: 0.95,
    trend: "stable",
  },
  {
    id: "m-camp-003",
    name: "Catalog Sales — Dynamic Product",
    baseImpressions: 110000,
    baseCtr: 0.012,
    baseCpc: 0.35,
    trend: "down",
  },
  {
    id: "m-camp-004",
    name: "Instagram Stories — Lead Gen",
    baseImpressions: 40000,
    baseCtr: 0.025,
    baseCpc: 0.72,
    trend: "up",
  },
];

export function generateMetaAdsData(
  startDate: Date,
  endDate: Date
): MetaAdsRow[] {
  const dates = generateDateRange(startDate, endDate);
  const anomalies = generateAnomalies(dates.length);
  const rows: MetaAdsRow[] = [];

  for (const campaign of META_CAMPAIGNS) {
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
      let conversionRate = randomBetween(0.015, 0.045);

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
      const linkClicks = Math.round(clicks * randomBetween(0.7, 0.9));
      const purchases = conversions;

      rows.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        date_start: date,
        date_stop: date,
        impressions: String(impressions),
        clicks: String(clicks),
        spend: String(spend),
        ctr: String(round(ctr, 4)),
        cpc: String(round(cpc, 2)),
        cpm: String(cpm),
        actions: [
          { action_type: "link_click", value: String(linkClicks) },
          { action_type: "purchase", value: String(purchases) },
          { action_type: "add_to_cart", value: String(Math.round(purchases * randomBetween(2, 4))) },
          { action_type: "page_view", value: String(Math.round(linkClicks * randomBetween(1.5, 3))) },
        ],
      });
    }
  }

  return rows;
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
