"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDailyTrend, useAnnotations, useCreateAnnotation, useDeleteAnnotation } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Trash2, X } from "lucide-react";

const METRICS = [
  { key: "spend", label: "Spend", color: "#0075de", prefix: "$", yAxisId: "left" },
  { key: "conversions", label: "Conversions", color: "#16a34a", prefix: "", yAxisId: "right" },
  { key: "clicks", label: "Clicks", color: "#f59e0b", prefix: "", yAxisId: "right" },
  { key: "impressions", label: "Impressions", color: "#8b5cf6", prefix: "", yAxisId: "right" },
  { key: "ctr", label: "CTR", color: "#ef4444", prefix: "", suffix: "%", yAxisId: "right" },
  { key: "cpc", label: "CPC", color: "#06b6d4", prefix: "$", yAxisId: "right" },
  { key: "cpa", label: "CPA", color: "#ec4899", prefix: "$", yAxisId: "right" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

interface AnnotationPopoverState {
  date: string;
  x: number;
  y: number;
  containerWidth: number;
}

function AnnotationLabel({ viewBox, content, annotationId, onDelete }: {
  viewBox?: { x?: number; y?: number };
  content: string;
  annotationId: string;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const x = viewBox?.x ?? 0;

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ cursor: "pointer" }}
    >
      <circle cx={x} cy={8} r={8} fill="#7c3aed" stroke="white" strokeWidth={1.5} />
      <text x={x} y={11.5} textAnchor="middle" fontSize={10} fill="white" fontWeight={700} style={{ pointerEvents: "none" }}>
        A
      </text>
      {hovered && (
        <foreignObject x={x - 120} y={20} width={240} height={80}>
          <div
            className="bg-white rounded-lg border border-hairline shadow-lg px-3 py-2 text-xs text-ink"
            style={{ pointerEvents: "auto" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 leading-relaxed">{content}</p>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(annotationId); }}
                className="shrink-0 p-0.5 rounded text-ink-muted hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

export function TrendChart() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>(["spend", "conversions"]);

  const [annotationPopover, setAnnotationPopover] = useState<AnnotationPopoverState | null>(null);
  const [annotationText, setAnnotationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const { data: trend, isLoading } = useDailyTrend({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  const { data: annotations } = useAnnotations({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
  });

  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const handleDeleteAnnotation = useCallback((id: string) => {
    deleteAnnotation.mutate(id);
  }, [deleteAnnotation]);

  const handleChartClick = useCallback((nextState: unknown, event: unknown) => {
    // Recharts sometimes passes the event as the first argument if clicked outside the active area
    const state = (nextState as { activePayload?: unknown })?.activePayload ? nextState : event;
    const typedState = state as {
      activePayload?: Array<{ payload: Record<string, unknown> }>;
      activeLabel?: string;
      chartX?: number;
      chartY?: number;
    } | null;
    const typedNextState = nextState as {
      activeLabel?: string;
      chartX?: number;
      chartY?: number;
    } | null;
    
    let point = null;
    if (typedState?.activePayload?.[0]?.payload) {
      point = typedState.activePayload[0].payload;
    } else if (typedState?.activeLabel && trend) {
      point = trend.find((t) => t.date === typedState.activeLabel);
    } else if (typedNextState?.activeLabel && trend) {
      point = trend.find((t) => t.date === typedNextState.activeLabel);
    }

    if (!point) {
      // If we still don't have a point, we might have clicked outside the active area.
      return;
    }

    const date = point.date as string;

    setReferenceContext({
      metric: activeMetrics[0],
      dateRange: { start: date, end: date },
      platform,
      value: point[activeMetrics[0]] as number,
    });

    const container = chartContainerRef.current;
    const containerWidth = container?.offsetWidth ?? 600;
    
    // Fallback to native event coordinates if chartX/Y are missing
    const chartX = typedState?.chartX ?? typedNextState?.chartX ?? 0;
    const chartY = typedState?.chartY ?? typedNextState?.chartY ?? 0;
    
    const popoverX = chartX;
    const popoverY = container ? Math.min(chartY, container.getBoundingClientRect().height - 120) : chartY;

    setAnnotationPopover({ date, x: popoverX, y: popoverY, containerWidth });
    setAnnotationText("");
  }, [activeMetrics, platform, setReferenceContext, trend]);

  const handleSaveAnnotation = useCallback(() => {
    if (!annotationPopover || !annotationText.trim() || !clientId) return;
    createAnnotation.mutate({
      client_id: clientId,
      date: annotationPopover.date,
      content: annotationText.trim(),
    });
    setAnnotationPopover(null);
    setAnnotationText("");
  }, [annotationPopover, annotationText, clientId, createAnnotation]);

  useEffect(() => {
    if (annotationPopover && inputRef.current) {
      inputRef.current.focus();
    }
  }, [annotationPopover]);

  useEffect(() => {
    if (!annotationPopover) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-annotation-popover]")) return;
      setAnnotationPopover(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [annotationPopover]);

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== key);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), key];
      }
      return [...prev, key];
    });
  };

  if (!clientId) {
    return (
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-hairline p-5">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  const primaryMetric = METRICS.find((m) => m.key === activeMetrics[0])!;
  const annotationsByDate = new Map(
    (annotations ?? []).map((a) => [a.date, a])
  );

  const formatYValue = (value: number, metric: (typeof METRICS)[number]) => {
    const prefix = metric.prefix || "";
    const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
    if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M${suffix}`;
    if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(0)}K${suffix}`;
    return `${prefix}${value.toLocaleString()}${suffix}`;
  };

  return (
    <div className="bg-white rounded-xl border border-hairline">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-ink">Performance Over Time</h3>
        <div className="flex items-center gap-1 text-[11px] text-ink-muted">
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span>Click chart to annotate</span>
        </div>
      </div>

      {/* Metric Toggles */}
      <div className="flex items-center gap-1.5 px-5 pb-3 flex-wrap">
        {METRICS.map((metric) => {
          const isActive = activeMetrics.includes(metric.key);
          return (
            <button
              key={metric.key}
              onClick={() => toggleMetric(metric.key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all border",
                isActive
                  ? "border-transparent shadow-sm"
                  : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas-soft"
              )}
              style={isActive ? { backgroundColor: `${metric.color}10`, color: metric.color, borderColor: `${metric.color}30` } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: isActive ? metric.color : "#a39e98" }}
              />
              {metric.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="px-2 pb-4 relative" ref={chartContainerRef}>
        <ResponsiveContainer width="100%" height={300} style={{ outline: "none" }}>
          <ComposedChart
            data={trend}
            onClick={handleChartClick}
            className="cursor-crosshair focus:outline-none"
            style={{ outline: "none", userSelect: "none" }}
          >
            <defs>
              {activeMetrics.map((key) => {
                const metric = METRICS.find((m) => m.key === key)!;
                return (
                  <linearGradient key={`grad-${key}`} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={metric.color} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid stroke="#f0f0f0" strokeDasharray="none" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(parseISO(v), "MMM d")}
              tick={{ fontSize: 11, fill: "#a39e98" }}
              axisLine={false}
              tickLine={false}
              dy={8}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: "#a39e98" }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(v) => formatYValue(v, primaryMetric)}
            />
            {activeMetrics.length > 1 && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#a39e98" }}
                axisLine={false}
                tickLine={false}
                width={55}
                tickFormatter={(v) => {
                  const secondMetric = METRICS.find((m) => m.key === activeMetrics[1])!;
                  return formatYValue(v, secondMetric);
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e6e6e6",
                borderRadius: "10px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                padding: "10px 14px",
              }}
              labelFormatter={(v) => {
                const dateStr = format(parseISO(v as string), "EEE, MMM d, yyyy");
                const annotation = annotationsByDate.get(v as string);
                if (annotation) return `${dateStr}\n📌 ${annotation.content}`;
                return dateStr;
              }}
              formatter={(value, name) => {
                const metric = METRICS.find((m) => m.key === name);
                if (!metric) return [String(value), String(name)];
                const prefix = metric.prefix || "";
                const suffix = "suffix" in metric ? (metric as { suffix: string }).suffix : "";
                return [`${prefix}${Number(value).toLocaleString()}${suffix}`, metric.label];
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={0}
              wrapperStyle={{ display: "none" }}
            />

            {(annotations ?? []).map((annotation) => (
              <ReferenceLine
                key={annotation.id}
                x={annotation.date}
                yAxisId="left"
                stroke="#7c3aed"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                style={{ pointerEvents: "none" }}
                label={
                  <AnnotationLabel
                    content={annotation.content}
                    annotationId={annotation.id}
                    onDelete={handleDeleteAnnotation}
                  />
                }
              />
            ))}

            {activeMetrics.map((key, idx) => {
              const metric = METRICS.find((m) => m.key === key)!;
              const yAxisId = idx === 0 ? "left" : "right";

              if (idx === 0) {
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    yAxisId={yAxisId}
                    stroke={metric.color}
                    strokeWidth={2}
                    fill={`url(#grad-${key})`}
                    dot={false}
                    activeDot={{ r: 4, fill: metric.color, stroke: "white", strokeWidth: 2 }}
                    name={key}
                  />
                );
              }

              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  yAxisId={yAxisId}
                  stroke={metric.color}
                  strokeWidth={2}
                  strokeDasharray={idx > 1 ? "6 3" : undefined}
                  dot={false}
                  activeDot={{ r: 4, fill: metric.color, stroke: "white", strokeWidth: 2 }}
                  name={key}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Annotation input popover */}
        {annotationPopover && (
          <div
            data-annotation-popover
            className="absolute z-50 bg-white rounded-lg border border-hairline shadow-xl p-3 w-64"
            style={{
              left: `${Math.min(Math.max(annotationPopover.x, 20), annotationPopover.containerWidth - 280)}px`,
              top: `${Math.max(annotationPopover.y - 10, 10)}px`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-ink">
                {format(parseISO(annotationPopover.date), "MMM d, yyyy")}
              </span>
              <button
                onClick={() => setAnnotationPopover(null)}
                className="p-0.5 rounded text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveAnnotation(); if (e.key === "Escape") setAnnotationPopover(null); }}
              placeholder="Add annotation..."
              className="w-full text-sm border border-hairline rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
            <button
              onClick={handleSaveAnnotation}
              disabled={!annotationText.trim() || createAnnotation.isPending}
              className="mt-2 w-full text-xs font-medium bg-violet-600 text-white rounded-md py-1.5 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {createAnnotation.isPending ? "Saving..." : "Save Annotation"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
