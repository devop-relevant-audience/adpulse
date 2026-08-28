"use client";

import { Badge } from "@/components/ui/badge";
import { BiTrendingUp, BiTrendingDown, BiPulse, BiChevronRight, BiSolidMagicWand, BiBulb, BiMessageRounded, BiImage, BiVideo, BiCarousel, BiError, BiFilterAlt, BiBroadcast } from "react-icons/bi";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { PLATFORM_COLORS, PLATFORM_LABELS, SERIES_PALETTE, STATUS_COLORS, CHART_AXIS_TEXT } from "@/lib/dashboard/chart-theme";
import { useAppStore } from "@/store/app-store";
import type { ReferenceContext } from "@/store/app-store";
import type { Platform } from "@/lib/types/database";
import type { ReportData } from "@/lib/report/builder";
import { formatCurrency, formatNumber as formatNum } from "@/lib/format";

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const isGood = invert ? value < 0 : value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
      isGood ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
    )}>
      {value >= 0 ? <BiTrendingUp className="w-3 h-3" /> : <BiTrendingDown className="w-3 h-3" />}
      {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return STATUS_COLORS.good;
  if (score >= 60) return SERIES_PALETTE[0];
  if (score >= 40) return STATUS_COLORS.warning;
  return STATUS_COLORS.bad;
}

