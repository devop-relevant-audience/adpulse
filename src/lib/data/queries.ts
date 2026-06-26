import { createClient } from "@supabase/supabase-js";
import type { Platform, AdCreativeRow, CreativeStatus } from "@/lib/types/database";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function getClients() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");

  if (error) throw new Error(error.message);
  return data;
}

export async function getMetrics(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
  campaignId?: string;
}) {
  const supabase = getSupabase();
  let query = supabase
    .from("campaign_performance")
    .select("*")
    .eq("client_id", params.clientId)
    .gte("date", params.startDate)
    .lte("date", params.endDate)
    .order("date", { ascending: true });

  if (params.platform) {
    query = query.eq("platform", params.platform);
  }
  if (params.campaignId) {
    query = query.eq("campaign_id", params.campaignId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function listCampaigns(clientId: string, platform?: Platform) {
  const supabase = getSupabase();
  let query = supabase
    .from("campaign_performance")
    .select("campaign_id, campaign_name, platform")
    .eq("client_id", clientId);

  if (platform) {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const uniqueMap = new Map<
    string,
    { campaign_id: string; campaign_name: string; platform: string }
  >();
  for (const row of data) {
    uniqueMap.set(row.campaign_id, row);
  }
  return Array.from(uniqueMap.values());
}

export interface PeriodSummary {
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number;
  avgCpm: number;
  avgCpa: number;
}

function summarizeMetrics(
  rows: Array<{
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    ctr: number;
    cpc: number;
    cpm: number;
  }>
): PeriodSummary {
  if (rows.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalConversions: 0,
      avgCtr: 0,
      avgCpc: 0,
      avgCpm: 0,
      avgCpa: 0,
    };
  }

  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions), 0);
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
  const totalSpend = rows.reduce((s, r) => s + Number(r.spend), 0);
  const totalConversions = rows.reduce((s, r) => s + Number(r.conversions), 0);

  return {
    totalImpressions,
    totalClicks,
    totalSpend: Number(totalSpend.toFixed(2)),
    totalConversions,
    avgCtr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
    avgCpc: totalClicks > 0 ? Number((totalSpend / totalClicks).toFixed(4)) : 0,
    avgCpm: totalImpressions > 0 ? Number(((totalSpend / totalImpressions) * 1000).toFixed(4)) : 0,
    avgCpa: totalConversions > 0 ? Number((totalSpend / totalConversions).toFixed(2)) : 0,
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
}): Promise<ComparisonResult> {
  const [currentRows, previousRows] = await Promise.all([
    getMetrics({
      clientId: params.clientId,
      startDate: params.currentStart,
      endDate: params.currentEnd,
      platform: params.platform,
    }),
    getMetrics({
      clientId: params.clientId,
      startDate: params.previousStart,
      endDate: params.previousEnd,
      platform: params.platform,
    }),
  ]);

  const current = summarizeMetrics(currentRows);
  const previous = summarizeMetrics(previousRows);

  const deltaKeys = [
    "totalImpressions",
    "totalClicks",
    "totalSpend",
    "totalConversions",
    "avgCtr",
    "avgCpc",
    "avgCpm",
    "avgCpa",
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

export interface AnomalyPoint {
  date: string;
  metric: string;
  value: number;
  expected: number;
  zScore: number;
  severity: "critical" | "warning" | "info";
  direction: "spike" | "drop";
  campaignName?: string;
  platform?: Platform;
}

export async function detectAnomalies(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
}): Promise<AnomalyPoint[]> {
  const rows = await getMetrics(params);
  if (rows.length === 0) return [];

  const dailyMap = new Map<
    string,
    { date: string; spend: number; ctr: number; cpc: number; conversions: number; impressions: number; clicks: number }
  >();

  for (const row of rows) {
    const existing = dailyMap.get(row.date);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.impressions += Number(row.impressions);
      existing.clicks += Number(row.clicks);
      existing.conversions += Number(row.conversions);
    } else {
      dailyMap.set(row.date, {
        date: row.date,
        spend: Number(row.spend),
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        conversions: Number(row.conversions),
        ctr: 0,
        cpc: 0,
      });
    }
  }

  const dailyData = Array.from(dailyMap.values())
    .map((d) => ({
      ...d,
      ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
      cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
      cpa: d.conversions > 0 ? d.spend / d.conversions : 0,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const anomalies: AnomalyPoint[] = [];
  const metricsToCheck = ["spend", "ctr", "cpc", "cpa", "conversions"] as const;
  const WINDOW = 7;

  for (const metric of metricsToCheck) {
    for (let i = WINDOW; i < dailyData.length; i++) {
      const window = dailyData.slice(i - WINDOW, i);
      const values = window.map((d) => d[metric]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stddev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);

      if (stddev === 0) continue;

      const current = dailyData[i][metric];
      const zScore = (current - mean) / stddev;
      const absZ = Math.abs(zScore);

      if (absZ <= 2.0) continue;

      const severity = absZ > 3 ? "critical" : absZ > 2.5 ? "warning" : "info";

      anomalies.push({
        date: dailyData[i].date,
        metric,
        value: Number(current.toFixed(2)),
        expected: Number(mean.toFixed(2)),
        zScore: Number(zScore.toFixed(2)),
        severity,
        direction: zScore > 0 ? "spike" : "drop",
      });
    }
  }

  return anomalies.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getDailyTrend(params: {
  clientId: string;
  startDate: string;
  endDate: string;
  platform?: Platform;
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
  const supabase = getSupabase();

  const { data: budgets, error: budgetError } = await supabase
    .from("campaign_budgets")
    .select("*")
    .eq("client_id", params.clientId)
    .eq("month", params.month);

  if (budgetError) throw new Error(budgetError.message);

  const monthStart = `${params.month}-01`;
  const monthDate = new Date(monthStart);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const today = new Date();
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  const endOfRange = today < monthEnd ? today : monthEnd;
  const daysElapsed = Math.max(1, Math.ceil((endOfRange.getTime() - monthDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  const endDateStr = endOfRange.toISOString().split("T")[0];

  const { data: performanceData, error: perfError } = await supabase
    .from("campaign_performance")
    .select("campaign_id, campaign_name, platform, spend")
    .eq("client_id", params.clientId)
    .gte("date", monthStart)
    .lte("date", endDateStr);

  if (perfError) throw new Error(perfError.message);

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
  const supabase = getSupabase();
  let query = supabase
    .from("ad_creatives")
    .select("*")
    .eq("client_id", params.clientId);

  if (params.platform) {
    query = query.eq("platform", params.platform);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.campaignId) {
    query = query.eq("campaign_id", params.campaignId);
  }

  const sortCol = params.sort || "spend";
  const ascending = params.order === "asc";
  query = query.order(sortCol, { ascending });

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as AdCreativeRow[];
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
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .eq("client_id", clientId)
    .gte("days_running", 14);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const rows = data as AdCreativeRow[];
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
