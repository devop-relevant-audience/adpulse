"use client";

import { useHealthScore } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Lightbulb } from "lucide-react";
import type { HealthScoreResult } from "@/lib/data/health-score";

const GRADE_CONFIG = {
  A: { color: "#16a34a", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
  B: { color: "#2563eb", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  C: { color: "#f59e0b", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  D: { color: "#f97316", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
  F: { color: "#ef4444", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
} as const;

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#2563eb";
  if (score >= 40) return "#f59e0b";
  if (score >= 20) return "#f97316";
  return "#ef4444";
}

function GaugeChart({ score, grade }: { score: number; grade: HealthScoreResult["grade"] }) {
  const circumference = 2 * Math.PI * 70;
  const halfCircumference = circumference / 2;
  const progress = (score / 100) * halfCircumference;
  const color = getScoreColor(score);
  const gradeConfig = GRADE_CONFIG[grade];

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-64 h-32">
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke="#f0f0f0"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 70 70 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${halfCircumference}`}
          className="transition-all duration-1000 ease-out"
        />
        <text x="100" y="85" textAnchor="middle" className="text-3xl font-bold" fill="#1a1a1a">
          {score}
        </text>
        <text x="100" y="105" textAnchor="middle" className="text-xs" fill="#a39e98">
          out of 100
        </text>
      </svg>
      <div className={cn("inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-sm font-semibold -mt-2", gradeConfig.bg, gradeConfig.border, gradeConfig.text)}>
        Grade {grade}
      </div>
    </div>
  );
}

function SubScoreBar({ name, score, weight, description }: {
  name: string;
  score: number;
  weight: number;
  description: string;
}) {
  const color = getScoreColor(score);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{name}</span>
          <span className="text-[10px] text-ink-faint">({(weight * 100).toFixed(0)}% weight)</span>
        </div>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>{score.toFixed(0)}/100</span>
      </div>
      <div className="relative h-2 bg-canvas-soft rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[11px] text-ink-faint">{description}</p>
    </div>
  );
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    );
  }

  if (!healthData) return null;

  const gradeConfig = GRADE_CONFIG[healthData.grade];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Account Health Score</h2>
        <p className="text-sm text-ink-muted mt-0.5">Composite performance score across 5 key dimensions, weighted by impact.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-hairline p-6 flex flex-col items-center justify-center">
          <GaugeChart score={healthData.overallScore} grade={healthData.grade} />

          <div className={cn("mt-4 rounded-xl border p-4 w-full", gradeConfig.bg, gradeConfig.border)}>
            <div className="flex items-start gap-3">
              <Lightbulb className={cn("w-4 h-4 shrink-0 mt-0.5", gradeConfig.text)} />
              <p className={cn("text-[12px]", gradeConfig.text)}>{healthData.insight}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-hairline p-6">
          <h3 className="text-sm font-semibold text-ink mb-5">Score Breakdown</h3>
          <div className="space-y-5">
            {healthData.subScores.map((sub) => (
              <SubScoreBar
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
    </div>
  );
}
