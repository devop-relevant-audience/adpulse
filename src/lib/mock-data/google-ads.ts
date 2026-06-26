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

export interface GoogleAdsRow {
  campaign: {
    id: string;
    name: string;
    status: string;
  };
  metrics: {
    impressions: string;
    clicks: string;
    costMicros: string;
    conversions: string;
    ctr: string;
    averageCpc: string;
    averageCpm: string;
  };
  segments: {
    date: string;
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

const GOOGLE_CAMPAIGNS: CampaignSeed[] = [
  {
    id: "g-camp-001",
    name: "Brand Search — Exact Match",
    baseImpressions: 12000,
    baseCtr: 0.082,
    baseCpc: 1.45,
    trend: "stable",
  },
  {
    id: "g-camp-002",
    name: "Product — Performance Max",
    baseImpressions: 45000,
    baseCtr: 0.031,
    baseCpc: 0.68,
    trend: "up",
  },
  {
    id: "g-camp-003",
    name: "Retargeting — Display",
    baseImpressions: 85000,
    baseCtr: 0.008,
    baseCpc: 0.22,
    trend: "down",
  },
  {
    id: "g-camp-004",
    name: "Competitor Keywords — Broad",
    baseImpressions: 28000,
    baseCtr: 0.045,
    baseCpc: 2.10,
    trend: "up",
  },
  {
    id: "g-camp-005",
    name: "YouTube Pre-Roll — Awareness",
    baseImpressions: 200000,
    baseCtr: 0.004,
    baseCpc: 0.08,
    trend: "stable",
  },
];

export function generateGoogleAdsData(
  startDate: Date,
  endDate: Date
): GoogleAdsRow[] {
  const dates = generateDateRange(startDate, endDate);
  const anomalies = generateAnomalies(dates.length);
  const rows: GoogleAdsRow[] = [];

  for (const campaign of GOOGLE_CAMPAIGNS) {
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
      let conversionRate = randomBetween(0.02, 0.06);

      for (const anomaly of anomalies) {
        if (isInAnomalyWindow(i, anomaly)) {
          ({ impressions, ctr, cpc, conversionRate } = applyAnomaly(
            anomaly, impressions, ctr, cpc, conversionRate
          ));
        }
      }

      const clicks = Math.round(impressions * ctr);
      const costMicros = Math.round(clicks * cpc * 1_000_000);
      const conversions = Math.round(clicks * conversionRate);
      const cpm = (costMicros / 1_000_000 / impressions) * 1000;

      rows.push({
        campaign: { id: campaign.id, name: campaign.name, status: "ENABLED" },
        metrics: {
          impressions: String(impressions),
          clicks: String(clicks),
          costMicros: String(costMicros),
          conversions: String(round(conversions, 1)),
          ctr: String(round(ctr, 4)),
          averageCpc: String(round(cpc, 2)),
          averageCpm: String(round(cpm, 2)),
        },
        segments: { date },
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