function SparklineChart({ data, height = 48, color = "var(--chart-1)" }: { data: number[]; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const gradId = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
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
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
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
              className="h-full rounded-full transition-[width] duration-300 ease-out"
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
          <span className="text-[11px] text-ink-muted font-medium mt-0.5">{centerLabel}</span>
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

        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <div className="w-[80px] shrink-0 text-right">
              <p className="text-[11px] font-medium text-ink-muted">{stage.stage}</p>
            </div>
            <div className="flex-1 flex items-center gap-2.5">
              <div
                className="h-10 rounded-lg transition-[width] duration-300 ease-out"
                style={{ width: `${widthPct}%`, backgroundColor: SERIES_PALETTE[i % SERIES_PALETTE.length] }}
              />
              <span className="text-[13px] font-bold text-ink tabular-nums shrink-0">{formatNum(stage.volume)}</span>
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
  const scoreColor = getScoreColor(score);

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
        <path d={arc(startAngle, endAngle)} fill="none" stroke="var(--color-hairline)" strokeWidth={strokeWidth} strokeLinecap="round" />
        {score > 0 && (
          <path d={arc(startAngle, scoreAngle)} fill="none" stroke={scoreColor} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
        <span className="text-2xl font-bold leading-none" style={{ color: getScoreColor(score) }}>{score}</span>
        <span className="text-[11px] font-semibold text-ink-muted mt-0.5">Grade {grade}</span>
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
  // Report data carries its own currency: this component also renders public
  // shared reports, where no client is selected.
  const fmt = (n: number) => formatCurrency(n, data.currency);

  function attachContext(ctx: ReferenceContext) {
    if (!interactive) return;
    setReferenceContext({
      ...ctx,
      dateRange: data.dateRange,
    });
  }

  const c = data.comparison.current;
  const d = data.comparison.deltas;

  const allKpis: Array<{ label: string; value: string; delta: number; invert?: boolean }> = [
    { label: "Spend", value: fmt(c.totalSpend), delta: d.totalSpend.percentage },
    { label: "Conversions", value: formatNum(c.totalConversions), delta: d.totalConversions.percentage },
    { label: "CPA", value: fmt(c.avgCpa), delta: d.avgCpa.percentage, invert: true },
    { label: "CTR", value: `${c.avgCtr}%`, delta: d.avgCtr.percentage },
    { label: "Clicks", value: formatNum(c.totalClicks), delta: d.totalClicks.percentage },
    { label: "Impressions", value: formatNum(c.totalImpressions), delta: d.totalImpressions.percentage },
    { label: "CPC", value: fmt(c.avgCpc), delta: d.avgCpc.percentage, invert: true },
    { label: "CPM", value: fmt(c.avgCpm), delta: d.avgCpm.percentage, invert: true },
  ];

  const platformDonutSegments = data.platformBreakdown
    .sort((a, b) => b.spend - a.spend)
    .map((p) => ({
      value: p.spend,
      color: PLATFORM_COLORS[p.platform] || CHART_AXIS_TEXT,
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
        <div className="flex items-center gap-2 mb-3">
          <BiSolidMagicWand className="w-4 h-4 text-primary shrink-0" />
          <div className="flex items-baseline gap-2">
            <h3 className="text-[15px] font-semibold text-ink">Executive summary</h3>
            <p className="text-[12px] text-ink-muted">{data.dateRange.start} to {data.dateRange.end}</p>
          </div>
        </div>
        <div className="rounded-xl border border-hairline bg-canvas-soft/50 p-4">
          <p className="text-[13px] leading-relaxed text-ink-secondary">{data.narratives.executive}</p>
        </div>
      </section>

      {/* KPIs */}
      <section>
        <div className="grid grid-cols-4 gap-px bg-hairline rounded-xl border border-hairline overflow-hidden">
          {allKpis.map((kpi) => (
            <button
              key={kpi.label}
              type="button"
              aria-label={`Ask the AI assistant about ${kpi.label}`}
              className={cn(
                "text-left bg-white p-4 group relative transition-colors",
                interactive && "cursor-pointer hover:bg-canvas-soft/60"
              )}
              onClick={() => attachContext({ metric: kpi.label, value: parseFloat(String(kpi.value).replace(/[^0-9.-]/g, "")) })}
            >
              <p className="text-[12px] font-medium text-ink-muted">{kpi.label}</p>
              <p className="text-lg font-semibold text-ink tabular-nums mt-1">{kpi.value}</p>
              <div className="mt-1.5">
                <DeltaBadge value={kpi.delta} invert={kpi.invert} />
              </div>
              {interactive && (
                <BiMessageRounded className="absolute top-2.5 right-2.5 w-3.5 h-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Performance Trends with Sparklines */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiTrendingUp className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Performance trends</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.trends}</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <Panel className="p-4">
            <p className="text-[12px] font-medium text-ink-muted mb-1">Daily spend trend</p>
            <p className="text-sm font-semibold text-ink mb-2 tabular-nums">Avg. {fmt(data.trendSummary.avgDailySpend)}/day</p>
            <SparklineChart data={trendSpendData} height={56} color="var(--chart-1)" />
          </Panel>
          <Panel className="p-4">
            <p className="text-[12px] font-medium text-ink-muted mb-1">Daily conversions trend</p>
            <p className="text-sm font-semibold text-ink mb-2 tabular-nums">{formatNum(c.totalConversions)} total</p>
            <SparklineChart data={trendConvData} height={56} color="var(--chart-2)" />
          </Panel>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-hairline rounded-xl border border-hairline overflow-hidden">
          <div className="bg-white p-3">
            <p className="text-[12px] font-medium text-ink-muted">Best day</p>
            <p className="text-sm font-semibold text-ink mt-1">{data.trendSummary.bestDay.date}</p>
            <p className="text-[11px] text-emerald-700 font-medium">{data.trendSummary.bestDay.conversions} conv.</p>
          </div>
          <div className="bg-white p-3">
            <p className="text-[12px] font-medium text-ink-muted">Worst day</p>
            <p className="text-sm font-semibold text-ink mt-1">{data.trendSummary.worstDay.date}</p>
            <p className="text-[11px] text-red-600 font-medium">{data.trendSummary.worstDay.conversions} conv.</p>
          </div>
          <div className="bg-white p-3">
            <p className="text-[12px] font-medium text-ink-muted">Avg daily spend</p>
            <p className="text-sm font-semibold text-ink mt-1">{fmt(data.trendSummary.avgDailySpend)}</p>
          </div>
          <div className="bg-white p-3">
            <p className="text-[12px] font-medium text-ink-muted">Volatility</p>
            <p className="text-sm font-semibold text-ink mt-1">{(data.trendSummary.spendVolatility * 100).toFixed(1)}%</p>
          </div>
        </div>
      </section>

      {/* Platform Breakdown */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiPulse className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Platform breakdown</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.platforms}</p>

        <div className="grid grid-cols-2 gap-5">
          <Panel className="p-4">
            <p className="text-[12px] font-medium text-ink-muted mb-3">Spend distribution</p>
            <DonutChart
              segments={platformDonutSegments}
              centerLabel="Total"
              centerValue={fmt(c.totalSpend)}
            />
          </Panel>
          <Panel className="p-4">
            <p className="text-[12px] font-medium text-ink-muted mb-3">Conversions by platform</p>
            <HorizontalBarChart
              items={data.platformBreakdown.sort((a, b) => b.conversions - a.conversions).map((p) => ({
                label: PLATFORM_LABELS[p.platform] || p.platform,
                value: p.conversions,
                color: PLATFORM_COLORS[p.platform] || CHART_AXIS_TEXT,
                formatted: `${formatNum(p.conversions)} at ${fmt(p.cpa)} CPA`,
              }))}
              maxValue={Math.max(...data.platformBreakdown.map((p) => p.conversions))}
            />
          </Panel>
        </div>

        <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: `repeat(${data.platformBreakdown.length}, 1fr)` }}>
          {data.platformBreakdown.sort((a, b) => b.spend - a.spend).map((p) => (
            <button
              key={p.platform}
              type="button"
              aria-label={`Ask the AI assistant about ${PLATFORM_LABELS[p.platform] || p.platform}`}
              className={cn(
                "text-left w-full bg-canvas-soft/60 rounded-xl p-3 group relative",
                interactive && "cursor-pointer hover:bg-primary/5 hover:ring-1 hover:ring-primary/20"
              )}
              onClick={() => attachContext({ platform: p.platform as Platform })}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] }} />
                <span className="text-[12px] font-semibold text-ink">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                {interactive && (
                  <BiMessageRounded className="w-3 h-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <p className="text-[11px] text-ink-muted">CTR</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{p.ctr}%</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-muted">CPA</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(p.cpa)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-muted">CPC</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(p.cpc)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-ink-muted">Spend</p>
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{p.pctOfSpend}%</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Funnel Analysis */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiFilterAlt className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Funnel analysis</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.funnel}</p>
        {data.funnel.overall.length >= 2 && (
          <Panel className="p-5">
            <FunnelVisualization stages={data.funnel.overall} />
          </Panel>
        )}
      </section>

      {/* Campaign Performance */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiBroadcast className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Campaign performance</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.campaigns}</p>

        {topCampaigns.length > 0 && (
          <div className="mb-4">
            <p className="text-[12px] font-medium text-ink-muted mb-2.5 flex items-center gap-1.5">
              <BiTrendingUp className="w-3.5 h-3.5 text-emerald-600" /> Top performers
            </p>
            <div className="space-y-2">
              {topCampaigns.map((camp, i) => (
                <button
                  key={camp.campaignName}
                  type="button"
                  aria-label={`Ask the AI assistant about campaign ${camp.campaignName}`}
                  className={cn(
                    "text-left w-full bg-white rounded-xl border border-hairline p-3 flex items-center gap-3 group",
                    interactive && "cursor-pointer hover:border-primary/30 hover:shadow-sm"
                  )}
                  onClick={() => attachContext({ campaignName: camp.campaignName, platform: camp.platform as Platform })}
                >
                  <span className="w-6 text-center text-[13px] font-semibold text-ink-muted tabular-nums shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{camp.campaignName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[11px] capitalize">{camp.platform}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] text-ink-muted">Conv.</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{camp.conversions}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-ink-muted">CPA</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(camp.cpa)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-ink-muted">Spend</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(camp.spend)}</p>
                    </div>
                    {interactive && (
                      <BiMessageRounded className="w-3.5 h-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {worstCampaigns.length > 0 && (
          <div>
            <p className="text-[12px] font-medium text-ink-muted mb-2.5 flex items-center gap-1.5">
              <BiTrendingDown className="w-3.5 h-3.5 text-amber-600" /> Needs attention (low CTR)
            </p>
            <div className="space-y-2">
              {worstCampaigns.map((camp) => (
                <button
                  key={camp.campaignName}
                  type="button"
                  aria-label={`Ask the AI assistant about campaign ${camp.campaignName}`}
                  className={cn(
                    "text-left w-full bg-amber-50/50 rounded-xl border border-amber-100 p-3 flex items-center gap-3",
                    interactive && "cursor-pointer hover:border-amber-300 hover:shadow-sm"
                  )}
                  onClick={() => attachContext({ campaignName: camp.campaignName, platform: camp.platform as Platform, metric: "CTR" })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{camp.campaignName}</p>
                    <Badge variant="secondary" className="text-[11px] capitalize mt-0.5">{camp.platform}</Badge>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] text-ink-muted">CTR</p>
                      <p className="text-[13px] font-semibold text-amber-600 tabular-nums">{camp.ctr}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-ink-muted">CPA</p>
                      <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(camp.cpa)}</p>
                    </div>
                    <BiChevronRight className="w-4 h-4 text-ink-faint" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Health Score */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiPulse className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Account health</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.health}</p>

        <Panel className="p-5">
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
                      className="h-full rounded-full transition-[width] duration-300 ease-out"
                      style={{ width: `${sub.score}%`, backgroundColor: color }}
                    />
                  </div>
                  <p className="text-[11px] text-ink-muted mt-1.5 line-clamp-2">{sub.description}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>

      {/* Creative Performance */}
      {data.creatives && data.creatives.totalCreatives > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BiImage className="w-4 h-4 text-ink-muted shrink-0" />
            <h3 className="text-[15px] font-semibold text-ink">Creative performance</h3>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted mb-4">{data.narratives.creatives}</p>

          {/* Creative KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-hairline rounded-xl border border-hairline overflow-hidden mb-4">
            <div className="bg-white p-4">
              <p className="text-[12px] font-medium text-ink-muted">Total creatives</p>
              <p className="text-lg font-semibold text-ink tabular-nums mt-1">{data.creatives.totalCreatives}</p>
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ink-muted">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />{data.creatives.activeCount} active
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 ml-1" />{data.creatives.fatiguedCount} fatigued
              </div>
            </div>
            <div className="bg-white p-4">
              <p className="text-[12px] font-medium text-ink-muted">Avg CTR</p>
              <p className="text-lg font-semibold text-ink tabular-nums mt-1">{data.creatives.avgCtr}%</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[12px] font-medium text-ink-muted">Avg CPA</p>
              <p className="text-lg font-semibold text-ink tabular-nums mt-1">${data.creatives.avgCpa}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[12px] font-medium text-ink-muted">Fatigued</p>
              <p className={cn("text-lg font-semibold tabular-nums mt-1", data.creatives.fatiguedCount > 0 ? "text-amber-600" : "text-ink")}>{data.creatives.fatiguedCount}</p>
              {data.creatives.fatiguedCount > 0 && <p className="text-[11px] text-amber-600 mt-0.5">needs refresh</p>}
            </div>
          </div>

          {/* By Creative Type */}
          {data.creatives.byType.length > 0 && (
            <Panel className="p-4 mb-4">
              <p className="text-[12px] font-medium text-ink-muted mb-3">Performance by creative type</p>
              <div className="grid gap-2">
                {data.creatives.byType.sort((a, b) => b.totalConversions - a.totalConversions).map((t) => {
                  const TypeIcon = t.type === "video" ? BiVideo : t.type === "carousel" ? BiCarousel : BiImage;
                  return (
                    <div key={t.type} className="flex items-center gap-3 bg-canvas-soft/60 rounded-lg px-3 py-2.5">
                      <div className="w-7 h-7 rounded-md bg-white border border-hairline flex items-center justify-center shrink-0">
                        <TypeIcon className="w-3.5 h-3.5 text-ink-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-ink capitalize">{t.type}</p>
                        <p className="text-[11px] text-ink-muted">{t.count} creatives</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-right">
                        <div>
                          <p className="text-[11px] text-ink-muted">CTR</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{t.avgCtr}%</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-ink-muted">CPA</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">${t.avgCpa}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-ink-muted">Conv.</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{formatNum(t.totalConversions)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-ink-muted">Spend</p>
                          <p className="text-[12px] font-semibold text-ink tabular-nums">{fmt(t.totalSpend)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* Top Creative Performers */}
          {data.creatives.topPerformers.length > 0 && (
            <div className="mb-4">
              <p className="text-[12px] font-medium text-ink-muted mb-2.5 flex items-center gap-1.5">
                <BiTrendingUp className="w-3.5 h-3.5 text-emerald-600" /> Top creatives
              </p>
              <div className="space-y-2">
                {data.creatives.topPerformers.map((cr, i) => (
                  <Panel key={cr.headline + i} className="p-3 flex items-center gap-3">
                    <span className="w-6 text-center text-[13px] font-semibold text-ink-muted tabular-nums shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{cr.headline}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[11px] capitalize">{cr.platform}</Badge>
                        <Badge variant="secondary" className="text-[11px] capitalize">{cr.type}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">Conv.</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{cr.conversions}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">CPA</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{fmt(cr.cpa)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">CTR</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{cr.ctr}%</p>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          )}

          {/* Fatigued Creatives */}
          {data.creatives.fatiguedCreatives.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-ink-muted mb-2.5 flex items-center gap-1.5">
                <BiError className="w-3.5 h-3.5 text-amber-600" /> Creative fatigue alert
              </p>
              <div className="space-y-2">
                {data.creatives.fatiguedCreatives.map((f, i) => (
                  <div key={f.headline + i} className="bg-amber-50/50 rounded-xl border border-amber-100 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{f.headline}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[11px] capitalize">{f.platform}</Badge>
                        <span className="text-[11px] text-amber-600 font-medium">{f.daysRunning} days running</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">Fatigue</p>
                        <p className="text-[13px] font-semibold text-amber-600 tabular-nums">{f.fatigueScore.toFixed(0)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">CTR</p>
                        <p className="text-[13px] font-semibold text-ink tabular-nums">{f.ctr}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-ink-muted">CPA</p>
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

      {/* Recommendations */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BiBulb className="w-4 h-4 text-primary shrink-0" />
          <h3 className="text-[15px] font-semibold text-ink">Recommendations</h3>
        </div>
        <div className="rounded-xl border border-hairline bg-canvas-soft/50 p-4">
          <p className="text-[13px] leading-relaxed text-ink-secondary">{data.narratives.recommendations}</p>
        </div>
      </section>
    </div>
  );
}
