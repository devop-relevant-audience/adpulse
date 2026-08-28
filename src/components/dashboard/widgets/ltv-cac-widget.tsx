"use client";

import { BiError } from "react-icons/bi";
import { useCohortAnalysis } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useSelectedClient } from "@/hooks/use-selected-client";
import { DemoOnlyWidgetPlaceholder } from "@/components/dashboard/demo-only";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { useCurrencyFormat } from "@/hooks/use-currency-format";
import { PLATFORM_LABELS_SHORT as PLATFORM_LABELS } from "@/lib/dashboard/chart-theme";
import type { Platform } from "@/lib/types/database";

// Neutral chart series ramp (blue, teal, violet) — distinguishable and on-brand.
const PLATFORM_COLORS: Record<Platform, string> = {
  google: "var(--chart-1)",
  meta: "var(--chart-2)",
  tiktok: "var(--chart-3)",
};

export function LtvCacWidget() {
  const { formatCurrency } = useCurrencyFormat();
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  // LTV:CAC comes from customer_cohorts, which is fabricated demo data — not
  // available for live (non-demo) clients yet.
  const isNonDemo = useSelectedClient()?.is_demo === false;

  const { data, isLoading, isError, refetch } = useCohortAnalysis({
    clientId: isNonDemo ? null : clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (isNonDemo) return <DemoOnlyWidgetPlaceholder label="LTV : CAC is demo-only for now" />;
  if (!clientId || isLoading) return <Skeleton className="h-full w-full" />;
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (!data || data.cohorts.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  const byLtvCac = [...data.cohorts].sort((a, b) => b.ltvCacRatio - a.ltvCacRatio);
  const byDay0Roas = [...data.cohorts].sort((a, b) => b.day0Roas - a.day0Roas);
  const maxRatio = Math.max(...byLtvCac.map((c) => c.ltvCacRatio), 1);
  const leadersDiffer = byLtvCac[0]?.platform !== byDay0Roas[0]?.platform;

  return (
    <div className="h-full w-full flex flex-col justify-center gap-2 px-1">
      {byLtvCac.map((c) => (
        <div key={c.platform}>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="flex items-center gap-1.5 text-ink font-medium">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PLATFORM_COLORS[c.platform] }} />
              {PLATFORM_LABELS[c.platform]}
            </span>
            <span className="flex items-center gap-2 text-ink-muted tabular-nums">
              <span>CAC {formatCurrency(c.cac)}</span>
              <span>Day-0 {c.day0Roas.toFixed(2)}x</span>
              <span
                className={cn(
                  "font-semibold",
                  c.ltvCacRatio >= 3 ? "text-emerald-600" : c.ltvCacRatio >= 2 ? "text-amber-600" : "text-red-500"
                )}
              >
                {c.ltvCacRatio.toFixed(2)}x
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-canvas-soft overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(c.ltvCacRatio / maxRatio) * 100}%`, background: PLATFORM_COLORS[c.platform] }}
            />
          </div>
        </div>
      ))}
      {leadersDiffer && (
        <p className="flex items-start gap-1 text-[11px] text-amber-600 mt-1 leading-snug">
          <BiError className="w-3 h-3 shrink-0 mt-px" />
          {PLATFORM_LABELS[byDay0Roas[0].platform]} leads Day-0 ROAS, but {PLATFORM_LABELS[byLtvCac[0].platform]} wins LTV:CAC.
        </p>
      )}
    </div>
  );
}
