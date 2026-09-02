"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { BiChevronDown, BiFilterAlt, BiX } from "react-icons/bi";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "@/store/app-store";
import { useSetUrlFilters } from "@/hooks/use-url-filters";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import {
  COMPARE_MODES,
  COMPARE_MODE_LABELS,
  DATE_RANGE_PRESETS,
  getCompareRange,
  type CompareMode,
} from "@/lib/dashboard/date-presets";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/types/database";

const iso = (date: Date) => format(date, "yyyy-MM-dd");

const PLATFORM_OPTIONS: Array<{ value: Platform | "all"; label: string }> = [
  { value: "all", label: "All platforms" },
  { value: "google", label: "Google" },
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
];

const SHORT_COMPARE_LABELS: Record<CompareMode, string> = {
  none: "",
  previous_period: "vs prev period",
  previous_year: "vs prev year",
};

/** The one control that owns every page-level filter: date range, comparison
 * and platform. They all write the same `?start&end&platform&compare` query
 * string, so keeping them in three separate widgets only spread one decision
 * across the header. Everything applies immediately — a custom range the moment
 * both ends are picked — so the menu needs no Apply step. */
export function PageFilters() {
  const dateRange = useAppStore((s) => s.dateRange);
  const compareMode = useAppStore((s) => s.compareMode);
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);
  // Writes to the URL; the [clientId] layout mirrors it back into the store,
  // so everything below keeps reading from the store.
  const { setDateRange, setCompareMode, setPlatform } = useSetUrlFilters();

  const [open, setOpen] = useState(false);
  // Only holds a half-finished calendar selection (a start with no end yet).
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>();

  const today = new Date();
  const activePreset = DATE_RANGE_PRESETS.find((p) => {
    const range = p.getRange(today);
    return range.start === dateRange.start && range.end === dateRange.end;
  });
  const dateLabel = activePreset
    ? activePreset.label
    : `${format(parseISO(dateRange.start), "MMM d")} — ${format(parseISO(dateRange.end), "MMM d, yyyy")}`;

  const platform = selectedPlatform ?? "all";
  const platformLabel = PLATFORM_OPTIONS.find((o) => o.value === platform)?.label ?? "All platforms";
  const compareRange = getCompareRange(dateRange, compareMode);
  // "Reset" only means something when at least one filter is off its default
  // (last-30 days, all platforms, no comparison).
  const isDefault =
    activePreset?.id === "last-30" && !selectedPlatform && compareMode === "none";

  const calendarSelection: DateRange | undefined =
    pendingRange ?? { from: parseISO(dateRange.start), to: parseISO(dateRange.end) };

  function handleCalendarSelect(range: DateRange | undefined) {
    if (range?.from && range.to) {
      setPendingRange(undefined);
      setDateRange({ start: iso(range.from), end: iso(range.to) });
    } else {
      setPendingRange(range);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Drop a start-only selection so reopening shows the range in effect.
    if (!next) setPendingRange(undefined);
  }

  function resetAll() {
    const fallback = DATE_RANGE_PRESETS.find((p) => p.id === "last-30");
    if (fallback) setDateRange(fallback.getRange(today));
    setCompareMode("none");
    setPlatform(undefined);
    setPendingRange(undefined);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Filters"
            className="flex h-8 items-center gap-2 rounded-lg border border-hairline bg-white pl-2.5 pr-2 text-[13px] text-ink transition-colors outline-none hover:border-ink-faint focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ink-faint"
          >
            <BiFilterAlt className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="truncate font-medium">{dateLabel}</span>
            <span className="h-3.5 w-px shrink-0 bg-hairline" />
            <span className="flex items-center gap-1.5 truncate text-ink-secondary">
              {platform !== "all" && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                />
              )}
              {platformLabel}
            </span>
            {compareMode !== "none" && (
              <span className="shrink-0 rounded-full bg-primary/8 px-1.5 py-px text-[11px] font-medium text-primary">
                {SHORT_COMPARE_LABELS[compareMode]}
              </span>
            )}
            <BiChevronDown className="h-4 w-4 shrink-0 text-ink-muted" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-[min(94vw,42rem)] gap-0 p-0">
        <div className="grid grid-cols-1 sm:grid-cols-[11.5rem_minmax(0,1fr)]">
          <div className="max-h-[19rem] overflow-y-auto border-hairline p-2 sm:border-r">
            <FieldLabel className="px-1.5 pb-1">Date range</FieldLabel>
            <div className="flex flex-col">
              {DATE_RANGE_PRESETS.map((preset) => {
                const active = activePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setPendingRange(undefined);
                      setDateRange(preset.getRange(today));
                    }}
                    className={cn(
                      "rounded-md px-1.5 py-1 text-left text-[13px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? "bg-primary/8 font-medium text-primary"
                        : "text-ink-secondary hover:bg-canvas-soft hover:text-ink"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {!activePreset && (
                <span className="mt-1 rounded-md bg-primary/8 px-1.5 py-1 text-[13px] font-medium text-primary">
                  Custom range
                </span>
              )}
            </div>
          </div>

          <div className="grid place-items-center p-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={parseISO(dateRange.start)}
              selected={calendarSelection}
              onSelect={handleCalendarSelect}
              disabled={{ after: today }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-hairline p-3 sm:grid-cols-2">
          <div>
            <FieldLabel className="pb-1.5">Compare to</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {COMPARE_MODES.map((mode) => (
                <PillButton
                  key={mode}
                  active={compareMode === mode}
                  onClick={() => setCompareMode(mode)}
                >
                  {COMPARE_MODE_LABELS[mode]}
                </PillButton>
              ))}
            </div>
            {compareRange && (
              <p className="mt-1.5 text-[11px] text-ink-muted tabular-nums">
                vs {format(parseISO(compareRange.start), "MMM d")} —{" "}
                {format(parseISO(compareRange.end), "MMM d, yyyy")}
              </p>
            )}
          </div>

          <div>
            <FieldLabel className="pb-1.5">Platform</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {PLATFORM_OPTIONS.map((opt) => (
                <PillButton
                  key={opt.value}
                  active={platform === opt.value}
                  onClick={() => setPlatform(opt.value === "all" ? undefined : opt.value)}
                >
                  {opt.value === "all" ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
                  ) : (
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: PLATFORM_COLORS[opt.value] }}
                    />
                  )}
                  {opt.value === "all" ? "All" : opt.label}
                </PillButton>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-3 py-2">
          <span className="text-[11px] text-ink-muted tabular-nums">
            {dateRange.start} → {dateRange.end}
          </span>
          <button
            type="button"
            onClick={resetAll}
            disabled={isDefault}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition-colors outline-none hover:bg-canvas-soft hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
          >
            <BiX className="h-3.5 w-3.5" />
            Reset filters
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FieldLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint",
        className
      )}
    >
      {children}
    </p>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary/30 bg-primary/8 font-medium text-primary"
          : "border-hairline text-ink-muted hover:border-ink-faint hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
