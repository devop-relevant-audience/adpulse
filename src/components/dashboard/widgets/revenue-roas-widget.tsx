"use client";

import { BiTrendingUp, BiError } from "react-icons/bi";
import { useRevenueOverview } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { formatCurrency } from "@/lib/dashboard/metrics";

export function RevenueRoasWidget() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const { data, isLoading, isError, refetch } = useRevenueOverview({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <div className="h-full flex flex-col justify-center gap-2 px-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (!data) return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  return (
    <div className="h-full w-full flex flex-col justify-center px-1">
      <p className="text-[12px] font-medium text-ink-muted">Blended ROAS</p>
      <p className="text-2xl font-semibold tracking-tight text-ink leading-tight truncate mt-1">
        {data.blended.roas.toFixed(2)}x
      </p>
      <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-muted flex-wrap">
        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 font-semibold px-1.5 py-0.5 rounded">
          <BiTrendingUp className="w-3 h-3" />
          {formatCurrency(data.blended.revenue)}
        </span>
        <span className="truncate">AOV {formatCurrency(data.blended.aov)}</span>
      </div>
      <p className="flex items-center gap-1 text-[11px] text-amber-600 mt-2 truncate">
        <BiError className="w-3 h-3 shrink-0" />
        {data.overAttribution.inflationPct.toFixed(0)}% over-attributed by platforms
      </p>
    </div>
  );
}
