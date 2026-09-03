"use client";

import { useState, useMemo, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import {
  useCampaigns,
  useCampaignComparison,
  useComparison,
  useDailyTrend,
  type CampaignComparisonData,
} from "@/hooks/use-metrics";
import type { ComparisonResult } from "@/lib/data/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BiTrendingUp, BiTrendingDown, BiRefresh, BiMinus, BiUpArrowAlt, BiDownArrowAlt, BiMessageRounded } from "react-icons/bi";
import { format, subDays, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import ReactMarkdown from "react-markdown";
import type { Platform } from "@/lib/types/database";
import { Panel } from "@/components/ui/panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SERIES_PALETTE, CHART_GRID, CHART_AXIS_TEXT } from "@/lib/dashboard/chart-theme";
import { formatCurrency, formatNumber as formatNum } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency-format";

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded text-ink-muted bg-canvas-soft"><BiMinus className="w-3 h-3" />0%</span>;
  const isGood = invert ? value < 0 : value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded",
      isGood ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
    )}>
      {value >= 0 ? <BiUpArrowAlt className="w-3 h-3" /> : <BiDownArrowAlt className="w-3 h-3" />}
      {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

type MetricDef = {
  key: string;
  label: string;
  format: (v: number, currency: string) => string;
  best: "low" | "high";
};

const METRIC_DEFS: MetricDef[] = [
  { key: "totalSpend", label: "Spend", format: formatCurrency, best: "low" },
  { key: "totalConversions", label: "Conversions", format: formatNum, best: "high" },
  { key: "avgCpa", label: "CPA", format: formatCurrency, best: "low" },
  { key: "avgCtr", label: "CTR", format: (v) => `${v}%`, best: "high" },
  { key: "avgCpc", label: "CPC", format: formatCurrency, best: "low" },
  { key: "totalImpressions", label: "Impressions", format: formatNum, best: "high" },
  { key: "totalClicks", label: "Clicks", format: formatNum, best: "high" },
];

function getVal(c: CampaignComparisonData, key: string): number {
  return (c as unknown as Record<string, number>)[key] ?? 0;
}

function computeWinners(campaigns: CampaignComparisonData[]) {
  const wins: Record<string, number> = {};
  for (const c of campaigns) wins[c.campaignId] = 0;

  const perMetric: Array<{ metric: string; winnerId: string }> = [];

  for (const m of METRIC_DEFS) {
    if (m.key === "totalSpend") continue;
    const values = campaigns.map((c) => ({ id: c.campaignId, val: getVal(c, m.key) }));
    const sorted = [...values].sort((a, b) => m.best === "high" ? b.val - a.val : a.val - b.val);
    const winnerId = sorted[0]?.val > 0 ? sorted[0].id : "";
    if (winnerId) {
      wins[winnerId] = (wins[winnerId] || 0) + 1;
      perMetric.push({ metric: m.label, winnerId });
    }
  }

  const overallWinnerId = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { wins, perMetric, overallWinnerId };
}

function generateAISummary(campaigns: CampaignComparisonData[], currency: string): string {
  if (campaigns.length < 2) return "";
  const { wins, overallWinnerId } = computeWinners(campaigns);
  const winner = campaigns.find((c) => c.campaignId === overallWinnerId);
  if (!winner) return "";

  const loser = campaigns.reduce((worst, c) => (wins[c.campaignId] < wins[worst.campaignId] ? c : worst), campaigns[0]);

  const cpaDiff = loser.avgCpa > 0 && winner.avgCpa > 0
    ? ((loser.avgCpa - winner.avgCpa) / loser.avgCpa * 100).toFixed(0)
    : null;
  const convDiff = winner.totalConversions > 0 && loser.totalConversions > 0
    ? ((winner.totalConversions - loser.totalConversions) / loser.totalConversions * 100).toFixed(0)
    : null;

  const parts: string[] = [];
  parts.push(`**${winner.campaignName}** is the overall best performer, winning ${wins[winner.campaignId]} out of ${METRIC_DEFS.length - 1} metrics.\n`);

  if (cpaDiff && Number(cpaDiff) > 0) {
    parts.push(`- **CPA:** ${cpaDiff}% lower (${formatCurrency(winner.avgCpa, currency)} vs ${formatCurrency(loser.avgCpa, currency)}) compared to ${loser.campaignName}`);
  }
  if (convDiff && Number(convDiff) > 0) {
    parts.push(`- **Conversions:** ${convDiff}% more (${formatNum(winner.totalConversions)} vs ${formatNum(loser.totalConversions)})`);
  }
  if (winner.avgCtr > loser.avgCtr) {
    parts.push(`- **CTR:** ${winner.avgCtr}% suggests stronger ad creative engagement`);
  }

  const highSpender = campaigns.reduce((max, c) => c.totalSpend > max.totalSpend ? c : max, campaigns[0]);
  const efficientCampaign = campaigns.reduce((best, c) => c.avgCpa > 0 && (best.avgCpa === 0 || c.avgCpa < best.avgCpa) ? c : best, campaigns[0]);

  if (highSpender.campaignId !== efficientCampaign.campaignId) {
    parts.push(`\n**Recommendation:** Consider shifting budget from ${highSpender.campaignName} (highest spend at ${formatCurrency(highSpender.totalSpend, currency)}) toward ${efficientCampaign.campaignName} (most efficient at ${formatCurrency(efficientCampaign.avgCpa, currency)} CPA) for better overall ROI.`);
  }

  return parts.join("\n");
}

function CampaignSelector({
  campaigns,
  selected,
  onChange,
  index,
}: {
  campaigns: Array<{ campaign_id: string; campaign_name: string; platform: string }>;
  selected: string;
  onChange: (id: string) => void;
  index: number;
}) {
  const selectedCampaign = campaigns.find((c) => c.campaign_id === selected);

  return (
    <div className="min-w-0">
      <label className="text-[12px] font-medium text-ink-muted flex items-center gap-1.5 mb-1.5">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SERIES_PALETTE[index] }} />
        Campaign {index + 1}
      </label>
      <Select value={selected || "none"} onValueChange={(v) => { if (v && v !== "none") onChange(v); }}>
        <SelectTrigger className="h-9 text-[13px] w-full">
          {selectedCampaign ? (
            <span className="truncate">{selectedCampaign.campaign_name} ({selectedCampaign.platform})</span>
          ) : (
            <SelectValue placeholder="Select campaign" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" disabled>Select a campaign</SelectItem>
          {campaigns.map((c) => (
            <SelectItem key={c.campaign_id} value={c.campaign_id} className="text-[13px]">
              {c.campaign_name} ({c.platform})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function OverallWinnerBanner({ campaigns }: { campaigns: CampaignComparisonData[] }) {
  const { formatCurrency } = useCurrencyFormat();
  const { wins, overallWinnerId } = computeWinners(campaigns);
  const winner = campaigns.find((c) => c.campaignId === overallWinnerId);
  const winnerIdx = campaigns.findIndex((c) => c.campaignId === overallWinnerId);
  if (!winner) return null;

  const totalMetrics = METRIC_DEFS.length - 1;
  const winCount = wins[overallWinnerId] || 0;

  return (
    <div className="bg-emerald-50/40 rounded-xl border border-hairline overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SERIES_PALETTE[winnerIdx] }} />
            <h3 className="text-[15px] font-semibold text-ink">{winner.campaignName}</h3>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Overall winner</span>
          </div>
          <p className="text-[12px] text-ink-muted">
            Leads in {winCount} of {totalMetrics} key metrics &middot; {winner.platform} &middot; {formatCurrency(winner.avgCpa)} CPA &middot; {winner.avgCtr}% CTR &middot; {formatNum(winner.totalConversions)} conversions
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {campaigns.map((c, idx) => {
            const w = wins[c.campaignId] || 0;
            const isWinner = c.campaignId === overallWinnerId;
            return (
              <div key={c.campaignId} className={cn("flex flex-col items-center rounded-lg px-3 py-2 min-w-[56px]", isWinner ? "bg-emerald-50" : "bg-canvas-soft")}>
                <span className="w-2 h-2 rounded-full mb-1" style={{ backgroundColor: SERIES_PALETTE[idx] }} />
                <span className={cn("text-[15px] font-bold tabular-nums", isWinner ? "text-emerald-700" : "text-ink-muted")}>{w}</span>
                <span className="text-[11px] text-ink-muted">wins</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AISummaryCard({ campaigns }: { campaigns: CampaignComparisonData[] }) {
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const { currency } = useCurrencyFormat();
  const fallbackText = useMemo(() => generateAISummary(campaigns, currency), [campaigns, currency]);
  const clientId = useAppStore((s) => s.selectedClientId);

  const fetchAISummary = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const dataContext = campaigns.map((c) => ({
        name: c.campaignName, platform: c.platform,
        spend: c.totalSpend, conversions: c.totalConversions, cpa: c.avgCpa,
        ctr: c.avgCtr, cpc: c.avgCpc, impressions: c.totalImpressions, clicks: c.totalClicks,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Compare these campaigns and give a concise analysis in markdown. Use bold for campaign names, bullet points for key findings, and end with a one-sentence recommendation. Data: ${JSON.stringify(dataContext)}`,
          clientId,
          referenceContext: null,
        }),
      });

      if (!res.ok) { setAiText(fallbackText); return; }

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) { setAiText(fallbackText); return; }

        let text = "";
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) text += parsed.content;
              } catch { /* skip */ }
            }
          }
        }
        setAiText(text || fallbackText);
      } else {
        const data = await res.json();
        setAiText(data.response || fallbackText);
      }
    } catch {
      setAiText(fallbackText);
    } finally {
      setLoading(false);
    }
  }, [campaigns, clientId, fallbackText]);

  const displayText = aiText || fallbackText;

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Comparison insight</h3>
        <button
          onClick={fetchAISummary}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
        >
          {loading && <BiRefresh className="w-3.5 h-3.5 animate-spin" />}
          {aiText ? "Regenerate AI analysis" : "Get AI analysis"}
        </button>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <p className="text-[13px] text-ink-muted">Analyzing campaign performance...</p>
        ) : (
          <div className="prose-chat text-[13px] text-ink leading-relaxed">
            <ReactMarkdown>{displayText}</ReactMarkdown>
          </div>
        )}
      </div>
    </Panel>
  );
}

function CampaignComparisonTab({ clientId }: { clientId: string }) {
  const { formatCurrency } = useCurrencyFormat();
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const { data: campaigns, isLoading: campaignsLoading, isError: campaignsError, refetch: refetchCampaigns } = useCampaigns(clientId);
  const [selectedIds, setSelectedIds] = useState<string[]>(["", ""]);

  const activeIds = selectedIds.filter(Boolean);

  const { data: compData, isLoading: compLoading, isError: compError, refetch: refetchComp } = useCampaignComparison({
    clientId,
    campaignIds: activeIds,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const campaignList = useMemo(() => {
    if (!compData) return [];
    return activeIds.map((id) => compData[id]).filter(Boolean);
  }, [compData, activeIds]);

  const chartData = useMemo(() => {
    if (!compData || campaignList.length < 2) return [];
    const allDates = new Set<string>();
    for (const c of campaignList) {
      for (const d of c.daily) allDates.add(d.date);
    }
    return Array.from(allDates).sort().map((date) => {
      const point: Record<string, unknown> = { date };
      for (const c of campaignList) {
        const dayData = c.daily.find((d) => d.date === date);
        point[`${c.campaignId}_spend`] = dayData?.spend || 0;
        point[`${c.campaignId}_conversions`] = dayData?.conversions || 0;
      }
      return point;
    });
  }, [compData, campaignList]);

  const [chartMetric, setChartMetric] = useState<"spend" | "conversions">("spend");

  if (campaignsLoading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  if (campaignsError) {
    return <QueryError onRetry={() => refetchCampaigns()} message="Couldn't load campaigns" />;
  }

  function updateSelection(index: number, value: string) {
    setSelectedIds((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function addCampaign() {
    if (selectedIds.length < 4) {
      setSelectedIds((prev) => [...prev, ""]);
    }
  }

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink">Select campaigns to compare</h3>
          {selectedIds.length < 4 && campaigns && campaigns.length > selectedIds.length && (
            <button onClick={addCampaign} className="text-[12px] text-primary font-medium hover:underline rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">+ Add campaign</button>
          )}
        </div>
        <div className={cn("grid gap-3", selectedIds.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
          {selectedIds.map((id, idx) => (
            <CampaignSelector
              key={idx}
              campaigns={campaigns || []}
              selected={id}
              onChange={(v) => updateSelection(idx, v)}
              index={idx}
            />
          ))}
        </div>
      </Panel>

      {compLoading && activeIds.length >= 2 && <Skeleton className="h-[400px] w-full" />}

      {compError && activeIds.length >= 2 && (
        <QueryError onRetry={() => refetchComp()} message="Couldn't load the campaign comparison" />
      )}

      {campaignList.length >= 2 && (
        <>
          <OverallWinnerBanner campaigns={campaignList} />

          <AISummaryCard campaigns={campaignList} />

          <Panel>
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-ink">Daily trends</h3>
              <div className="flex gap-1">
                {(["spend", "conversions"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMetric(m)}
                    className={cn("px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      chartMetric === m ? "bg-primary/10 text-primary" : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
                    )}
                  >
                    {m === "spend" ? "Spend" : "Conversions"}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="px-2 pb-3"
              role="img"
              aria-label={`Daily ${chartMetric} trends comparing the selected campaigns`}
            >
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData}>
                  <defs>
                    {campaignList.map((c, idx) => (
                      <linearGradient key={`grad-${c.campaignId}`} id={`cmp-grad-${c.campaignId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES_PALETTE[idx]} stopOpacity={idx === 0 ? 0.1 : 0} />
                        <stop offset="100%" stopColor={SERIES_PALETTE[idx]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="none" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => format(parseISO(v), "MMM d")} tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => chartMetric === "spend" ? formatCurrency(v) : formatNum(v)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "white", border: "1px solid #e6e6e6", borderRadius: "10px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "10px 14px" }}
                    labelFormatter={(v) => format(parseISO(v as string), "EEE, MMM d, yyyy")}
                    formatter={(value, name) => {
                      const campaignId = (name as string).replace(`_${chartMetric}`, "");
                      const campaign = campaignList.find((c) => c.campaignId === campaignId);
                      return [chartMetric === "spend" ? formatCurrency(value as number) : formatNum(value as number), campaign?.campaignName || campaignId];
                    }}
                  />
                  {campaignList.map((c, idx) => (
                    idx === 0 ? (
                      <Area key={c.campaignId} type="monotone" dataKey={`${c.campaignId}_${chartMetric}`} stroke={SERIES_PALETTE[idx]} strokeWidth={2} fill={`url(#cmp-grad-${c.campaignId})`} dot={false} activeDot={{ r: 4, fill: SERIES_PALETTE[idx], stroke: "white", strokeWidth: 2 }} name={`${c.campaignId}_${chartMetric}`} />
                    ) : (
                      <Line key={c.campaignId} type="monotone" dataKey={`${c.campaignId}_${chartMetric}`} stroke={SERIES_PALETTE[idx]} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: SERIES_PALETTE[idx], stroke: "white", strokeWidth: 2 }} name={`${c.campaignId}_${chartMetric}`} />
                    )
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-4 pb-3 text-[11px]">
              {campaignList.map((c, idx) => (
                <div key={c.campaignId} className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded" style={{ backgroundColor: SERIES_PALETTE[idx] }} />
                  <span className="text-ink-muted">{c.campaignName}</span>
                </div>
              ))}
            </div>
          </Panel>

          <ComparisonTable campaigns={campaignList} />

          <AskAICampaignButton campaigns={campaignList} />
        </>
      )}
    </div>
  );
}

function AskAICampaignButton({ campaigns }: { campaigns: CampaignComparisonData[] }) {
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const dateRange = useAppStore((s) => s.dateRange);

  function handleClick() {
    setReferenceContext({
      comparisonType: "campaigns",
      dateRange,
      comparisonCampaigns: campaigns.map((c) => ({
        name: c.campaignName,
        platform: c.platform,
        spend: c.totalSpend,
        conversions: c.totalConversions,
        cpa: c.avgCpa,
        ctr: c.avgCtr,
        cpc: c.avgCpc,
        impressions: c.totalImpressions,
        clicks: c.totalClicks,
      })),
    });
  }

  return (
    <div className="flex justify-end">
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <BiMessageRounded className="w-3.5 h-3.5" />
        Ask AI about this comparison
      </button>
    </div>
  );
}

function ComparisonTable({ campaigns }: { campaigns: CampaignComparisonData[] }) {
  const { currency } = useCurrencyFormat();
  const { perMetric } = computeWinners(campaigns);
  const winnerMap = new Map(perMetric.map((p) => [p.metric, p.winnerId]));

  function getDelta(campaigns: CampaignComparisonData[], key: string, best: "high" | "low"): Map<string, number> {
    const values = campaigns.map((c) => ({ id: c.campaignId, val: getVal(c, key) }));
    const sorted = [...values].sort((a, b) => best === "high" ? b.val - a.val : a.val - b.val);
    const bestVal = sorted[0]?.val || 0;
    const map = new Map<string, number>();
    for (const v of values) {
      if (bestVal === 0) { map.set(v.id, 0); continue; }
      const pct = best === "high"
        ? bestVal > 0 ? ((v.val - bestVal) / bestVal) * 100 : 0
        : v.val > 0 ? ((v.val - bestVal) / bestVal) * 100 : 0;
      map.set(v.id, pct);
    }
    return map;
  }

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-hairline">
        <h3 className="text-sm font-semibold text-ink">Metric breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-hairline">
              <TableHead className="text-[11px] font-medium text-ink-muted h-9 pl-5 w-[100px]">Metric</TableHead>
              {campaigns.map((c, idx) => (
                <TableHead key={c.campaignId} className="text-[11px] font-medium text-ink-muted h-9">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SERIES_PALETTE[idx] }} />
                    {c.campaignName}
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-[11px] font-medium text-ink-muted h-9 pr-5 w-[90px]">Best</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {METRIC_DEFS.map((m) => {
              const deltas = getDelta(campaigns, m.key, m.best);
              const winnerId = m.key === "totalSpend" ? "" : winnerMap.get(m.label) || "";
              const winnerCampaign = campaigns.find((c) => c.campaignId === winnerId);
              const winnerIdx = campaigns.findIndex((c) => c.campaignId === winnerId);

              return (
                <TableRow key={m.key} className="border-hairline hover:bg-[#fafaf9]">
                  <TableCell className="text-[13px] text-ink font-medium pl-5">{m.label}</TableCell>
                  {campaigns.map((c) => {
                    const val = getVal(c, m.key);
                    const isBest = c.campaignId === winnerId;
                    const delta = deltas.get(c.campaignId) || 0;
                    return (
                      <TableCell key={c.campaignId} className="py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className={cn("text-[13px] tabular-nums", isBest ? "text-emerald-700 font-semibold" : "text-ink")}>{m.format(val, currency)}</span>
                          {m.key !== "totalSpend" && delta !== 0 && (
                            <span className={cn("text-[11px] tabular-nums",
                              (m.best === "high" ? delta >= 0 : delta <= 0) ? "text-emerald-600" : "text-red-500"
                            )}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}% vs best
                            </span>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  <TableCell className="pr-5">
                    {winnerCampaign && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold" style={{ backgroundColor: `${SERIES_PALETTE[winnerIdx]}15`, color: SERIES_PALETTE[winnerIdx] }}>
                        {winnerCampaign.campaignName.length > 14 ? winnerCampaign.campaignName.slice(0, 14) + "…" : winnerCampaign.campaignName}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

function PeriodComparisonTab({ clientId }: { clientId: string }) {
  const { formatCurrency } = useCurrencyFormat();
  const globalDateRange = useAppStore((s) => s.dateRange);
  const [periodA, setPeriodA] = useState({ start: globalDateRange.start, end: globalDateRange.end });
  const daysDiff = Math.round((new Date(periodA.end).getTime() - new Date(periodA.start).getTime()) / (1000 * 60 * 60 * 24));
  const [periodB, setPeriodB] = useState({
    start: format(subDays(new Date(periodA.start), daysDiff + 1), "yyyy-MM-dd"),
    end: format(subDays(new Date(periodA.start), 1), "yyyy-MM-dd"),
  });
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");

  const platform = platformFilter === "all" ? undefined : platformFilter;
  const selectedCampaignIds = useAppStore((s) => s.selectedCampaignIds);
  const campaignIds = selectedCampaignIds.length ? selectedCampaignIds : undefined;

  const { data: comparison, isLoading: compLoading, isError: compError, refetch: refetchComparison } = useComparison({
    clientId,
    currentStart: periodA.start,
    currentEnd: periodA.end,
    previousStart: periodB.start,
    previousEnd: periodB.end,
    platform,
    campaignIds,
  });

  const { data: trendA, isLoading: trendALoading } = useDailyTrend({ clientId, startDate: periodA.start, endDate: periodA.end, platform, campaignIds });
  const { data: trendB, isLoading: trendBLoading } = useDailyTrend({ clientId, startDate: periodB.start, endDate: periodB.end, platform, campaignIds });
  const [chartMetric, setChartMetric] = useState<"spend" | "conversions">("spend");

  const chartData = useMemo(() => {
    if (!trendA || !trendB) return [];
    const maxLen = Math.max(trendA.length, trendB.length);
    return Array.from({ length: maxLen }, (_, i) => ({
      day: `Day ${i + 1}`,
      periodA: (trendA[i] as Record<string, unknown>)?.[chartMetric] as number ?? null,
      periodB: (trendB[i] as Record<string, unknown>)?.[chartMetric] as number ?? null,
    }));
  }, [trendA, trendB, chartMetric]);

  const isLoading = compLoading || trendALoading || trendBLoading;

  const kpiCards = comparison ? [
    { label: "Spend", a: formatCurrency(comparison.current.totalSpend), b: formatCurrency(comparison.previous.totalSpend), delta: comparison.deltas.totalSpend.percentage },
    { label: "Conversions", a: formatNum(comparison.current.totalConversions), b: formatNum(comparison.previous.totalConversions), delta: comparison.deltas.totalConversions.percentage },
    { label: "CPA", a: formatCurrency(comparison.current.avgCpa), b: formatCurrency(comparison.previous.avgCpa), delta: comparison.deltas.avgCpa.percentage, invert: true },
    { label: "CTR", a: `${comparison.current.avgCtr}%`, b: `${comparison.previous.avgCtr}%`, delta: comparison.deltas.avgCtr.percentage },
    { label: "CPC", a: formatCurrency(comparison.current.avgCpc), b: formatCurrency(comparison.previous.avgCpc), delta: comparison.deltas.avgCpc.percentage, invert: true },
    { label: "Impressions", a: formatNum(comparison.current.totalImpressions), b: formatNum(comparison.previous.totalImpressions), delta: comparison.deltas.totalImpressions.percentage },
    { label: "Clicks", a: formatNum(comparison.current.totalClicks), b: formatNum(comparison.previous.totalClicks), delta: comparison.deltas.totalClicks.percentage },
    { label: "CPM", a: formatCurrency(comparison.current.avgCpm), b: formatCurrency(comparison.previous.avgCpm), delta: comparison.deltas.avgCpm.percentage, invert: true },
  ] : [];

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">Select periods</h3>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label className="text-[12px] font-medium text-ink-muted flex items-center gap-1.5 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0075de]" />Period A (current)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="Period A start date" value={periodA.start} onChange={(e) => setPeriodA((p) => ({ ...p, start: e.target.value }))} className="h-9 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus-visible:ring-3 focus-visible:ring-ring/50 focus:border-primary outline-none" />
              <input type="date" aria-label="Period A end date" value={periodA.end} onChange={(e) => setPeriodA((p) => ({ ...p, end: e.target.value }))} className="h-9 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus-visible:ring-3 focus-visible:ring-ring/50 focus:border-primary outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-muted flex items-center gap-1.5 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" />Period B (previous)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="Period B start date" value={periodB.start} onChange={(e) => setPeriodB((p) => ({ ...p, start: e.target.value }))} className="h-9 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus-visible:ring-3 focus-visible:ring-ring/50 focus:border-primary outline-none" />
              <input type="date" aria-label="Period B end date" value={periodB.end} onChange={(e) => setPeriodB((p) => ({ ...p, end: e.target.value }))} className="h-9 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus-visible:ring-3 focus-visible:ring-ring/50 focus:border-primary outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-muted block mb-1.5">Platform</label>
            <Select value={platformFilter} onValueChange={(v) => { if (v) setPlatformFilter(v as Platform | "all"); }}>
              <SelectTrigger className="h-9 min-w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="google">Google Ads</SelectItem>
                <SelectItem value="meta">Meta Ads</SelectItem>
                <SelectItem value="tiktok">TikTok Ads</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Panel>

      {isLoading && <Skeleton className="h-[400px] w-full" />}

      {compError && !isLoading && (
        <QueryError onRetry={() => refetchComparison()} message="Couldn't load the period comparison" />
      )}

      {comparison && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpiCards.map((card) => {
              const isGood = card.invert ? card.delta < 0 : card.delta > 0;
              const isNeutral = card.delta === 0;
              return (
                <Panel key={card.label} className="p-4">
                  <p className="text-[12px] font-medium text-ink-muted mb-2">{card.label}</p>
                  <p className="text-xl font-semibold text-ink tabular-nums leading-none mb-1">{card.a}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <DeltaBadge value={card.delta} invert={card.invert} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ink-muted">
                    <span>vs</span>
                    <span className="tabular-nums font-medium text-ink-secondary">{card.b}</span>
                    {!isNeutral && (
                      <span className={cn("ml-auto", isGood ? "text-emerald-600" : "text-red-500")}>
                        {isGood ? <BiTrendingUp className="w-3.5 h-3.5" /> : <BiTrendingDown className="w-3.5 h-3.5" />}
                      </span>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>

          <Panel>
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-ink">Trend overlay</h3>
              <div className="flex gap-1">
                {(["spend", "conversions"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMetric(m)}
                    className={cn("px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      chartMetric === m ? "bg-primary/10 text-primary" : "text-ink-muted hover:text-ink hover:bg-canvas-soft"
                    )}
                  >
                    {m === "spend" ? "Spend" : "Conversions"}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="px-2 pb-3"
              role="img"
              aria-label={`${chartMetric} trend overlay comparing Period A and Period B`}
            >
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient id="period-a-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0075de" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="#0075de" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="none" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => chartMetric === "spend" ? formatCurrency(v) : formatNum(v)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "white", border: "1px solid #e6e6e6", borderRadius: "10px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "10px 14px" }}
                    formatter={(value) => (chartMetric === "spend" ? formatCurrency(Number(value)) : formatNum(Number(value)))}
                  />
                  <Area type="monotone" dataKey="periodA" stroke="#0075de" strokeWidth={2} fill="url(#period-a-grad)" dot={false} activeDot={{ r: 4, fill: "#0075de", stroke: "white", strokeWidth: 2 }} name="Period A" connectNulls />
                  <Line type="monotone" dataKey="periodB" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4, fill: "#16a34a", stroke: "white", strokeWidth: 2 }} name="Period B" connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 pb-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-[#0075de] rounded" />
                <span className="text-ink-muted">Period A</span>
                <span className="text-[11px] text-ink-muted">({format(parseISO(periodA.start), "MMM d")} – {format(parseISO(periodA.end), "MMM d")})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-[#16a34a]" />
                <span className="text-ink-muted">Period B</span>
                <span className="text-[11px] text-ink-muted">({format(parseISO(periodB.start), "MMM d")} – {format(parseISO(periodB.end), "MMM d")})</span>
              </div>
            </div>
          </Panel>

          <AskAIPeriodButton comparison={comparison} periodA={periodA} periodB={periodB} />
        </>
      )}
    </div>
  );
}

function AskAIPeriodButton({ comparison, periodA, periodB }: {
  comparison: ComparisonResult;
  periodA: { start: string; end: string };
  periodB: { start: string; end: string };
}) {
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  function handleClick() {
    const cur = comparison.current;
    const prev = comparison.previous;
    const metrics: Record<string, { a: number; b: number; delta: number }> = {
      totalSpend: { a: cur.totalSpend, b: prev.totalSpend, delta: comparison.deltas.totalSpend?.percentage ?? 0 },
      totalConversions: { a: cur.totalConversions, b: prev.totalConversions, delta: comparison.deltas.totalConversions?.percentage ?? 0 },
      avgCpa: { a: cur.avgCpa, b: prev.avgCpa, delta: comparison.deltas.avgCpa?.percentage ?? 0 },
      avgCtr: { a: cur.avgCtr, b: prev.avgCtr, delta: comparison.deltas.avgCtr?.percentage ?? 0 },
      avgCpc: { a: cur.avgCpc, b: prev.avgCpc, delta: comparison.deltas.avgCpc?.percentage ?? 0 },
      totalImpressions: { a: cur.totalImpressions, b: prev.totalImpressions, delta: comparison.deltas.totalImpressions?.percentage ?? 0 },
      totalClicks: { a: cur.totalClicks, b: prev.totalClicks, delta: comparison.deltas.totalClicks?.percentage ?? 0 },
      avgCpm: { a: cur.avgCpm, b: prev.avgCpm, delta: comparison.deltas.avgCpm?.percentage ?? 0 },
    };

    setReferenceContext({
      comparisonType: "periods",
      comparisonPeriods: {
        periodA: { ...periodA, label: `${format(parseISO(periodA.start), "MMM d")} – ${format(parseISO(periodA.end), "MMM d")}` },
        periodB: { ...periodB, label: `${format(parseISO(periodB.start), "MMM d")} – ${format(parseISO(periodB.end), "MMM d")}` },
        metrics,
      },
    });
  }

  return (
    <div className="flex justify-end">
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <BiMessageRounded className="w-3.5 h-3.5" />
        Ask AI about this comparison
      </button>
    </div>
  );
}

export function ComparisonView() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const [tab, setTab] = useState<"campaigns" | "periods">("campaigns");

  if (!clientId) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[300px] w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.5px] text-ink">Compare</h1>
        <p className="text-[13px] text-ink-muted mt-0.5">Side-by-side campaign and period comparison</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "campaigns" | "periods")}>
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="periods">Periods</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns">
          <CampaignComparisonTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="periods">
          <PeriodComparisonTab clientId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
