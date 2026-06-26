"use client";

import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Activity,
  ArrowRight,
  BarChart3,
  Zap,
  ChevronRight,
  Lightbulb,
  MessageCircle,
  Image,
  Layers,
  Video,
  AlertTriangle,
  PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { ReferenceContext } from "@/store/app-store";
import type { Platform } from "@/lib/types/database";
import type { ReportData } from "@/lib/report/builder";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const isGood = invert ? value < 0 : value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
      isGood ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
    )}>
      {value >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  tiktok: "TikTok Ads",
};

const PLATFORM_COLORS: Record<string, string> = {
  google: "#4285F4",
  meta: "#0668E1",
  tiktok: "#fe2c55",
};

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function getScoreGradient(score: number): [string, string] {
  if (score >= 80) return ["#16a34a", "#22c55e"];
  if (score >= 60) return ["#2563eb", "#3b82f6"];
  if (score >= 40) return ["#d97706", "#f59e0b"];
  return ["#dc2626", "#ef4444"];
}

function SparklineChart({ data, height = 48, color = "#2563eb" }: { data: number[]; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const padding = 2;
  const usableH = height - padding * 2;
  const step = w / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: padding + usableH - ((v - min) / range) * usableH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace("#", "")})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HorizontalBarChart({ items, maxValue }: { items: Array<{ label: string; value: number; color: string; formatted: string }>; maxValue: number }) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-[12px] font-medium text-ink">{item.label}</span>
            </div>
            <span className="text-[12px] font-semibold text-ink tabular-nums">{item.formatted}</span>
          </div>
          <div className="h-2 bg-canvas-soft rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`,
                backgroundColor: item.color,
                opacity: 0.8,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments, centerLabel, centerValue }: {
  segments: Array<{ value: number; color: string; label: string }>;
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  const r = 40;
  const cx = 50;
  const cy = 50;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * r;

  const arcsData = segments.reduce<Array<{ seg: typeof segments[0]; offset: number; dashLen: number; dashGap: number }>>((acc, seg) => {
    const prevOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dashLen : 0;
    const pct = seg.value / total;
    const dashLen = pct * circumference;
    const dashGap = circumference - dashLen;
    acc.push({ seg, offset: prevOffset, dashLen, dashGap });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {arcsData.map(({ seg, offset, dashLen, dashGap }) => (
              <circle
                key={seg.label}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLen.toFixed(2)} ${dashGap.toFixed(2)}`}
                strokeDashoffset={(-offset).toFixed(2)}
                strokeLinecap="round"
              />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-ink leading-none">{centerValue}</span>
          <span className="text-[9px] text-ink-muted font-medium uppercase tracking-wider mt-0.5">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-1.5 flex-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[12px] text-ink-muted">{seg.label}</span>
            <span className="ml-auto text-[12px] font-semibold text-ink tabular-nums">{(seg.value / total * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelVisualization({ stages }: { stages: Array<{ stage: string; volume: number; percentOfFirst: number; percentOfPrevious: number }> }) {
  if (stages.length < 2) return null;
  const maxWidth = 100;

  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => {
        const widthPct = i === 0 ? maxWidth : Math.max(15, (stage.percentOfFirst / 100) * maxWidth);
        const colors = [
          "from-blue-500 to-blue-400",
          "from-violet-500 to-violet-400",
          "from-emerald-500 to-emerald-400",
          "from-amber-500 to-amber-400",
        ];

        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <div className="w-[80px] shrink-0 text-right">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{stage.stage}</p>
            </div>
            <div className="flex-1 relative">
              <div
                className={cn("h-10 rounded-lg bg-linear-to-r flex items-center px-3 transition-all duration-500", colors[i % colors.length])}
                style={{ width: `${widthPct}%` }}
              >
                <span className="text-[13px] font-bold text-white tabular-nums">{formatNum(stage.volume)}</span>
              </div>
            </div>
            <div className="w-[56px] shrink-0 text-right">
              {i > 0 && (
                <span className="text-[11px] font-medium text-ink-muted tabular-nums">{stage.percentOfPrevious}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HealthGauge({ score, grade }: { score: number; grade: string }) {
  const r = 48;
  const cx = 60;
  const cy = 60;
  const strokeWidth = 10;
  const startAngle = 135;
  const endAngle = 405;
  const totalAngle = endAngle - startAngle;
  const scoreAngle = startAngle + (score / 100) * totalAngle;
  const [c1, c2] = getScoreGradient(score);

  function polarToCartesian(angle: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arc(start: number, end: number) {
    const s = polarToCartesian(start);
    const e = polarToCartesian(end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  return (
    <div className="relative" style={{ width: 120, height: 100 }}>
      <svg viewBox="0 0 120 120" className="w-full h-full">
        <defs>
          <linearGradient id="health-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <path d={arc(startAngle, endAngle)} fill="none" stroke="#f0f0f0" strokeWidth={strokeWidth} strokeLinecap="round" />
        {score > 0 && (
          <path d={arc(startAngle, scoreAngle)} fill="none" stroke="url(#health-grad)" strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
        <span className="text-2xl font-bold leading-none" style={{ color: getScoreColor(score) }}>{score}</span>
        <span className="text-[10px] font-semibold text-ink-muted mt-0.5">Grade {grade}</span>
      </div>
    </div>
  );
}


interface ReportViewerProps {
  data: ReportData;
  interactive?: boolean;
}

export function ReportViewer({ data, interactive = false }: ReportViewerProps) {
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  function attachContext(ctx: ReferenceContext) {
    if (!interactive) return;
    setReferenceContext({
      ...ctx,
      dateRange: data.dateRange,
    });
  }

  const c = data.comparison.current;
  const d = data.comparison.deltas;

  const heroKpis = [
    { label: "Spend", value: formatCurrency(c.totalSpend), delta: d.totalSpend.percentage, icon: <DollarSign className="w-4 h-4" /> },
    { label: "Conversions", value: formatNum(c.totalConversions), delta: d.totalConversions.percentage, icon: <Target className="w-4 h-4" /> },
    { label: "CPA", value: formatCurrency(c.avgCpa), delta: d.avgCpa.percentage, icon: <DollarSign className="w-4 h-4" />, invert: true },
    { label: "CTR", value: `${c.avgCtr}%`, delta: d.avgCtr.percentage, icon: <BarChart3 className="w-4 h-4" /> },
  ];

  const secondaryKpis = [
    { label: "Clicks", value: formatNum(c.totalClicks), delta: d.totalClicks.percentage },
    { label: "Impressions", value: formatNum(c.totalImpressions), delta: d.totalImpressions.percentage },
    { label: "CPC", value: formatCurrency(c.avgCpc), delta: d.avgCpc.percentage, invert: true },
    { label: "CPM", value: formatCurrency(c.avgCpm), delta: d.avgCpm.percentage, invert: true },
  ];

  const platformDonutSegments = data.platformBreakdown
    .sort((a, b) => b.spend - a.spend)
    .map((p) => ({
      value: p.spend,
      color: PLATFORM_COLORS[p.platform] || "#888",
      label: PLATFORM_LABELS[p.platform] || p.platform,
    }));

  const trendSpendData = data.trendSummary.dailyData.map((d) => d.spend);
  const trendConvData = data.trendSummary.dailyData.map((d) => d.conversions);

  const topCampaigns = [...data.campaignBreakdown].sort((a, b) => b.conversions - a.conversions).slice(0, 5);
  const worstCampaigns = [...data.campaignBreakdown].sort((a, b) => a.ctr - b.ctr).slice(0, 3);

  return (
    <div className="space-y-8">
      {/* Executive Summary */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary to-primary/70 flex items-center justify-center text-white shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Executive Summary</h3>
            <p className="text-[11px] text-ink-muted">{data.dateRange.start} to {data.dateRange.end}</p>
          </div>
        </div>
        <div className="bg-linear-to-r from-slate-50 to-blue-50/50 rounded-xl p-4 border border-slate-100">
          <p className="text-[13px] leading-relaxed text-ink/80">{data.narratives.executive}</p>
        </div>
      </section>

      {/* Hero KPIs */}
      <section>
        <div className="grid grid-cols-4 gap-3">
          {heroKpis.map((kpi) => (
            <div
              key={kpi.label}
              className={cn(
                "bg-white rounded-xl border border-hairline p-4 hover:shadow-sm transition-shadow group relative",
                interactive && "cursor-pointer hover:border-primary/30"
              )}
              onClick={() => attachContext({ metric: kpi.label, value: parseFloat(String(kpi.value).replace(/[$,%KM]/g, "")) })}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-md bg-primary/8 flex items-center justify-center text-primary">
                  {kpi.icon}
                </div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{kpi.label}</p>
              </div>
              <p className="text-xl font-bold text-ink tabular-nums">{kpi.value}</p>
              <div className="mt-1.5">
                <DeltaBadge value={kpi.delta} invert={kpi.invert} />
              </div>
              {interactive && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MessageCircle className="w-3.5 h-3.5 text-primary/50" />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3 mt-2">
          {secondaryKpis.map((kpi) => (
            <div
              key={kpi.label}
              className={cn(
                "bg-canvas-soft/60 rounded-lg px-3 py-2.5 flex items-center justify-between",
                interactive && "cursor-pointer hover:bg-primary/5"
              )}
              onClick={() => attachContext({ metric: kpi.label, value: parseFloat(String(kpi.value).replace(/[$,%KM]/g, "")) })}
            >
              <div>
                <p className="text-[10px] font-medium text-ink-muted uppercase tracking-wider">{kpi.label}</p>
                <p className="text-sm font-semibold text-ink tabular-nums mt-0.5">{kpi.value}</p>
              </div>
              <DeltaBadge value={kpi.delta} invert={kpi.invert} />
            </div>
          ))}
        </div>
      </section>

      {/* Performance Trends with Sparklines */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-violet-500 to-violet-400 flex items-center justify-center text-white shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Performance Trends</h3>
          </div>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.trends}</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-xl border border-hairline p-4">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Daily Spend Trend</p>
            <p className="text-sm font-bold text-ink mb-2 tabular-nums">Avg. {formatCurrency(data.trendSummary.avgDailySpend)}/day</p>
            <SparklineChart data={trendSpendData} height={56} color="#2563eb" />
          </div>
          <div className="bg-white rounded-xl border border-hairline p-4">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Daily Conversions Trend</p>
            <p className="text-sm font-bold text-ink mb-2 tabular-nums">{formatNum(c.totalConversions)} total</p>
            <SparklineChart data={trendConvData} height={56} color="#16a34a" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl bg-linear-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100 p-3">
            <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Best Day</p>
            <p className="text-sm font-bold text-ink mt-1">{data.trendSummary.bestDay.date}</p>
            <p className="text-[11px] text-emerald-700 font-medium">{data.trendSummary.bestDay.conversions} conv.</p>
          </div>
          <div className="rounded-xl bg-linear-to-br from-red-50 to-red-100/50 border border-red-100 p-3">
            <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">Worst Day</p>
            <p className="text-sm font-bold text-ink mt-1">{data.trendSummary.worstDay.date}</p>
            <p className="text-[11px] text-red-700 font-medium">{data.trendSummary.worstDay.conversions} conv.</p>
          </div>
          <div className="rounded-xl bg-linear-to-br from-blue-50 to-blue-100/50 border border-blue-100 p-3">
            <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Avg Daily Spend</p>
            <p className="text-sm font-bold text-ink mt-1">{formatCurrency(data.trendSummary.avgDailySpend)}</p>
          </div>
          <div className="rounded-xl bg-linear-to-br from-amber-50 to-amber-100/50 border border-amber-100 p-3">
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Volatility</p>
            <p className="text-sm font-bold text-ink mt-1">{(data.trendSummary.spendVolatility * 100).toFixed(1)}%</p>
          </div>
        </div>
      </section>

      {/* Platform Breakdown */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">Platform Breakdown</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.platforms}</p>

        <div className="grid grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-hairline p-4">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Spend Distribution</p>
            <DonutChart
              segments={platformDonutSegments}
              centerLabel="Total"
              centerValue={formatCurrency(c.totalSpend)}
            />
          </div>
          <div className="bg-white rounded-xl border border-hairline p-4">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Conversions by Platform</p>
            <HorizontalBarChart
              items={data.platformBreakdown.sort((a, b) => b.conversions - a.conversions).map((p) => ({
                label: PLATFORM_LABELS[p.platform] || p.platform,
                value: p.conversions,
                color: PLATFORM_COLORS[p.platform] || "#888",
                formatted: `${formatNum(p.conversions)} at ${formatCurrency(p.cpa)} CPA`,
              }))}
              maxValue={Math.max(...data.platformBreakdown.map((p) => p.conversions))}
            />
          </div>
        </div>

        <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: `repeat(${data.platformBreakdown.length}, 1fr)` }}>
          {data.platformBreakdown.sort((a, b) => b.spend - a.spend).map((p) => (
            <div
              key={p.platform}
              className={cn(
                "bg-canvas-soft/60 rounded-xl p-3 group relative",
                interactive && "cursor-pointer hover:bg-primary/5 hover:ring-1 hover:ring-primary/20"
              )}
              onClick={() => attachContext({ platform: p.platform as Platform })}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] }} />
                <span className="text-[12px] font-semibold text-ink">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                {interactive && (
                  <MessageCircle className="w-3 h-3 text-primary/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <p className="text-[9px] text-ink-muted uppercase">CTR</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{p.ctr}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-ink-muted uppercase">CPA</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(p.cpa)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-ink-muted uppercase">CPC</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(p.cpc)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-ink-muted uppercase">Spend</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{p.pctOfSpend}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Funnel Analysis */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-violet-500 to-purple-400 flex items-center justify-center text-white shrink-0">
            <ArrowRight className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">Funnel Analysis</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.funnel}</p>
        {data.funnel.overall.length >= 2 && (
          <div className="bg-white rounded-xl border border-hairline p-5">
            <FunnelVisualization stages={data.funnel.overall} />
          </div>
        )}
      </section>

      {/* Campaign Performance */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500 to-teal-400 flex items-center justify-center text-white shrink-0">
            <Target className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">Campaign Performance</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.campaigns}</p>

        {topCampaigns.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Top Performers
            </p>
            <div className="space-y-2">
              {topCampaigns.map((camp, i) => (
                <div
                  key={camp.campaignName}
                  className={cn(
                    "bg-white rounded-xl border border-hairline p-3 flex items-center gap-3 group",
                    interactive && "cursor-pointer hover:border-primary/30 hover:shadow-sm"
                  )}
                  onClick={() => attachContext({ campaignName: camp.campaignName, platform: camp.platform as Platform })}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-bold text-white shrink-0",
                    i === 0 ? "bg-emerald-500" : i === 1 ? "bg-emerald-400" : "bg-emerald-300"
                  )}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{camp.campaignName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[9px] capitalize">{camp.platform}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-ink-muted">Conv.</p>
                      <p className="text-[13px] font-bold text-ink tabular-nums">{camp.conversions}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-ink-muted">CPA</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(camp.cpa)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-ink-muted">Spend</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(camp.spend)}</p>
                    </div>
                    {interactive && (
                      <MessageCircle className="w-3.5 h-3.5 text-primary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {worstCampaigns.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-amber-500" /> Needs Attention (Low CTR)
            </p>
            <div className="space-y-2">
              {worstCampaigns.map((camp) => (
                <div
                  key={camp.campaignName}
                  className={cn(
                    "bg-amber-50/50 rounded-xl border border-amber-100 p-3 flex items-center gap-3",
                    interactive && "cursor-pointer hover:border-amber-300 hover:shadow-sm"
                  )}
                  onClick={() => attachContext({ campaignName: camp.campaignName, platform: camp.platform as Platform, metric: "CTR" })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{camp.campaignName}</p>
                    <Badge variant="secondary" className="text-[9px] capitalize mt-0.5">{camp.platform}</Badge>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-ink-muted">CTR</p>
                      <p className="text-[13px] font-bold text-amber-600 tabular-nums">{camp.ctr}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-ink-muted">CPA</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(camp.cpa)}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-faint" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Health Score */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-pink-500 to-rose-400 flex items-center justify-center text-white shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">Account Health</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.health}</p>

        <div className="bg-white rounded-xl border border-hairline p-5">
          <div className="flex items-start gap-6 mb-5">
            <HealthGauge score={data.healthScore.overallScore} grade={data.healthScore.grade} />
            <div className="flex-1 pt-2">
              <p className="text-[14px] font-semibold text-ink mb-1">
                Overall Health: <span style={{ color: getScoreColor(data.healthScore.overallScore) }}>{data.healthScore.overallScore}/100</span>
              </p>
              <p className="text-[12px] text-ink-muted leading-relaxed">{data.healthScore.insight}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {data.healthScore.subScores.map((sub) => {
              const color = getScoreColor(sub.score);
              return (
                <div key={sub.name} className="bg-canvas-soft/60 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-ink">{sub.name}</span>
                    <span className="text-[12px] font-bold tabular-nums" style={{ color }}>{sub.score.toFixed(0)}</span>
                  </div>
                  <div className="h-2 bg-white rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${sub.score}%`, backgroundColor: color }}
                    />
                  </div>
                  <p className="text-[10px] text-ink-muted mt-1.5 line-clamp-2">{sub.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Creative Performance */}
      {data.creatives && data.creatives.totalCreatives > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-fuchsia-500 to-pink-400 flex items-center justify-center text-white shrink-0">
              <Image className="w-4 h-4" />
            </div>
            <h3 className="text-[15px] font-semibold text-ink">Creative Performance</h3>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.creatives}</p>

          {/* Creative KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-hairline p-4">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Total Creatives</p>
              <p className="text-xl font-bold text-ink tabular-nums mt-1">{data.creatives.totalCreatives}</p>
              <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-ink-muted">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />{data.creatives.activeCount} active
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 ml-1" />{data.creatives.fatiguedCount} fatigued
              </div>
            </div>
            <div className="bg-white rounded-xl border border-hairline p-4">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Avg CTR</p>
              <p className="text-xl font-bold text-ink tabular-nums mt-1">{data.creatives.avgCtr}%</p>
            </div>
            <div className="bg-white rounded-xl border border-hairline p-4">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Avg CPA</p>
              <p className="text-xl font-bold text-ink tabular-nums mt-1">${data.creatives.avgCpa}</p>
            </div>
            <div className={cn("bg-white rounded-xl border p-4", data.creatives.fatiguedCount > 0 ? "border-amber-200" : "border-hairline")}>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">Fatigued</p>
              <p className={cn("text-xl font-bold tabular-nums mt-1", data.creatives.fatiguedCount > 0 ? "text-amber-600" : "text-ink")}>{data.creatives.fatiguedCount}</p>
              {data.creatives.fatiguedCount > 0 && <p className="text-[10px] text-amber-500 mt-0.5">needs refresh</p>}
            </div>
          </div>

          {/* By Creative Type */}
          {data.creatives.byType.length > 0 && (
            <div className="bg-white rounded-xl border border-hairline p-4 mb-4">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Performance by Creative Type</p>
              <div className="grid gap-2">
                {data.creatives.byType.sort((a, b) => b.totalConversions - a.totalConversions).map((t) => {
                  const TypeIcon = t.type === "video" ? Video : t.type === "carousel" ? Layers : Image;
                  return (
                    <div key={t.type} className="flex items-center gap-3 bg-canvas-soft/60 rounded-lg px-3 py-2.5">
                      <div className="w-7 h-7 rounded-md bg-white border border-hairline flex items-center justify-center shrink-0">
                        <TypeIcon className="w-3.5 h-3.5 text-ink-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-ink capitalize">{t.type}</p>
                        <p className="text-[10px] text-ink-muted">{t.count} creatives</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-right">
                        <div>
                          <p className="text-[9px] text-ink-muted uppercase">CTR</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{t.avgCtr}%</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ink-muted uppercase">CPA</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">${t.avgCpa}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ink-muted uppercase">Conv.</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{formatNum(t.totalConversions)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-ink-muted uppercase">Spend</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{formatCurrency(t.totalSpend)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Creative Performers */}
          {data.creatives.topPerformers.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Top Creatives
              </p>
              <div className="space-y-2">
                {data.creatives.topPerformers.map((cr, i) => (
                  <div key={cr.headline + i} className="bg-white rounded-xl border border-hairline p-3 flex items-center gap-3">
                    <div className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-bold text-white shrink-0",
                      i === 0 ? "bg-fuchsia-500" : i === 1 ? "bg-fuchsia-400" : "bg-fuchsia-300"
                    )}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{cr.headline}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[9px] capitalize">{cr.platform}</Badge>
                        <Badge variant="secondary" className="text-[9px] capitalize">{cr.type}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">Conv.</p>
                        <p className="text-[13px] font-bold text-ink tabular-nums">{cr.conversions}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">CPA</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(cr.cpa)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">CTR</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{cr.ctr}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fatigued Creatives */}
          {data.creatives.fatiguedCreatives.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Creative Fatigue Alert
              </p>
              <div className="space-y-2">
                {data.creatives.fatiguedCreatives.map((f, i) => (
                  <div key={f.headline + i} className="bg-amber-50/50 rounded-xl border border-amber-100 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{f.headline}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[9px] capitalize">{f.platform}</Badge>
                        <span className="text-[10px] text-amber-600 font-medium">{f.daysRunning} days running</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">Fatigue</p>
                        <p className="text-[13px] font-bold text-amber-600 tabular-nums">{f.fatigueScore.toFixed(0)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">CTR</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{f.ctr}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-ink-muted">CPA</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">${f.cpa}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Budget Optimizer */}
      {data.optimizer && data.optimizer.platforms.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-cyan-500 to-blue-400 flex items-center justify-center text-white shrink-0">
              <PieChart className="w-4 h-4" />
            </div>
            <h3 className="text-[15px] font-semibold text-ink">Budget Optimization</h3>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.optimizer}</p>

          {/* Allocation comparison */}
          <div className="bg-white rounded-xl border border-hairline p-5 mb-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Current Allocation</p>
                <div className="space-y-2">
                  {data.optimizer.platforms.map((p) => (
                    <div key={`cur-${p.platform}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] || "#888" }} />
                          <span className="text-[12px] font-medium text-ink capitalize">{p.platform}</span>
                        </div>
                        <span className="text-[12px] font-semibold text-ink tabular-nums">{p.currentAllocation}%</span>
                      </div>
                      <div className="h-2 bg-canvas-soft rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${p.currentAllocation}%`, backgroundColor: PLATFORM_COLORS[p.platform] || "#888", opacity: 0.7 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Recommended Allocation</p>
                <div className="space-y-2">
                  {data.optimizer.platforms.map((p) => {
                    const recommended = data.optimizer.recommendedAllocation[p.platform] ?? p.currentAllocation;
                    const diff = recommended - p.currentAllocation;
                    return (
                      <div key={`rec-${p.platform}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] || "#888" }} />
                            <span className="text-[12px] font-medium text-ink capitalize">{p.platform}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-semibold text-ink tabular-nums">{recommended.toFixed(1)}%</span>
                            {diff !== 0 && (
                              <span className={cn("text-[10px] font-medium", diff > 0 ? "text-emerald-600" : "text-red-500")}>
                                {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-2 bg-canvas-soft rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${recommended}%`, backgroundColor: PLATFORM_COLORS[p.platform] || "#888" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Platform Efficiency Scores */}
          <div className="bg-white rounded-xl border border-hairline p-4 mb-4">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-3">Channel Efficiency Ranking</p>
            <div className="space-y-2.5">
              {data.optimizer.platforms.map((p, i) => {
                const color = getScoreColor(p.efficiencyScore);
                return (
                  <div key={p.platform} className="flex items-center gap-3">
                    <div className={cn(
                      "w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0",
                      i === 0 ? "bg-cyan-500" : i === 1 ? "bg-cyan-400" : "bg-cyan-300"
                    )}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-medium text-ink capitalize">{p.platform}</span>
                        <span className="text-[12px] font-bold tabular-nums" style={{ color }}>{p.efficiencyScore}/100</span>
                      </div>
                      <div className="h-2 bg-canvas-soft rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${p.efficiencyScore}%`, backgroundColor: color }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <div>
                        <p className="text-[9px] text-ink-muted uppercase">CPA</p>
                        <p className="text-[12px] font-semibold text-ink tabular-nums">{formatCurrency(p.cpa)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-ink-muted uppercase">Trend</p>
                        <p className={cn("text-[12px] font-semibold tabular-nums", p.recentCpaTrend <= 0 ? "text-emerald-600" : "text-red-500")}>
                          {p.recentCpaTrend > 0 ? "+" : ""}{p.recentCpaTrend}%
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Projected Impact */}
          {(data.optimizer.projectedImpact.additionalConversions > 0 || data.optimizer.projectedImpact.cpaReduction > 0) && (
            <div className="bg-linear-to-r from-cyan-50 to-blue-50/50 rounded-xl p-4 border border-cyan-100">
              <p className="text-[11px] font-semibold text-cyan-700 uppercase tracking-wider mb-2">Projected Impact of Reallocation</p>
              <div className="flex items-center gap-6">
                {data.optimizer.projectedImpact.additionalConversions > 0 && (
                  <div>
                    <p className="text-lg font-bold text-cyan-700">+{data.optimizer.projectedImpact.additionalConversions}</p>
                    <p className="text-[10px] text-cyan-600">additional conversions</p>
                  </div>
                )}
                {data.optimizer.projectedImpact.cpaReduction > 0 && (
                  <div>
                    <p className="text-lg font-bold text-cyan-700">-{data.optimizer.projectedImpact.cpaReduction}%</p>
                    <p className="text-[10px] text-cyan-600">CPA reduction</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Recommendations */}
      <section>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-amber-500 to-orange-400 flex items-center justify-center text-white shrink-0">
            <Lightbulb className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-ink">Recommendations</h3>
        </div>
        <div className="bg-linear-to-r from-amber-50 to-orange-50/50 rounded-xl p-4 border border-amber-100">
          <p className="text-[13px] leading-relaxed text-ink/80">{data.narratives.recommendations}</p>
        </div>
      </section>
    </div>
  );
}
