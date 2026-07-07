import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { attributionJourneys, customerCohorts } from "@/lib/db/schema";
import { getMetrics } from "./queries";
import type { AttributionModel, CohortRetentionPoint, Platform } from "@/lib/types/database";

const PLATFORMS: Platform[] = ["google", "meta", "tiktok"];

interface JourneyRecord {
  client_id: string;
  conversion_date: string;
  revenue: number;
  path: Platform[];
  converting_platform: Platform;
  touch_count: number;
}

async function fetchJourneys(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<JourneyRecord[]> {
  const conditions = [
    eq(attributionJourneys.clientId, params.clientId),
    gte(attributionJourneys.conversionDate, params.startDate),
    lte(attributionJourneys.conversionDate, params.endDate),
  ];
  if (params.platform) {
    conditions.push(eq(attributionJourneys.convertingPlatform, params.platform));
  }

  const rows = await db
    .select({
      client_id: attributionJourneys.clientId,
      conversion_date: attributionJourneys.conversionDate,
      revenue: attributionJourneys.revenue,
      path: attributionJourneys.path,
      converting_platform: attributionJourneys.convertingPlatform,
      touch_count: attributionJourneys.touchCount,
    })
    .from(attributionJourneys)
    .where(and(...conditions));

  return rows.map((r) => ({
    ...r,
    path: r.path as Platform[],
    converting_platform: r.converting_platform as Platform,
  }));
}

// --- action=overview ---

export interface RevenueOverviewPlatform {
  platform: Platform;
  spend: number;
  reportedConversions: number;
  reportedRevenue: number;
  reportedRoas: number;
  blendedConversions: number;
  blendedRevenue: number;
  blendedRoas: number;
  roasGap: number;
}

export interface RevenueOverview {
  totalSpend: number;
  blended: { conversions: number; revenue: number; roas: number; cpa: number; aov: number };
  platformReported: { conversions: number; revenue: number; roas: number };
  overAttribution: { conversionsClaimed: number; conversionsActual: number; inflationPct: number };
  platforms: RevenueOverviewPlatform[];
  insight: string;
}

export async function getRevenueOverview(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<RevenueOverview> {
  const [metricRows, journeys] = await Promise.all([
    getMetrics(params),
    fetchJourneys(params),
  ]);

  const reportedAgg = new Map<Platform, { spend: number; conversions: number; revenue: number }>();
  for (const row of metricRows) {
    const existing = reportedAgg.get(row.platform) || { spend: 0, conversions: 0, revenue: 0 };
    existing.spend += Number(row.spend);
    existing.conversions += Number(row.conversions);
    existing.revenue += Number(row.revenue);
    reportedAgg.set(row.platform, existing);
  }

  const blendedAgg = new Map<Platform, { conversions: number; revenue: number }>();
  for (const journey of journeys) {
    const existing = blendedAgg.get(journey.converting_platform) || { conversions: 0, revenue: 0 };
    existing.conversions += 1;
    existing.revenue += Number(journey.revenue);
    blendedAgg.set(journey.converting_platform, existing);
  }

  const platformList = params.platform ? [params.platform] : PLATFORMS;

  const platforms: RevenueOverviewPlatform[] = platformList.map((platform) => {
    const reported = reportedAgg.get(platform) || { spend: 0, conversions: 0, revenue: 0 };
    const blended = blendedAgg.get(platform) || { conversions: 0, revenue: 0 };
    const reportedRoas = reported.spend > 0 ? Number((reported.revenue / reported.spend).toFixed(2)) : 0;
    const blendedRoas = reported.spend > 0 ? Number((blended.revenue / reported.spend).toFixed(2)) : 0;

    return {
      platform,
      spend: Number(reported.spend.toFixed(2)),
      reportedConversions: reported.conversions,
      reportedRevenue: Number(reported.revenue.toFixed(2)),
      reportedRoas,
      blendedConversions: blended.conversions,
      blendedRevenue: Number(blended.revenue.toFixed(2)),
      blendedRoas,
      roasGap: Number((reportedRoas - blendedRoas).toFixed(2)),
    };
  });

  const totalSpend = platforms.reduce((s, p) => s + p.spend, 0);
  const platformReportedConversions = platforms.reduce((s, p) => s + p.reportedConversions, 0);
  const platformReportedRevenue = platforms.reduce((s, p) => s + p.reportedRevenue, 0);
  const blendedConversions = platforms.reduce((s, p) => s + p.blendedConversions, 0);
  const blendedRevenue = platforms.reduce((s, p) => s + p.blendedRevenue, 0);

  const blended = {
    conversions: blendedConversions,
    revenue: Number(blendedRevenue.toFixed(2)),
    roas: totalSpend > 0 ? Number((blendedRevenue / totalSpend).toFixed(2)) : 0,
    cpa: blendedConversions > 0 ? Number((totalSpend / blendedConversions).toFixed(2)) : 0,
    aov: blendedConversions > 0 ? Number((blendedRevenue / blendedConversions).toFixed(2)) : 0,
  };

  const platformReported = {
    conversions: platformReportedConversions,
    revenue: Number(platformReportedRevenue.toFixed(2)),
    roas: totalSpend > 0 ? Number((platformReportedRevenue / totalSpend).toFixed(2)) : 0,
  };

  const inflationPct =
    blendedConversions > 0
      ? Number((((platformReportedConversions - blendedConversions) / blendedConversions) * 100).toFixed(1))
      : 0;

  const overAttribution = {
    conversionsClaimed: platformReportedConversions,
    conversionsActual: blendedConversions,
    inflationPct,
  };

  const worstGapPlatform = [...platforms].sort((a, b) => b.roasGap - a.roasGap)[0];

  const insight = worstGapPlatform
    ? `Platforms collectively claim ${inflationPct.toFixed(0)}% more conversions than actually happened (${platformReportedConversions} reported vs ${blendedConversions} real, deduplicated). ${worstGapPlatform.platform.charAt(0).toUpperCase() + worstGapPlatform.platform.slice(1)} shows the widest gap between self-reported ROAS (${worstGapPlatform.reportedRoas}x) and blended real ROAS (${worstGapPlatform.blendedRoas}x).`
    : "Not enough data to compute an over-attribution insight for this range.";

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    blended,
    platformReported,
    overAttribution,
    platforms,
    insight,
  };
}

// --- action=attribution ---

const MODEL_LABELS: Record<AttributionModel, string> = {
  first_touch: "First Touch",
  last_touch: "Last Touch",
  linear: "Linear",
  time_decay: "Time Decay",
  position_based: "Position Based (40/20/40)",
};

function creditWeights(path: Platform[], model: AttributionModel): number[] {
  const n = path.length;
  if (n === 1) return [1];

  switch (model) {
    case "first_touch": {
      const w = new Array(n).fill(0);
      w[0] = 1;
      return w;
    }
    case "last_touch": {
      const w = new Array(n).fill(0);
      w[n - 1] = 1;
      return w;
    }
    case "linear": {
      return new Array(n).fill(1 / n);
    }
    case "time_decay": {
      const raw = path.map((_, i) => Math.pow(2, i));
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((v) => v / sum);
    }
    case "position_based": {
      if (n === 2) return [0.5, 0.5];
      const w = new Array(n).fill(0);
      w[0] = 0.4;
      w[n - 1] = 0.4;
      const middleShare = 0.2 / (n - 2);
      for (let i = 1; i < n - 1; i++) w[i] = middleShare;
      return w;
    }
  }
}

export interface AttributionModelCredit {
  platform: Platform;
  revenue: number;
  conversions: number;
  roas: number;
  sharePct: number;
}

export interface AttributionModelResult {
  model: AttributionModel;
  label: string;
  credit: AttributionModelCredit[];
}

export interface AttributionComparison {
  totalRevenue: number;
  totalConversions: number;
  models: AttributionModelResult[];
  platformReported: Array<{ platform: Platform; revenue: number; roas: number; sharePct: number }>;
  insight: string;
}

export async function getAttributionComparison(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<AttributionComparison> {
  const [metricRows, journeys] = await Promise.all([
    getMetrics({ clientId: params.clientId, startDate: params.startDate, endDate: params.endDate }),
    fetchJourneys({ clientId: params.clientId, startDate: params.startDate, endDate: params.endDate }),
  ]);

  const spendByPlatform = new Map<Platform, number>();
  const reportedRevenueByPlatform = new Map<Platform, number>();
  for (const row of metricRows) {
    spendByPlatform.set(row.platform, (spendByPlatform.get(row.platform) || 0) + Number(row.spend));
    reportedRevenueByPlatform.set(
      row.platform,
      (reportedRevenueByPlatform.get(row.platform) || 0) + Number(row.revenue)
    );
  }

  const totalRevenue = journeys.reduce((s, j) => s + Number(j.revenue), 0);
  const totalConversions = journeys.length;

  const models: AttributionModelResult[] = (
    ["first_touch", "last_touch", "linear", "time_decay", "position_based"] as AttributionModel[]
  ).map((model) => {
    const revenueByPlatform = new Map<Platform, number>();
    const conversionsByPlatform = new Map<Platform, number>();

    for (const journey of journeys) {
      const weights = creditWeights(journey.path, model);
      journey.path.forEach((platform, i) => {
        const w = weights[i];
        revenueByPlatform.set(platform, (revenueByPlatform.get(platform) || 0) + w * Number(journey.revenue));
        conversionsByPlatform.set(platform, (conversionsByPlatform.get(platform) || 0) + w);
      });
    }

    const credit: AttributionModelCredit[] = PLATFORMS.map((platform) => {
      const revenue = Number((revenueByPlatform.get(platform) || 0).toFixed(2));
      const conversions = Number((conversionsByPlatform.get(platform) || 0).toFixed(1));
      const spend = spendByPlatform.get(platform) || 0;
      return {
        platform,
        revenue,
        conversions,
        roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
        sharePct: totalRevenue > 0 ? Number(((revenue / totalRevenue) * 100).toFixed(1)) : 0,
      };
    });

    return { model, label: MODEL_LABELS[model], credit };
  });

  const totalReportedRevenue = Array.from(reportedRevenueByPlatform.values()).reduce((a, b) => a + b, 0);
  const platformReported = PLATFORMS.map((platform) => {
    const revenue = Number((reportedRevenueByPlatform.get(platform) || 0).toFixed(2));
    const spend = spendByPlatform.get(platform) || 0;
    return {
      platform,
      revenue,
      roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
      sharePct: totalReportedRevenue > 0 ? Number(((revenue / totalReportedRevenue) * 100).toFixed(1)) : 0,
    };
  });

  const lastTouch = models.find((m) => m.model === "last_touch")!;
  const firstTouch = models.find((m) => m.model === "first_touch")!;
  const googleLast = lastTouch.credit.find((c) => c.platform === "google")!;
  const googleFirst = firstTouch.credit.find((c) => c.platform === "google")!;
  const gap = Number((googleLast.sharePct - googleFirst.sharePct).toFixed(1));

  const insight =
    gap > 0
      ? `Google captures ${googleLast.sharePct}% of revenue credit under Last Touch but only ${googleFirst.sharePct}% under First Touch — a ${gap}pt gap. Google is harvesting demand created upstream by TikTok and Meta rather than generating it.`
      : `Google's revenue credit is similar across models (${googleLast.sharePct}% last touch vs ${googleFirst.sharePct}% first touch), suggesting less reliance on upper-funnel assist from other platforms.`;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalConversions,
    models,
    platformReported,
    insight,
  };
}

// --- action=cohorts ---

export interface CohortCurvePoint {
  monthOffset: number;
  cumulativeRevenuePerCustomer: number;
  retentionPct: number;
}

export interface PlatformCohort {
  platform: Platform;
  customers: number;
  acquisitionSpend: number;
  cac: number;
  ltv: number;
  ltvCacRatio: number;
  paybackMonths: number | null;
  day0Roas: number;
  curve: CohortCurvePoint[];
}

export interface CohortByMonth {
  platform: Platform;
  cohortMonth: string;
  customers: number;
  cac: number;
  retention: CohortRetentionPoint[];
}

export interface CohortAnalysis {
  cohorts: PlatformCohort[];
  byMonth: CohortByMonth[];
  insight: string;
}

export async function getCohortAnalysis(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<CohortAnalysis> {
  const startMonth = params.startDate.substring(0, 7);
  const endMonth = params.endDate.substring(0, 7);

  const conditions = [
    eq(customerCohorts.clientId, params.clientId),
    gte(customerCohorts.cohortMonth, startMonth),
    lte(customerCohorts.cohortMonth, endMonth),
  ];
  if (params.platform) {
    conditions.push(eq(customerCohorts.acquisitionPlatform, params.platform));
  }

  const rows = await db
    .select({
      platform: customerCohorts.acquisitionPlatform,
      cohort_month: customerCohorts.cohortMonth,
      customers: customerCohorts.customers,
      acquisition_spend: customerCohorts.acquisitionSpend,
      retention: customerCohorts.retention,
    })
    .from(customerCohorts)
    .where(and(...conditions));

  const byMonth: CohortByMonth[] = rows.map((r) => ({
    platform: r.platform as Platform,
    cohortMonth: r.cohort_month,
    customers: r.customers,
    cac: r.customers > 0 ? Number((Number(r.acquisition_spend) / r.customers).toFixed(2)) : 0,
    retention: r.retention as CohortRetentionPoint[],
  }));

  const platformList = params.platform ? [params.platform] : PLATFORMS;

  const cohorts: PlatformCohort[] = platformList.map((platform) => {
    const platformRows = rows.filter((r) => r.platform === platform);
    const customers = platformRows.reduce((s, r) => s + r.customers, 0);
    const acquisitionSpend = platformRows.reduce((s, r) => s + Number(r.acquisition_spend), 0);
    const cac = customers > 0 ? acquisitionSpend / customers : 0;

    const revenueByOffset = new Map<number, number>();
    for (const row of platformRows) {
      for (const point of row.retention as CohortRetentionPoint[]) {
        revenueByOffset.set(point.monthOffset, (revenueByOffset.get(point.monthOffset) || 0) + point.revenue);
      }
    }

    const offsets = Array.from(revenueByOffset.keys()).sort((a, b) => a - b);
    let cumulative = 0;
    const curve: CohortCurvePoint[] = offsets.map((offset) => {
      cumulative += revenueByOffset.get(offset) || 0;
      const cumulativeRevenuePerCustomer = customers > 0 ? Number((cumulative / customers).toFixed(2)) : 0;
      return {
        monthOffset: offset,
        cumulativeRevenuePerCustomer,
        retentionPct: 0,
      };
    });

    // retentionPct requires active-customer aggregation per offset.
    const activeByOffset = new Map<number, number>();
    for (const row of platformRows) {
      for (const point of row.retention as CohortRetentionPoint[]) {
        activeByOffset.set(point.monthOffset, (activeByOffset.get(point.monthOffset) || 0) + point.activeCustomers);
      }
    }
    for (const point of curve) {
      const active = activeByOffset.get(point.monthOffset) || 0;
      point.retentionPct = customers > 0 ? Number(((active / customers) * 100).toFixed(1)) : 0;
    }

    const ltv = curve.length > 0 ? curve[curve.length - 1].cumulativeRevenuePerCustomer : 0;
    const ltvCacRatio = cac > 0 ? Number((ltv / cac).toFixed(2)) : 0;

    const paybackPoint = curve.find((p) => p.cumulativeRevenuePerCustomer >= cac);
    const paybackMonths = paybackPoint ? paybackPoint.monthOffset : null;

    const month0Revenue = revenueByOffset.get(0) || 0;
    const day0Roas = acquisitionSpend > 0 ? Number((month0Revenue / acquisitionSpend).toFixed(2)) : 0;

    return {
      platform,
      customers,
      acquisitionSpend: Number(acquisitionSpend.toFixed(2)),
      cac: Number(cac.toFixed(2)),
      ltv,
      ltvCacRatio,
      paybackMonths,
      day0Roas,
      curve,
    };
  });

  const best = [...cohorts].sort((a, b) => b.ltvCacRatio - a.ltvCacRatio)[0];
  const bestDay0 = [...cohorts].sort((a, b) => b.day0Roas - a.day0Roas)[0];

  const insight =
    best && bestDay0 && best.platform !== bestDay0.platform
      ? `${bestDay0.platform.charAt(0).toUpperCase() + bestDay0.platform.slice(1)} has the best Day-0 ROAS (${bestDay0.day0Roas}x) but ${best.platform.charAt(0).toUpperCase() + best.platform.slice(1)} has the best LTV:CAC ratio (${best.ltvCacRatio}x) thanks to stronger retention — short-window ROAS ranking inverts once you look at customer lifetime value.`
      : "Not enough cohort variance in this range to surface an LTV vs. short-window ROAS inversion.";

  return { cohorts, byMonth, insight };
}
