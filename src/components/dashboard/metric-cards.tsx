"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useComparison } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { format, subDays } from "date-fns";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  delta: number;
  previousValue: string;
  invertDeltaColor?: boolean;
  onAskAi?: () => void;
}

function MetricCard({ label, value, delta, previousValue, invertDeltaColor = false, onAskAi }: MetricCardProps) {
  const isPositive = delta > 0;
  const isNeutral = delta === 0;

  let isGood = isNeutral;
  if (!isNeutral) {
    isGood = (isPositive && !invertDeltaColor) || (!isPositive && invertDeltaColor);
  }

  return (
    <button
      onClick={onAskAi}
      className="bg-white rounded-xl border border-hairline p-4 text-left hover:border-primary/30 hover:shadow-sm transition-all group cursor-pointer"
    >
      <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2 mt-1.5">
        <p className="text-[22px] font-semibold tracking-tight text-ink leading-none">{value}</p>
        {!isNeutral && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-medium",
              isGood ? "text-emerald-600" : "text-red-500"
            )}
          >
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-faint mt-1">vs prev. {previousValue}</p>
    </button>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function MetricCards() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  const daysDiff = Math.round(
    (new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const previousEnd = format(subDays(new Date(dateRange.start), 1), "yyyy-MM-dd");
  const previousStart = format(subDays(new Date(dateRange.start), daysDiff + 1), "yyyy-MM-dd");

  const { data: comparison, isLoading } = useComparison({
    clientId,
    currentStart: dateRange.start,
    currentEnd: dateRange.end,
    previousStart,
    previousEnd,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-hairline p-4 space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (!comparison) return null;

  const cards = [
    {
      label: "Spend",
      value: formatCurrency(comparison.current.totalSpend),
      previousValue: formatCurrency(comparison.previous.totalSpend),
      delta: comparison.deltas.totalSpend.percentage,
      metric: "spend",
    },
    {
      label: "Conversions",
      value: formatNumber(comparison.current.totalConversions),
      previousValue: formatNumber(comparison.previous.totalConversions),
      delta: comparison.deltas.totalConversions.percentage,
      metric: "conversions",
    },
    {
      label: "CPA",
      value: formatCurrency(comparison.current.avgCpa),
      previousValue: formatCurrency(comparison.previous.avgCpa),
      delta: comparison.deltas.avgCpa.percentage,
      metric: "cpa",
      invertDeltaColor: true,
    },
    {
      label: "CTR",
      value: `${comparison.current.avgCtr.toFixed(2)}%`,
      previousValue: `${comparison.previous.avgCtr.toFixed(2)}%`,
      delta: comparison.deltas.avgCtr.percentage,
      metric: "ctr",
    },
    {
      label: "CPC",
      value: formatCurrency(comparison.current.avgCpc),
      previousValue: formatCurrency(comparison.previous.avgCpc),
      delta: comparison.deltas.avgCpc.percentage,
      metric: "cpc",
      invertDeltaColor: true,
    },
    {
      label: "Clicks",
      value: formatNumber(comparison.current.totalClicks),
      previousValue: formatNumber(comparison.previous.totalClicks),
      delta: comparison.deltas.totalClicks.percentage,
      metric: "clicks",
    },
    {
      label: "Impressions",
      value: formatNumber(comparison.current.totalImpressions),
      previousValue: formatNumber(comparison.previous.totalImpressions),
      delta: comparison.deltas.totalImpressions.percentage,
      metric: "impressions",
    },
    {
      label: "CPM",
      value: formatCurrency(comparison.current.avgCpm),
      previousValue: formatCurrency(comparison.previous.avgCpm),
      delta: comparison.deltas.avgCpm.percentage,
      metric: "cpm",
      invertDeltaColor: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          previousValue={card.previousValue}
          delta={card.delta}
          invertDeltaColor={card.invertDeltaColor}
          onAskAi={() =>
            setReferenceContext({
              metric: card.metric,
              dateRange: dateRange,
              platform,
              value: card.delta,
            })
          }
        />
      ))}
    </div>
  );
}
