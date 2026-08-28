import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adAccounts,
  adCreatives,
  campaignBudgets,
  campaignPerformance,
  clients,
} from "@/lib/db/schema";
import type {
  Platform,
  AdCreativeRow,
  CampaignPerformanceRow,
  ClientRow,
  CreativeStatus,
} from "@/lib/types/database";
import { DEFAULT_CURRENCY } from "@/lib/format";

type AdCreativeSelect = typeof adCreatives.$inferSelect;

// Map a Drizzle (camelCase) ad_creatives row onto the snake_case `AdCreativeRow`
// shape that the rest of the app and the chat tools consume.
function toAdCreativeRow(row: AdCreativeSelect): AdCreativeRow {
  return {
    id: row.id,
    client_id: row.clientId,
    campaign_id: row.campaignId,
    platform: row.platform as AdCreativeRow["platform"],
    ad_id: row.adId,
    ad_name: row.adName,
    creative_type: row.creativeType as AdCreativeRow["creative_type"],
    headline: row.headline,
    body_copy: row.bodyCopy,
    thumbnail_url: row.thumbnailUrl,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    conversions: row.conversions,
    ctr: row.ctr,
    cpc: row.cpc,
    cpa: row.cpa,
    first_served: row.firstServed,
    last_served: row.lastServed,
    days_running: row.daysRunning,
    status: row.status as AdCreativeRow["status"],
    created_at: row.createdAt,
  };
}

export async function getClients(): Promise<ClientRow[]> {
  // Account currency = currency of every fact row for the client. One account
  // per client today; `min` keeps this deterministic if that changes.
  const accountCurrency = db
    .select({
      clientId: adAccounts.clientId,
      currency: sql<string>`min(${adAccounts.currency})`.as("currency"),
    })
    .from(adAccounts)
    .groupBy(adAccounts.clientId)
    .as("account_currency");
  return db
    .select({
      id: clients.id,
      name: clients.name,
      industry: clients.industry,
      is_demo: clients.isDemo,
      atlas_project_id: clients.atlasProjectId,
      created_at: clients.createdAt,
      currency: accountCurrency.currency,
    })
    .from(clients)
    .leftJoin(accountCurrency, eq(accountCurrency.clientId, clients.id))
    .orderBy(asc(clients.name));
}

/** Currency for server-side formatting (reports, chat, insights). Falls back to
 * DEFAULT_CURRENCY for clients without an ad account. */
export async function getClientCurrency(clientId: string): Promise<string> {
  const [row] = await db
    .select({ currency: adAccounts.currency })
    .from(adAccounts)
    .where(eq(adAccounts.clientId, clientId))
    .orderBy(asc(adAccounts.currency))
    .limit(1);
  return row?.currency ?? DEFAULT_CURRENCY;
}

