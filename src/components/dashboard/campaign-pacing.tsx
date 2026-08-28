"use client";

import { usePacing } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT, STATUS_COLORS } from "@/lib/dashboard/chart-theme";
import { useCurrencyFormat } from "@/hooks/use-currency-format";
import type { CampaignPacingItem } from "@/lib/data/queries";

const STATUS_CONFIG = {
  on_track: { label: "On track", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", barColor: STATUS_COLORS.good },
  underpacing: { label: "Underpacing", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", barColor: STATUS_COLORS.warning },
  overpacing: { label: "Overpacing", bg: "bg-red-50", border: "border-red-200", text: "text-red-700", barColor: STATUS_COLORS.bad },
} as const;

function PacingSummaryCards({ totalBudget, totalSpent, totalProjected, overallStatus }: {
  totalBudget: number;
  totalSpent: number;
  totalProjected: number;
  overallStatus: "on_track" | "underpacing" | "overpacing";
}) {
  const { formatCurrencyCompact: formatCurrency } = useCurrencyFormat();
  const statusConfig = STATUS_CONFIG[overallStatus];
  const utilizationPercent = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(1) : "0";

  const cards = [
    { label: "Total budget", value: formatCurrency(totalBudget) },
    { label: "Spent to date", value: formatCurrency(totalSpent) },
    { label: "Projected spend", value: formatCurrency(totalProjected) },
    { label: "Utilization", value: `${utilizationPercent}%` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {cards.map((card) => (
        <Panel key={card.label} className="p-4">
          <p className="text-[12px] font-medium text-ink-muted">{card.label}</p>
          <p className="text-xl font-semibold text-ink mt-1 tabular-nums">{card.value}</p>
        </Panel>
      ))}
      <div className={cn("rounded-xl border p-4", statusConfig.bg, statusConfig.border)}>
        <p className="text-[12px] font-medium text-ink-muted">Status</p>
        <p className={cn("text-xl font-semibold mt-1", statusConfig.text)}>{statusConfig.label}</p>
      </div>
    </div>
  );
}

function PacingBar({ item }: { item: CampaignPacingItem }) {
  const { formatCurrencyCompact: formatCurrency } = useCurrencyFormat();
  const statusConfig = STATUS_CONFIG[item.status];
  const spentPercent = Math.min(item.monthlyBudget > 0 ? (item.spentToDate / item.monthlyBudget) * 100 : 0, 100);

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-canvas-soft/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: PLATFORM_COLORS[item.platform] ?? "#6b6b6b" }}
            />
            <span className="text-[13px] font-medium text-ink truncate">{item.campaignName}</span>
            <span className="text-[11px] text-ink-muted">{PLATFORM_LABELS_SHORT[item.platform] ?? item.platform}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-ink-muted tabular-nums">
              {formatCurrency(item.spentToDate)} / {formatCurrency(item.monthlyBudget)}
            </span>
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", statusConfig.bg, statusConfig.border, statusConfig.text)}>
              {statusConfig.label}
            </span>
          </div>
        </div>
        <div className="relative h-2.5 bg-canvas-soft rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
            style={{
              width: `${Math.max(spentPercent, 1)}%`,
              backgroundColor: statusConfig.barColor,
            }}
          />
          <div
            className="absolute inset-y-0 border-r-2 border-ink/30"
            style={{ left: `${Math.min(item.pacingPercent, 100)}%` }}
            title={`Projected: ${item.pacingPercent}%`}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-ink-muted">
            Pacing: {item.pacingPercent}% | Projected: {formatCurrency(item.projectedSpend)}
          </span>
          {item.daysRemaining > 0 && (
            <span className="text-[11px] text-ink-muted">
              Need {formatCurrency(item.requiredDailySpend)}/day for {item.daysRemaining}d remaining
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CampaignPacing() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);

  const currentMonth = dateRange.start.substring(0, 7);

  const { data: pacingData, isLoading, isError, refetch } = usePacing({
    clientId,
    month: currentMonth,
  });

  if (!clientId || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Campaign pacing</h2>
          <p className="text-sm text-ink-muted mt-0.5">Budget utilization and spend forecasting for {format(new Date(currentMonth + "-01"), "MMMM yyyy")}.</p>
        </div>
        <QueryError onRetry={() => refetch()} message="Couldn't load pacing data" />
      </div>
    );
  }

  if (!pacingData || pacingData.campaigns.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Campaign pacing</h2>
          <p className="text-sm text-ink-muted mt-0.5">Budget utilization and spend forecasting for {format(new Date(currentMonth + "-01"), "MMMM yyyy")}.</p>
        </div>
        <Panel className="p-8 text-center">
          <p className="text-ink-muted text-sm">No budget data available. Re-seed your data to generate campaign budgets.</p>
        </Panel>
      </div>
    );
  }

  const overpacing = pacingData.campaigns.filter((c) => c.status === "overpacing");
  const underpacing = pacingData.campaigns.filter((c) => c.status === "underpacing");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Campaign Pacing</h2>
        <p className="text-sm text-ink-muted mt-0.5">Budget utilization and spend forecasting for {format(new Date(currentMonth + "-01"), "MMMM yyyy")}.</p>
      </div>

      <PacingSummaryCards
        totalBudget={pacingData.totalBudget}
        totalSpent={pacingData.totalSpent}
        totalProjected={pacingData.totalProjected}
        overallStatus={pacingData.overallStatus}
      />

      {(overpacing.length > 0 || underpacing.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {overpacing.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-[12px] font-medium text-red-700">
                {overpacing.length} campaign{overpacing.length > 1 ? "s" : ""} overpacing
              </p>
              <p className="text-[11px] text-red-600 mt-0.5">
                Will exhaust budget early: {overpacing.map((c) => c.campaignName).join(", ")}
              </p>
            </div>
          )}
          {underpacing.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-[12px] font-medium text-amber-700">
                {underpacing.length} campaign{underpacing.length > 1 ? "s" : ""} underpacing
              </p>
              <p className="text-[11px] text-amber-600 mt-0.5">
                May underspend: {underpacing.map((c) => c.campaignName).join(", ")}
              </p>
            </div>
          )}
        </div>
      )}

      <Panel className="overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline">
          <h3 className="text-sm font-semibold text-ink">Per-campaign pacing</h3>
        </div>
        <div className="divide-y divide-hairline/60">
          {pacingData.campaigns.map((item) => (
            <PacingBar key={item.campaignId} item={item} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
