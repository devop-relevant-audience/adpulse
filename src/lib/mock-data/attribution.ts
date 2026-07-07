import { randomBetween, round } from "./helpers";
import type {
  CampaignPerformanceInsert,
  AttributionJourneyInsert,
  CustomerCohortInsert,
  CohortRetentionPoint,
  Platform,
} from "@/lib/types/database";

// Weighted journey-path templates. Weighted so aggregate LAST-touch attribution
// skews Google (bottom-funnel harvester) while aggregate FIRST-touch skews
// TikTok/Meta (top-funnel demand creators) — this is the model-divergence story.
const PATH_TEMPLATES: Array<{ path: Platform[]; weight: number }> = [
  { path: ["tiktok", "meta", "google"], weight: 18 },
  { path: ["tiktok", "google"], weight: 14 },
  { path: ["meta", "google"], weight: 14 },
  { path: ["tiktok", "meta"], weight: 8 },
  { path: ["meta", "meta"], weight: 6 },
  { path: ["google"], weight: 16 },
  { path: ["meta"], weight: 9 },
  { path: ["tiktok"], weight: 6 },
  { path: ["tiktok", "meta", "meta", "google"], weight: 9 },
];

const TOTAL_TEMPLATE_WEIGHT = PATH_TEMPLATES.reduce((s, t) => s + t.weight, 0);

function samplePath(): Platform[] {
  let r = Math.random() * TOTAL_TEMPLATE_WEIGHT;
  for (const template of PATH_TEMPLATES) {
    if (r < template.weight) return [...template.path];
    r -= template.weight;
  }
  return [...PATH_TEMPLATES[PATH_TEMPLATES.length - 1].path];
}

function weightedDateSample(
  dateWeights: Array<{ date: string; weight: number }>,
  totalWeight: number
): string {
  let r = Math.random() * totalWeight;
  for (const dw of dateWeights) {
    if (r < dw.weight) return dw.date;
    r -= dw.weight;
  }
  return dateWeights[dateWeights.length - 1].date;
}

const BLENDED_AOV = 78;

/**
 * Generate deduplicated (real) cross-platform conversion journeys from
 * already-normalized, already-seeded campaign_performance rows for ONE client,
 * so the blended totals reconcile against real seeded platform-reported totals.
 * Blended conversions ≈ 74% of summed platform-reported conversions (platforms
 * collectively over-claim ~35% vs reality).
 */
export function generateAttributionJourneys(
  rows: CampaignPerformanceInsert[],
  clientId: string
): AttributionJourneyInsert[] {
  const dateConversions = new Map<string, number>();
  let sumReportedConversions = 0;
  for (const row of rows) {
    dateConversions.set(row.date, (dateConversions.get(row.date) || 0) + row.conversions);
    sumReportedConversions += row.conversions;
  }

  const dateWeights = Array.from(dateConversions.entries())
    .filter(([, conversions]) => conversions > 0)
    .map(([date, conversions]) => ({ date, weight: conversions }));
  const totalWeight = dateWeights.reduce((s, d) => s + d.weight, 0);

  const blendedTotal = Math.round(0.74 * sumReportedConversions);

  const journeys: AttributionJourneyInsert[] = [];
  if (totalWeight === 0 || dateWeights.length === 0) return journeys;

  for (let i = 0; i < blendedTotal; i++) {
    const conversionDate = weightedDateSample(dateWeights, totalWeight);
    const path = samplePath();
    const convertingPlatform = path[path.length - 1];

    let revenue = round(BLENDED_AOV * randomBetween(0.55, 1.7), 2);
    if (Math.random() < 0.08) {
      revenue = round(revenue * randomBetween(2.5, 4), 2);
    }

    journeys.push({
      client_id: clientId,
      conversion_date: conversionDate,
      revenue,
      path,
      converting_platform: convertingPlatform,
      touch_count: path.length,
    });
  }

  return journeys;
}

interface CohortParams {
  newCustomerRate: number;
  day0Roas: number;
  monthlyRetention: number;
}

// Tuned so LTV:CAC inverts short-window ROAS ranking: TikTok wins on Day-0 ROAS
// but has the worst retention (~1.8 LTV:CAC); Google is the opposite (~4.5).
const COHORT_PARAMS: Record<Platform, CohortParams> = {
  google: { newCustomerRate: 0.55, day0Roas: 0.7, monthlyRetention: 0.88 },
  meta: { newCustomerRate: 0.65, day0Roas: 1.3, monthlyRetention: 0.66 },
  tiktok: { newCustomerRate: 0.75, day0Roas: 2.4, monthlyRetention: 0.30 },
};

const RETENTION_MONTHS = 12;

/**
 * Generate per-platform, per-acquisition-month customer cohorts with a
 * projected 12-month retention curve, from already-normalized campaign_performance
 * rows for ONE client.
 */
export function generateCustomerCohorts(
  rows: CampaignPerformanceInsert[],
  clientId: string
): CustomerCohortInsert[] {
  const agg = new Map<
    string,
    { platform: Platform; month: string; spend: number; conversions: number }
  >();

  for (const row of rows) {
    const month = row.date.substring(0, 7);
    const key = `${row.platform}|${month}`;
    const existing = agg.get(key);
    if (existing) {
      existing.spend += row.spend;
      existing.conversions += row.conversions;
    } else {
      agg.set(key, { platform: row.platform, month, spend: row.spend, conversions: row.conversions });
    }
  }

  const cohorts: CustomerCohortInsert[] = [];

  for (const { platform, month, spend, conversions } of agg.values()) {
    const params = COHORT_PARAMS[platform];
    const acquisitionSpend = round(spend, 2);
    const customers = Math.max(1, Math.round(conversions * params.newCustomerRate));
    const cac = acquisitionSpend / customers;

    const retention: CohortRetentionPoint[] = [];
    for (let offset = 0; offset < RETENTION_MONTHS; offset++) {
      const activeCustomers = Math.round(customers * Math.pow(params.monthlyRetention, offset));
      const revenue = round(
        customers * (cac * params.day0Roas) * Math.pow(params.monthlyRetention, offset),
        2
      );
      retention.push({ monthOffset: offset, revenue, activeCustomers });
    }

    cohorts.push({
      client_id: clientId,
      acquisition_platform: platform,
      cohort_month: month,
      customers,
      acquisition_spend: acquisitionSpend,
      retention,
    });
  }

  return cohorts;
}
