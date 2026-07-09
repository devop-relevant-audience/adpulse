"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { useAttributionComparison } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT } from "@/lib/dashboard/chart-theme";
import type { WidgetRenderProps } from "@/lib/dashboard/types";
import type { Platform, AttributionModel } from "@/lib/types/database";

const PLATFORMS: Platform[] = ["google", "meta", "tiktok"];

const chartTooltipStyle = {
  backgroundColor: "white",
  border: "1px solid #e6e6e6",
  borderRadius: "10px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  padding: "8px 12px",
};

function readModel(config: Record<string, unknown>, key: string, fallback: AttributionModel): AttributionModel {
  const v = config[key];
  return typeof v === "string" ? (v as AttributionModel) : fallback;
}

export function AttributionMiniWidget({ config }: WidgetRenderProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);

  const modelA = readModel(config, "modelA", "first_touch");
  const modelB = readModel(config, "modelB", "last_touch");

  const { data, isLoading, isError, refetch } = useAttributionComparison({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const chartData = useMemo(() => {
    if (!data) return [];
    const a = data.models.find((m) => m.model === modelA);
    const b = data.models.find((m) => m.model === modelB);
    return PLATFORMS.map((p) => ({
      platform: PLATFORM_LABELS_SHORT[p],
      color: PLATFORM_COLORS[p],
      [a?.label ?? "Model A"]: Number((a?.credit.find((c) => c.platform === p)?.sharePct ?? 0).toFixed(1)),
      [b?.label ?? "Model B"]: Number((b?.credit.find((c) => c.platform === p)?.sharePct ?? 0).toFixed(1)),
    }));
  }, [data, modelA, modelB]);

  const labelA = data?.models.find((m) => m.model === modelA)?.label ?? "First Touch";
  const labelB = data?.models.find((m) => m.model === modelB)?.label ?? "Last Touch";

  if (!clientId || isLoading) return <Skeleton className="h-full w-full" />;
  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (!data || chartData.length === 0)
    return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center justify-between px-1 mb-1">
        <p className="text-[12px] font-medium text-ink-muted truncate">
          {labelA} vs {labelB}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-ink-muted shrink-0">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm opacity-40 bg-ink-faint" />{labelA}</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-ink-faint" />{labelB}</span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={2} barCategoryGap="24%" margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#f0f0f0" strokeDasharray="none" vertical={false} />
            <XAxis dataKey="platform" tick={{ fontSize: 10, fill: "#6b6b6b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#6b6b6b" }} axisLine={false} tickLine={false} width={28} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]} />
            <Bar dataKey={labelA} radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={`a-${i}`} fill={entry.color} fillOpacity={0.4} />
              ))}
            </Bar>
            <Bar dataKey={labelB} radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={`b-${i}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
