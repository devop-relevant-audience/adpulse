"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/store/app-store";
import {
  useRevenueOverview,
  useAttributionComparison,
  useCohortAnalysis,
  type AttributionComparison,
} from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { BiBulb, BiCoinStack, BiDollar, BiCart, BiError, BiTrendingUp, BiTrendingDown } from "react-icons/bi";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import type { Platform, AttributionModel } from "@/lib/types/database";
import { Panel } from "@/components/ui/panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  SERIES_PALETTE,
  CHART_GRID,
  CHART_AXIS_TEXT,
} from "@/lib/dashboard/chart-theme";

// Model identity drawn from the canonical SERIES_PALETTE (blue, violet, cyan,
// pink, teal) — one entry per model, by index. No model uses red/green/amber,
// which are reserved for good/bad status signaling.
const MODEL_COLORS: Record<AttributionModel, string> = {
  first_touch: SERIES_PALETTE[0],
  last_touch: SERIES_PALETTE[1],
  linear: SERIES_PALETTE[2],
  time_decay: SERIES_PALETTE[3],
  position_based: SERIES_PALETTE[4],
};

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const chartTooltipStyle = {
  backgroundColor: "white",
  border: "1px solid #e6e6e6",
  borderRadius: "10px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  padding: "10px 14px",
};

function InsightCallout({ icon, text, tone = "primary" }: { icon: React.ReactNode; text: string; tone?: "primary" | "warning" }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 flex items-start gap-2.5",
        tone === "warning" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-primary/5 border-primary/15 text-ink"
      )}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <p className="text-[13px] leading-relaxed">{text}</p>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</div>
        <p className="text-[12px] font-medium text-ink-muted">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-ink tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-ink-muted mt-1.5">{sub}</p>}
    </Panel>
  );
}

// ---------- Tab 1: Revenue & ROAS ----------