export async function getMetrics(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
  platforms?: Platform[];
  campaignId?: string;
  campaignIds?: string[];
}): Promise<CampaignPerformanceRow[]> {
  const conditions = [
    eq(campaignPerformance.clientId, params.clientId),
    gte(campaignPerformance.date, params.startDate),
    lte(campaignPerformance.date, params.endDate),
  ];
  if (params.platform) {
    conditions.push(eq(campaignPerformance.platform, params.platform));
  }
  if (params.platforms?.length) {
    conditions.push(inArray(campaignPerformance.platform, params.platforms));
  }
  if (params.campaignId) {
    conditions.push(eq(campaignPerformance.campaignId, params.campaignId));
  }
  if (params.campaignIds?.length) {
    conditions.push(inArray(campaignPerformance.campaignId, params.campaignIds));
  }

  // ctr/cpc/cpm are not stored — computed from base counts in the projection
  // (ctr as a percent, matching the previous stored scale). raw_payload is
  // deliberately excluded from the serving shape.
  const rows = await db
    .select({
      id: campaignPerformance.id,
      client_id: campaignPerformance.clientId,
      ad_account_id: campaignPerformance.adAccountId,
      platform: campaignPerformance.platform,
      campaign_id: campaignPerformance.campaignId,
      campaign_name: campaignPerformance.campaignName,
      date: campaignPerformance.date,
      impressions: campaignPerformance.impressions,
      clicks: campaignPerformance.clicks,
      link_clicks: campaignPerformance.linkClicks,
      spend: campaignPerformance.spend,
      conversions: campaignPerformance.conversions,
      revenue: campaignPerformance.revenue,
      currency: campaignPerformance.currency,
      ctr: sql<number>`case when ${campaignPerformance.impressions} > 0 then round((${campaignPerformance.clicks}::numeric / ${campaignPerformance.impressions}) * 100, 2) else 0 end`.mapWith(Number),
      cpc: sql<number>`case when ${campaignPerformance.clicks} > 0 then round(${campaignPerformance.spend} / ${campaignPerformance.clicks}, 4) else 0 end`.mapWith(Number),
      cpm: sql<number>`case when ${campaignPerformance.impressions} > 0 then round((${campaignPerformance.spend} / ${campaignPerformance.impressions}) * 1000, 4) else 0 end`.mapWith(Number),
      created_at: campaignPerformance.createdAt,
    })
    .from(campaignPerformance)
    .where(and(...conditions))
    .orderBy(asc(campaignPerformance.date));

  return rows as CampaignPerformanceRow[];
}

export async function listCampaigns(clientId: string, platform?: Platform) {
  const conditions = [eq(campaignPerformance.clientId, clientId)];
  if (platform) {
    conditions.push(eq(campaignPerformance.platform, platform));
  }

  const rows = await db
    .select({
      campaign_id: campaignPerformance.campaignId,
      campaign_name: campaignPerformance.campaignName,
      platform: campaignPerformance.platform,
    })
    .from(campaignPerformance)
    .where(and(...conditions));

  const uniqueMap = new Map<
    string,
    { campaign_id: string; campaign_name: string; platform: string }
  >();
  for (const row of rows) {
    uniqueMap.set(row.campaign_id, row);
  }
  return Array.from(uniqueMap.values());
}

export interface PeriodSummary {
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  // NULL revenue rows (value tracking not configured) count as 0 here.
  totalRevenue: number;
  avgCtr: number;
  avgCpc: number;
  avgCpm: number;
  avgCpa: number;
  avgRoas: number;
}

function summarizeMetrics(
  rows: Array<{
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    revenue: number | null;
  }>
): PeriodSummary {
  if (rows.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalConversions: 0,
      totalRevenue: 0,
      avgCtr: 0,
      avgCpc: 0,
      avgCpm: 0,
      avgCpa: 0,
      avgRoas: 0,
    };
  }

  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions), 0);
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
  const totalSpend = rows.reduce((s, r) => s + Number(r.spend), 0);
  const totalConversions = rows.reduce((s, r) => s + Number(r.conversions), 0);
  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);

  return {
    totalImpressions,
    totalClicks,
    totalSpend: Number(totalSpend.toFixed(2)),
    totalConversions,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    avgCtr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
    avgCpc: totalClicks > 0 ? Number((totalSpend / totalClicks).toFixed(4)) : 0,
    avgCpm: totalImpressions > 0 ? Number(((totalSpend / totalImpressions) * 1000).toFixed(4)) : 0,
    avgCpa: totalConversions > 0 ? Number((totalSpend / totalConversions).toFixed(2)) : 0,
    avgRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
  };
}

export interface ComparisonResult {
  current: PeriodSummary;
  previous: PeriodSummary;
  deltas: Record<string, { absolute: number; percentage: number }>;
}

