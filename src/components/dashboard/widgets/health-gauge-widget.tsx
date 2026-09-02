"use client";

import { useHealthScore } from "@/hooks/use-metrics";
import { useWidgetScope } from "@/hooks/use-widget-scope";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { cn } from "@/lib/utils";
import { BiSolidMagicWand } from "react-icons/bi";
import type { HealthScoreResult } from "@/lib/data/health-score";
import type { WidgetRenderProps } from "@/lib/dashboard/types";

const GRADE_CONFIG = {
  A: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Excellent" },
  B: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", label: "Good" },
  C: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "Fair" },
  D: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", label: "Poor" },
  F: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "Critical" },
} as const;

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#f97316";
  return "#ef4444";
}

function MiniGauge({ score, grade }: { score: number; grade: HealthScoreResult["grade"] }) {
  const circumference = 2 * Math.PI * 70;
  const halfCircumference = circumference / 2;
  const progress = (score / 100) * halfCircumference;
  const color = getScoreColor(score);
  const gradeConfig = GRADE_CONFIG[grade];

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-32 h-16">
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke="#f0f0f0"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${halfCircumference}`}
          className="transition-all duration-300 ease-out"
        />
        <text x="100" y="82" textAnchor="middle" className="text-3xl font-bold" fill="#1a1a1a">
          {score}
        </text>
      </svg>
      <div
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold -mt-1",
          gradeConfig.bg,
          gradeConfig.border,
          gradeConfig.text
        )}
      >
        Grade {grade} — {gradeConfig.label}
      </div>
    </div>
  );
}

/** Pure render half — also used by the frozen view-report renderer. */
export function HealthGaugeReadout({ health }: { health: HealthScoreResult }) {
  const topRecommendations = health.recommendations.slice(0, 2);

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 overflow-auto py-1">
      <MiniGauge score={health.overallScore} grade={health.grade} />
      {topRecommendations.length > 0 && (
        <div className="w-full space-y-1 px-1">
          {topRecommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-1.5 text-left">
              <BiSolidMagicWand className="w-3 h-3 text-primary mt-0.5 shrink-0" />
              <p className="text-[11px] text-ink-muted leading-snug line-clamp-2">{rec}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HealthGaugeWidget({ config }: WidgetRenderProps) {
  const { clientId, dateRange, platforms, campaignIds } = useWidgetScope(config);

  const { data: healthData, isLoading, isError, refetch } = useHealthScore({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platforms,
    campaignIds,
  });

  if (!clientId || isLoading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2">
        <Skeleton className="h-16 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  if (isError) return <QueryError compact onRetry={() => refetch()} />;
  if (!healthData) return <div className="h-full grid place-items-center text-xs text-ink-muted">No data</div>;

  return <HealthGaugeReadout health={healthData} />;
}