function RevenueRoasTab({ clientId }: { clientId: string }) {
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data, isLoading, isError, refetch } = useRevenueOverview({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (isError) return <QueryError onRetry={() => refetch()} message="Couldn't load revenue data" />;
  if (!data) return <EmptyState />;

  const chartData = data.platforms.map((p) => ({
    platform: PLATFORM_LABELS[p.platform],
    color: PLATFORM_COLORS[p.platform],
    "Reported ROAS": Number(p.reportedRoas.toFixed(2)),
    "Blended ROAS": Number(p.blendedRoas.toFixed(2)),
    roasGap: p.roasGap,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Blended ROAS"
          value={`${data.blended.roas.toFixed(2)}x`}
          sub={`vs ${data.platformReported.roas.toFixed(2)}x platform-reported`}
          icon={<BiTrendingUp className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Real revenue"
          value={formatCurrency(data.blended.revenue)}
          sub={`Platforms claim ${formatCurrency(data.platformReported.revenue)}`}
          icon={<BiDollar className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Blended AOV"
          value={formatCurrency(data.blended.aov)}
          sub={`CPA ${formatCurrency(data.blended.cpa)} · Spend ${formatCurrency(data.totalSpend)}`}
          icon={<BiCart className="w-3.5 h-3.5" />}
        />
      </div>

      <InsightCallout icon={<BiBulb className="w-4 h-4" />} text={data.insight} />

      <InsightCallout
        icon={<BiError className="w-4 h-4" />}
        tone="warning"
        text={`Over-attribution: platforms collectively claim ${formatNum(data.overAttribution.conversionsClaimed)} conversions vs ${formatNum(data.overAttribution.conversionsActual)} real (deduplicated) conversions — a ${data.overAttribution.inflationPct.toFixed(0)}% inflation.`}
      />

      <Panel>
        <div className="px-5 py-3.5 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">Reported ROAS vs Blended (Real) ROAS</h3>
          <p className="text-[12px] text-ink-muted mt-0.5">The gap is each platform&apos;s self-attribution inflation.</p>
        </div>
        <div className="px-2 pt-3">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid stroke={CHART_GRID} strokeDasharray="none" vertical={false} />
              <XAxis dataKey="platform" tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}x`} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${Number(v).toFixed(2)}x`, ""]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Reported ROAS" fill="#d4d4d4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Blended ROAS" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">Per-platform breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-hairline bg-canvas-soft/50">
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted">Platform</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Spend</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Reported conv.</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Blended conv.</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Reported ROAS</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Blended ROAS</th>
                <th className="px-5 py-2.5 text-[11px] font-medium text-ink-muted text-right">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {data.platforms.map((p) => (
                <tr key={p.platform} className="hover:bg-canvas-soft/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] }} />
                      <span className="text-[13px] font-medium text-ink">{PLATFORM_LABELS[p.platform]}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatCurrency(p.spend)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNum(p.reportedConversions)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink">{formatNum(p.blendedConversions)}</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-muted">{p.reportedRoas.toFixed(2)}x</td>
                  <td className="px-5 py-3 text-right text-[13px] tabular-nums font-semibold text-ink">{p.blendedRoas.toFixed(2)}x</td>
                  <td className="px-5 py-3 text-right">
                    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-red-500 tabular-nums">
                      <BiTrendingDown className="w-3 h-3" />
                      -{p.roasGap.toFixed(2)}x
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Tab 2: Attribution Models ----------

const MODEL_ORDER: AttributionModel[] = ["first_touch", "last_touch", "linear", "time_decay", "position_based"];

function AttributionModelsTab({ clientId }: { clientId: string }) {
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const [selectedModel, setSelectedModel] = useState<AttributionModel>("last_touch");

  const { data, isLoading, isError, refetch } = useAttributionComparison({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (isError) return <QueryError onRetry={() => refetch()} message="Couldn't load attribution data" />;
  if (!data) return <EmptyState />;

  const models = MODEL_ORDER
    .map((m) => data.models.find((mm) => mm.model === m))
    .filter((m): m is AttributionComparison["models"][number] => !!m);

  // Grouped bar: x = platform, one bar per model, y = sharePct
  const platforms: Platform[] = ["google", "meta", "tiktok"];
  const groupedData = platforms.map((p) => {
    const row: Record<string, unknown> = { platform: PLATFORM_LABELS[p] };
    for (const m of models) {
      const credit = m.credit.find((c) => c.platform === p);
      row[m.label] = credit ? Number(credit.sharePct.toFixed(1)) : 0;
    }
    const reported = data.platformReported.find((r) => r.platform === p);
    row["Platform-Reported"] = reported ? Number(reported.sharePct.toFixed(1)) : 0;
    return row;
  });

  const activeModel = data.models.find((m) => m.model === selectedModel);
  const donutData = activeModel
    ? activeModel.credit.map((c) => ({
        name: PLATFORM_LABELS[c.platform],
        value: c.sharePct,
        color: PLATFORM_COLORS[c.platform],
        revenue: c.revenue,
      }))
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Total blended revenue" value={formatCurrency(data.totalRevenue)} icon={<BiDollar className="w-3.5 h-3.5" />} />
        <StatCard label="Total blended conversions" value={formatNum(data.totalConversions)} icon={<BiCoinStack className="w-3.5 h-3.5" />} />
      </div>

      <InsightCallout icon={<BiBulb className="w-4 h-4" />} text={data.insight} />

      <Panel>
        <div className="px-5 py-3.5 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">Revenue share by model, per platform</h3>
          <p className="text-[12px] text-ink-muted mt-0.5">
            Watch Google&apos;s share collapse from last-touch to first-touch — it harvests demand top-funnel platforms created.
          </p>
        </div>
        <div className="px-2 pt-3">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={groupedData} barGap={2} barCategoryGap="20%">
              <CartesianGrid stroke={CHART_GRID} strokeDasharray="none" vertical={false} />
              <XAxis dataKey="platform" tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Platform-Reported" fill="#d4d4d4" radius={[3, 3, 0, 0]} />
              {models.map((m) => (
                <Bar key={m.model} dataKey={m.label} fill={MODEL_COLORS[m.model]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-ink">Model explorer</h3>
          <Tabs value={selectedModel} onValueChange={(v) => setSelectedModel(v as AttributionModel)}>
            <TabsList>
              {models.map((m) => (
                <TabsTrigger key={m.model} value={m.model}>{m.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
                {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v, _n, entry) => {
                  const payload = (entry as { payload?: { revenue?: number; name?: string } } | undefined)?.payload;
                  return [`${Number(v).toFixed(1)}% · ${formatCurrency(payload?.revenue ?? 0)}`, payload?.name ?? ""];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2">
            {activeModel?.credit.map((c) => (
              <div key={c.platform} className="flex items-center justify-between px-3 py-2 rounded-lg bg-canvas-soft/50">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[c.platform] }} />
                  <span className="text-[13px] font-medium text-ink">{PLATFORM_LABELS[c.platform]}</span>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-ink tabular-nums">{c.sharePct.toFixed(1)}%</p>
                  <p className="text-[11px] text-ink-muted tabular-nums">{formatCurrency(c.revenue)} · {c.roas.toFixed(2)}x ROAS</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Tab 3: LTV & Cohorts ----------

function CohortsTab({ clientId }: { clientId: string }) {
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data, isLoading, isError, refetch } = useCohortAnalysis({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const lineChartData = useMemo(() => {
    if (!data) return [];
    const maxOffset = Math.max(0, ...data.cohorts.flatMap((c) => c.curve.map((pt) => pt.monthOffset)));
    return Array.from({ length: maxOffset + 1 }, (_, offset) => {
      const row: Record<string, unknown> = { monthOffset: offset };
      for (const c of data.cohorts) {
        const pt = c.curve.find((p) => p.monthOffset === offset);
        row[c.platform] = pt ? Number(pt.cumulativeRevenuePerCustomer.toFixed(2)) : null;
      }
      return row;
    });
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (isError) return <QueryError onRetry={() => refetch()} message="Couldn't load cohort data" />;
  if (!data) return <EmptyState />;

  const byDay0Roas = [...data.cohorts].sort((a, b) => b.day0Roas - a.day0Roas);
  const byLtvCac = [...data.cohorts].sort((a, b) => b.ltvCacRatio - a.ltvCacRatio);

  return (
    <div className="space-y-4">
      <InsightCallout icon={<BiBulb className="w-4 h-4" />} text={data.insight} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Panel className="p-4">
          <p className="text-[12px] font-medium text-ink-muted mb-2">Ranked by Day-0 ROAS</p>
          <div className="space-y-1.5">
            {byDay0Roas.map((c, i) => (
              <div key={c.platform} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5"><span className="text-ink-muted tabular-nums w-3">{i + 1}</span><span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[c.platform] }} />{PLATFORM_LABELS[c.platform]}</span>
                <span className="font-semibold tabular-nums text-ink">{c.day0Roas.toFixed(2)}x</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-4">
          <p className="text-[12px] font-medium text-ink-muted mb-2">Ranked by LTV:CAC</p>
          <div className="space-y-1.5">
            {byLtvCac.map((c, i) => (
              <div key={c.platform} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5"><span className="text-ink-muted tabular-nums w-3">{i + 1}</span><span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[c.platform] }} />{PLATFORM_LABELS[c.platform]}</span>
                <span className="font-semibold tabular-nums text-ink">{c.ltvCacRatio.toFixed(2)}x</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {byDay0Roas[0]?.platform !== byLtvCac[0]?.platform && (
        <InsightCallout
          icon={<BiError className="w-4 h-4" />}
          tone="warning"
          text={`Ranking inversion: ${PLATFORM_LABELS[byDay0Roas[0].platform]} wins on Day-0 ROAS, but ${PLATFORM_LABELS[byLtvCac[0].platform]} wins on LTV:CAC once retention plays out. Short-window ROAS is misleading budget signal here.`}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data.cohorts.map((c) => (
          <Panel key={c.platform} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[c.platform] }} />
              <h4 className="text-sm font-semibold text-ink">{PLATFORM_LABELS[c.platform]}</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-ink-muted">CAC</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{formatCurrency(c.cac)}</p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">LTV</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{formatCurrency(c.ltv)}</p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">LTV:CAC</p>
                <p className={cn("text-[15px] font-semibold tabular-nums", c.ltvCacRatio >= 3 ? "text-emerald-600" : c.ltvCacRatio >= 2 ? "text-amber-600" : "text-red-500")}>{c.ltvCacRatio.toFixed(2)}x</p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">Day-0 ROAS</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{c.day0Roas.toFixed(2)}x</p>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] text-ink-muted">Payback period</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{c.paybackMonths !== null ? `${c.paybackMonths} mo` : "Never"}</p>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="px-5 py-3.5 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">Cumulative LTV curve</h3>
          <p className="text-[12px] text-ink-muted mt-0.5">Cumulative revenue per customer vs. months since acquisition. Dashed lines mark each platform&apos;s CAC (breakeven).</p>
        </div>
        <div className="px-2 pt-3 pb-3">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={lineChartData}>
              <CartesianGrid stroke="#f0f0f0" strokeDasharray="none" vertical={false} />
              <XAxis dataKey="monthOffset" tick={{ fontSize: 10, fill: "#6b6b6b" }} axisLine={false} tickLine={false} tickFormatter={(v) => `M${v}`} />
              <YAxis tick={{ fontSize: 10, fill: "#6b6b6b" }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => formatCurrency(v)} />
              <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(v) => `Month ${v}`} formatter={(v, name) => [formatCurrency(Number(v)), PLATFORM_LABELS[name as Platform] || String(name)]} />
              <Legend formatter={(v) => PLATFORM_LABELS[v as Platform] || v} wrapperStyle={{ fontSize: 12 }} />
              {data.cohorts.map((c) => (
                <ReferenceLine key={`ref-${c.platform}`} y={c.cac} stroke={PLATFORM_COLORS[c.platform]} strokeDasharray="4 4" strokeOpacity={0.5} />
              ))}
              {data.cohorts.map((c) => (
                <Line
                  key={c.platform}
                  type="monotone"
                  dataKey={c.platform}
                  stroke={PLATFORM_COLORS[c.platform]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5, stroke: "white", strokeWidth: 2 }}
                  connectNulls
                  name={c.platform}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}

function EmptyState() {
  return (
    <Panel className="p-10 text-center">
      <p className="text-[13px] text-ink-muted">No attribution data available for this range.</p>
    </Panel>
  );
}

export function AttributionView() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const [tab, setTab] = useState<"revenue" | "models" | "cohorts">("revenue");

  if (!clientId) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[300px] w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Attribution &amp; Revenue</h1>
        <p className="text-[13px] text-ink-muted mt-0.5">Blended revenue truth, model divergence, and long-term customer value across platforms</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "revenue" | "models" | "cohorts")}>
        <TabsList>
          <TabsTrigger value="revenue">Revenue &amp; ROAS</TabsTrigger>
          <TabsTrigger value="models">Attribution models</TabsTrigger>
          <TabsTrigger value="cohorts">LTV &amp; cohorts</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "revenue" && <RevenueRoasTab clientId={clientId} />}
      {tab === "models" && <AttributionModelsTab clientId={clientId} />}
      {tab === "cohorts" && <CohortsTab clientId={clientId} />}
    </div>
  );
}