export async function compareMetrics(params: {
  clientId: string;
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  platform?: Platform;
  platforms?: Platform[];
  campaignIds?: string[];
}): Promise<ComparisonResult> {
  const [currentRows, previousRows] = await Promise.all([
    getMetrics({
      clientId: params.clientId,
      startDate: params.currentStart,
      endDate: params.currentEnd,
      platform: params.platform,
      platforms: params.platforms,
      campaignIds: params.campaignIds,
    }),
    getMetrics({
      clientId: params.clientId,
      startDate: params.previousStart,
      endDate: params.previousEnd,
      platform: params.platform,
      platforms: params.platforms,
      campaignIds: params.campaignIds,
    }),
  ]);

  const current = summarizeMetrics(currentRows);
  const previous = summarizeMetrics(previousRows);

  const deltaKeys = [
    "totalImpressions",
    "totalClicks",
    "totalSpend",
    "totalConversions",
    "totalRevenue",
    "avgCtr",
    "avgCpc",
    "avgCpm",
    "avgCpa",
    "avgRoas",
  ] as const;

  const deltas: Record<string, { absolute: number; percentage: number }> = {};
  for (const key of deltaKeys) {
    const curr = current[key];
    const prev = previous[key];
    const absolute = Number((curr - prev).toFixed(4));
    const percentage = prev !== 0 ? Number((((curr - prev) / prev) * 100).toFixed(2)) : 0;
    deltas[key] = { absolute, percentage };
  }

  return { current, previous, deltas };
}

