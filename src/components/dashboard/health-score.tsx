"use client";

import { useHealthScore } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Lightbulb, TrendingUp, TrendingDown, DollarSign, MousePointerClick, Eye, Target, Calendar, Zap } from "lucide-react";
import type { HealthScoreResult } from "@/lib/data/health-score";

const GRADE_CONFIG = {
  A: { color: "#16a34a", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Excellent" },
  B: { color: "#2563eb", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", label: "Good" },
  C: { color: "#f59e0b", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "Fair" },
  D: { color: "#f97316", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", label: "Poor" },
  F: { color: "#ef4444", bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "Critical" },
} as const;

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#f97316";
  return "#ef4444";
}

function getScoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-50";
  if (score >= 60) return "bg-blue-50";
  if (score >= 40) return "bg-amber-50";
  if (score >= 20) return "bg-orange-50";
  return "bg-red-50";
}

function GaugeChart({ score, grade }: { score: number; grade: HealthScoreResult["grade"] }) {
  const circumference = 2 * Math.PI * 70;
  const halfCircumference = circumference / 2;
  const progress = (score / 100) * halfCircumference;
  const color = getScoreColor(score);
  const gradeConfig = GRADE_CONFIG[grade];

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-56 h-28">
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke="#f0f0f0"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${halfCircumference}`}
          className="transition-all duration-1000 ease-out"
        />
        <text x="100" y="82" textAnchor="middle" className="text-3xl font-bold" fill="#1a1a1a">
          {score}
        </text>
        <text x="100" y="102" textAnchor="middle" className="text-xs" fill="#a39e98">
          out of 100
        </text>
      </svg>
      <div className={cn("inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-sm font-semibold -mt-1", gradeConfig.bg, gradeConfig.border, gradeConfig.text)}>
        Grade {grade} — {gradeConfig.label}
      </div>
    </div>
  );
}

function SubScoreCard({ name, score, weight, description }: {
  name: string;
  score: number;
  weight: number;
  description: string;
}) {
  const color = getScoreColor(score);
  const bgColor = getScoreBg(score);

  return (
    <div className={cn("rounded-xl border p-4 transition-all hover:shadow-sm", bgColor, "border-transparent")}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-semibold text-ink">{name}</h4>
          <span className="text-[10px] text-ink-faint font-medium">{(weight * 100).toFixed(0)}% weight</span>
        </div>
        <div
          className="flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {score.toFixed(0)}
        </div>
      </div>
      <div className="relative h-1.5 bg-white/60 rounded-full overflow-hidden mt-2 mb-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed">{description}</p>
    </div>
  );
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function HealthScore() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);

  const { data: healthData, isLoading } = useHealthScore({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
  });

  if (!clientId || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!healthData) return null;

  const gradeConfig = GRADE_CONFIG[healthData.grade];
  const { summary } = healthData;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Account Health Score</h2>
        <p className="text-sm text-ink-muted mt-0.5">Composite performance score across 5 key dimensions, weighted by impact.</p>
      </div>

      {/* Top row: Gauge + Key metrics + Insight */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gauge */}
        <div className="bg-white rounded-xl border border-hairline p-6 flex flex-col items-center justify-center">
          <GaugeChart score={healthData.overallScore} grade={healthData.grade} />
          <div className={cn("mt-4 rounded-xl border p-3.5 w-full", gradeConfig.bg, gradeConfig.border)}>
            <div className="flex items-start gap-2.5">
              <Lightbulb className={cn("w-4 h-4 shrink-0 mt-0.5", gradeConfig.text)} />
              <p className={cn("text-[12px] leading-relaxed", gradeConfig.text)}>{healthData.insight}</p>
            </div>
          </div>
        </div>

        {/* Key Performance Indicators */}
        <div className="bg-white rounded-xl border border-hairline p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">Key Metrics</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              <DollarSign className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-ink-muted">Total Spend</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{formatCurrency(summary.totalSpend)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              <Target className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-ink-muted">Conversions</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{formatNumber(summary.totalConversions)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              <MousePointerClick className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-ink-muted">Avg. CPA</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{formatCurrency(summary.avgCpa)}</p>
                <p className="text-[10px] text-ink-faint">Recent: {formatCurrency(summary.recentCpa)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              <Eye className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-ink-muted">Avg. CTR</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{summary.avgCtr.toFixed(2)}%</p>
                <p className="text-[10px] text-ink-faint">Recent: {summary.recentCtr.toFixed(2)}%</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              <Calendar className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-ink-muted">Active Days</p>
                <p className="text-[15px] font-semibold text-ink tabular-nums">{summary.activeDays}/{summary.totalDays}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
              {summary.weekOverWeekGrowth >= 0
                ? <TrendingUp className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                : <TrendingDown className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              }
              <div>
                <p className="text-[11px] text-ink-muted">Period Growth</p>
                <p className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  summary.weekOverWeekGrowth >= 0 ? "text-emerald-600" : "text-red-500"
                )}>
                  {summary.weekOverWeekGrowth >= 0 ? "+" : ""}{summary.weekOverWeekGrowth.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        <div className="bg-white rounded-xl border border-hairline p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">Recommendations</h3>
          <div className="space-y-2.5">
            {healthData.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-canvas-soft/50">
                <Zap className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[12px] text-ink leading-relaxed">{rec}</p>
              </div>
            ))}
          </div>
          {summary.topPlatform && (
            <div className="mt-4 pt-3 border-t border-hairline">
              <p className="text-[11px] text-ink-muted mb-1">Top Performing Platform</p>
              <p className="text-[13px] font-semibold text-ink capitalize">
                {summary.topPlatform.platform} — {formatNumber(summary.topPlatform.conversions)} conversions
              </p>
            </div>
          )}
          {summary.bestDay.date && (
            <div className="mt-3 pt-3 border-t border-hairline">
              <p className="text-[11px] text-ink-muted mb-1">Best Performing Day</p>
              <p className="text-[13px] font-semibold text-ink">
                {summary.bestDay.date} — {formatNumber(summary.bestDay.conversions)} conversions
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Score Breakdown Grid */}
      <div className="bg-white rounded-xl border border-hairline p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">Score Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {healthData.subScores.map((sub) => (
            <SubScoreCard
              key={sub.name}
              name={sub.name}
              score={sub.score}
              weight={sub.weight}
              description={sub.description}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
