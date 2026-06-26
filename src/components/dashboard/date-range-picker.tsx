"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfQuarter, subQuarters, endOfQuarter } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, X } from "lucide-react";

const PRESETS = [
  { label: "Last 7 days", id: "last-7", getRange: (today: Date) => ({ start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Last 14 days", id: "last-14", getRange: (today: Date) => ({ start: format(subDays(today, 14), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Last 30 days", id: "last-30", getRange: (today: Date) => ({ start: format(subDays(today, 30), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Last 90 days", id: "last-90", getRange: (today: Date) => ({ start: format(subDays(today, 90), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Month to date", id: "mtd", getRange: (today: Date) => ({ start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Last month", id: "last-month", getRange: (today: Date) => {
      const lastMonth = subMonths(today, 1);
      return { start: format(startOfMonth(lastMonth), "yyyy-MM-dd"), end: format(endOfMonth(lastMonth), "yyyy-MM-dd") };
    }
  },
  { label: "This quarter", id: "this-quarter", getRange: (today: Date) => ({ start: format(startOfQuarter(today), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
  { label: "Last quarter", id: "last-quarter", getRange: (today: Date) => {
      const lq = subQuarters(today, 1);
      return { start: format(startOfQuarter(lq), "yyyy-MM-dd"), end: format(endOfQuarter(lq), "yyyy-MM-dd") };
    }
  },
  { label: "Last 6 months", id: "last-6m", getRange: (today: Date) => ({ start: format(subMonths(today, 6), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") }) },
];

export function DateRangePicker() {
  const dateRange = useAppStore((s) => s.dateRange);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(dateRange.start);
  const [customEnd, setCustomEnd] = useState(dateRange.end);

  const today = new Date();

  function handlePresetChange(id: string) {
    if (id === "custom") {
      setCustomStart(dateRange.start);
      setCustomEnd(dateRange.end);
      setShowCustom(true);
      return;
    }
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      setDateRange(preset.getRange(today));
      setShowCustom(false);
    }
  }

  function handleApplyCustom() {
    if (customStart && customEnd && customStart <= customEnd) {
      setDateRange({ start: customStart, end: customEnd });
      setShowCustom(false);
    }
  }

  const activePreset = PRESETS.find(p => {
    const range = p.getRange(today);
    return range.start === dateRange.start && range.end === dateRange.end;
  });

  const displayLabel = activePreset
    ? activePreset.label
    : `${format(new Date(dateRange.start), "MMM d")} — ${format(new Date(dateRange.end), "MMM d, yyyy")}`;

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <Select
          value={activePreset?.id || "custom"}
          onValueChange={(value) => { if (value) handlePresetChange(value); }}
        >
          <SelectTrigger className="h-8 w-auto min-w-[140px] max-w-[240px] bg-white border-hairline rounded-lg text-[13px] gap-1.5 px-3">
            <Calendar className="w-3.5 h-3.5 text-ink-muted shrink-0" />
            <span className="truncate">{displayLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id} className="text-[13px]">
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value="custom" className="text-[13px]">
              Custom range...
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showCustom && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-hairline rounded-xl shadow-(--shadow-elevated) p-4 z-50 w-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[13px] font-semibold text-ink">Custom Date Range</h4>
            <button onClick={() => setShowCustom(false)} className="text-ink-muted hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1">Start</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full h-8 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-muted uppercase tracking-wider block mb-1">End</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                max={format(today, "yyyy-MM-dd")}
                className="w-full h-8 px-2.5 text-[13px] border border-hairline rounded-lg bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleApplyCustom}
            disabled={!customStart || !customEnd || customStart > customEnd}
            className="w-full h-8 bg-primary text-white text-[13px] font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Apply Range
          </button>
        </div>
      )}
    </div>
  );
}