export async function getDailyTrend(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
  platforms?: Platform[];
  campaignIds?: string[];
}) {
  const rows = await getMetrics(params);

  const dailyMap = new Map<
    string,
    { date: string; impressions: number; clicks: number; spend: number; conversions: number }
  >();

  for (const row of rows) {
    const existing = dailyMap.get(row.date);
    if (existing) {
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.spend += Number(row.spend);
      existing.conversions += Number(row.conversions);
    } else {
      dailyMap.set(row.date, {
        date: row.date,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(dailyMap.values())
    .map(day => ({
      ...day,
      ctr: day.impressions > 0 ? Number(((day.clicks / day.impressions) * 100).toFixed(2)) : 0,
      cpc: day.clicks > 0 ? Number((day.spend / day.clicks).toFixed(2)) : 0,
      cpa: day.conversions > 0 ? Number((day.spend / day.conversions).toFixed(2)) : 0,
    }))
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
}

export interface FunnelStage {
  stage: string;
  volume: number;
  percentOfPrevious: number;
  percentOfFirst: number;
}

export interface FunnelData {
  overall: FunnelStage[];
  byPlatform: Record<string, FunnelStage[]>;
}

export async function getFunnelData(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
  platforms?: Platform[];
  campaignIds?: string[];
}): Promise<FunnelData> {
  const rows = await getMetrics(params);

  function buildFunnel(data: typeof rows): FunnelStage[] {
    const totalImpressions = data.reduce((s, r) => s + Number(r.impressions), 0);
    const totalClicks = data.reduce((s, r) => s + Number(r.clicks), 0);
    const totalConversions = data.reduce((s, r) => s + Number(r.conversions), 0);

    if (totalImpressions === 0) return [];

    return [
      {
        stage: "Impressions",
        volume: totalImpressions,
        percentOfPrevious: 100,
        percentOfFirst: 100,
      },
      {
        stage: "Clicks",
        volume: totalClicks,
        percentOfPrevious: Number(((totalClicks / totalImpressions) * 100).toFixed(2)),
        percentOfFirst: Number(((totalClicks / totalImpressions) * 100).toFixed(2)),
      },
      {
        stage: "Conversions",
        volume: totalConversions,
        percentOfPrevious: totalClicks > 0 ? Number(((totalConversions / totalClicks) * 100).toFixed(2)) : 0,
        percentOfFirst: Number(((totalConversions / totalImpressions) * 100).toFixed(2)),
      },
    ];
  }

  const overall = buildFunnel(rows);

  const platformGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = platformGroups.get(row.platform) || [];
    group.push(row);
    platformGroups.set(row.platform, group);
  }

  const byPlatform: Record<string, FunnelStage[]> = {};
  for (const [platform, group] of platformGroups) {
    byPlatform[platform] = buildFunnel(group);
  }

  return { overall, byPlatform };
}

export interface CampaignPacingItem {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  monthlyBudget: number;
  spentToDate: number;
  daysElapsed: number;
  daysRemaining: number;
  pacingPercent: number;
  projectedSpend: number;
  requiredDailySpend: number;
  status: "on_track" | "underpacing" | "overpacing";
}

export interface PacingData {
  totalBudget: number;
  totalSpent: number;
  totalProjected: number;
  overallStatus: "on_track" | "underpacing" | "overpacing";
  campaigns: CampaignPacingItem[];
}

export async function getCampaignPacing(params: {
  clientId: string;
  month: string;
}): Promise<PacingData> {
  const budgets = await db
    .select({
      campaign_id: campaignBudgets.campaignId,
      monthly_budget: campaignBudgets.monthlyBudget,
    })
    .from(campaignBudgets)
    .where(
      and(
        eq(campaignBudgets.clientId, params.clientId),
        eq(campaignBudgets.month, params.month)
      )
    );

  const monthStart = `${params.month}-01`;
  const monthDate = new Date(monthStart);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const today = new Date();
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  const endOfRange = today < monthEnd ? today : monthEnd;
  const daysElapsed = Math.max(1, Math.ceil((endOfRange.getTime() - monthDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  const endDateStr = endOfRange.toISOString().split("T")[0];

  const performanceData = await db
    .select({
      campaign_id: campaignPerformance.campaignId,
      campaign_name: campaignPerformance.campaignName,
      platform: campaignPerformance.platform,
      spend: campaignPerformance.spend,
    })
    .from(campaignPerformance)
    .where(
      and(
        eq(campaignPerformance.clientId, params.clientId),
        gte(campaignPerformance.date, monthStart),
        lte(campaignPerformance.date, endDateStr)
      )
    );

  const spendByCampaign = new Map<string, { total: number; name: string; platform: Platform }>();
  for (const row of performanceData || []) {
    const existing = spendByCampaign.get(row.campaign_id);
    if (existing) {
      existing.total += Number(row.spend);
    } else {
      spendByCampaign.set(row.campaign_id, {
        total: Number(row.spend),
        name: row.campaign_name,
        platform: row.platform as Platform,
      });
    }
  }

  const campaigns: CampaignPacingItem[] = (budgets || []).map((budget) => {
    const spendInfo = spendByCampaign.get(budget.campaign_id);
    const spentToDate = spendInfo?.total || 0;
    const dailyRunRate = daysElapsed > 0 ? spentToDate / daysElapsed : 0;
    const projectedSpend = dailyRunRate * daysInMonth;
    const pacingPercent = budget.monthly_budget > 0 ? (projectedSpend / budget.monthly_budget) * 100 : 0;
    const requiredDailySpend = daysRemaining > 0 ? (budget.monthly_budget - spentToDate) / daysRemaining : 0;

    let status: "on_track" | "underpacing" | "overpacing" = "on_track";
    if (pacingPercent > 115) status = "overpacing";
    else if (pacingPercent < 85) status = "underpacing";

    return {
      campaignId: budget.campaign_id,
      campaignName: spendInfo?.name || budget.campaign_id,
      platform: (spendInfo?.platform || "google") as Platform,
      monthlyBudget: Number(budget.monthly_budget),
      spentToDate: Number(spentToDate.toFixed(2)),
      daysElapsed,
      daysRemaining,
      pacingPercent: Number(pacingPercent.toFixed(1)),
      projectedSpend: Number(projectedSpend.toFixed(2)),
      requiredDailySpend: Number(requiredDailySpend.toFixed(2)),
      status,
    };
  });

  const totalBudget = campaigns.reduce((s, c) => s + c.monthlyBudget, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.spentToDate, 0);
  const totalProjected = campaigns.reduce((s, c) => s + c.projectedSpend, 0);

  const overallPacing = totalBudget > 0 ? (totalProjected / totalBudget) * 100 : 0;
  let overallStatus: "on_track" | "underpacing" | "overpacing" = "on_track";
  if (overallPacing > 115) overallStatus = "overpacing";
  else if (overallPacing < 85) overallStatus = "underpacing";

  return {
    totalBudget: Number(totalBudget.toFixed(2)),
    totalSpent: Number(totalSpent.toFixed(2)),
    totalProjected: Number(totalProjected.toFixed(2)),
    overallStatus,
    campaigns: campaigns.sort((a, b) => b.monthlyBudget - a.monthlyBudget),
  };
}

export async function getCreatives(params: {
  clientId: string;
  platform?: Platform;
  status?: CreativeStatus;
  campaignId?: string;
  sort?: string;
  order?: "asc" | "desc";
}): Promise<AdCreativeRow[]> {
  const conditions = [eq(adCreatives.clientId, params.clientId)];
  if (params.platform) {
    conditions.push(eq(adCreatives.platform, params.platform));
  }
  if (params.status) {
    conditions.push(eq(adCreatives.status, params.status));
  }
  if (params.campaignId) {
    conditions.push(eq(adCreatives.campaignId, params.campaignId));
  }

  const sortColumns = {
    spend: adCreatives.spend,
    ctr: adCreatives.ctr,
    cpc: adCreatives.cpc,
    cpa: adCreatives.cpa,
    impressions: adCreatives.impressions,
    clicks: adCreatives.clicks,
    conversions: adCreatives.conversions,
    days_running: adCreatives.daysRunning,
    ad_name: adCreatives.adName,
    created_at: adCreatives.createdAt,
  } as const;
  const sortCol =
    sortColumns[params.sort as keyof typeof sortColumns] ?? adCreatives.spend;
  const direction = params.order === "asc" ? asc : desc;

  const rows = await db
    .select()
    .from(adCreatives)
    .where(and(...conditions))
    .orderBy(direction(sortCol));

  return rows.map(toAdCreativeRow);
}

export interface FatigueAnalysisItem {
  ad_id: string;
  ad_name: string;
  headline: string;
  platform: Platform;
  campaign_id: string;
  creative_type: string;
  thumbnail_url: string;
  days_running: number;
  ctr: number;
  cpa: number;
  spend: number;
  impressions: number;
  status: string;
  fatigue_score: number;
}

export async function getCreativeFatigueAnalysis(
  clientId: string,
): Promise<FatigueAnalysisItem[]> {
  const data = await db
    .select()
    .from(adCreatives)
    .where(and(eq(adCreatives.clientId, clientId), gte(adCreatives.daysRunning, 14)));

  if (data.length === 0) return [];

  const rows = data.map(toAdCreativeRow);
  const avgCtr = rows.reduce((s, r) => s + Number(r.ctr), 0) / rows.length;
  const avgCpa = rows.reduce((s, r) => s + Number(r.cpa), 0) / rows.length;

  return rows
    .map((r) => {
      const ctrRatio = avgCtr > 0 ? Number(r.ctr) / avgCtr : 1;
      const cpaRatio = avgCpa > 0 ? Number(r.cpa) / avgCpa : 1;
      const ageFactor = Math.min(Number(r.days_running) / 90, 2);
      const fatigue_score = Number(((1 - ctrRatio) * 40 + (cpaRatio - 1) * 30 + ageFactor * 30).toFixed(1));

      return {
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        headline: r.headline,
        platform: r.platform,
        campaign_id: r.campaign_id,
        creative_type: r.creative_type,
        thumbnail_url: r.thumbnail_url,
        days_running: r.days_running,
        ctr: Number(r.ctr),
        cpa: Number(r.cpa),
        spend: Number(r.spend),
        impressions: Number(r.impressions),
        status: r.status,
        fatigue_score,
      };
    })
    .sort((a, b) => b.fatigue_score - a.fatigue_score);
}
