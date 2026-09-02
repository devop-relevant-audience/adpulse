// The named date ranges offered by the page's date picker and by the report
// builder's dialog. Pure data (no React), so a dialog can offer the same ranges
// without importing the picker component.

import {
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
  subYears,
} from "date-fns";

export interface DateRangePreset {
  label: string;
  id: string;
  getRange: (today: Date) => { start: string; end: string };
}

const iso = (date: Date) => format(date, "yyyy-MM-dd");

/**
 * Rolling "Last N days" — ends YESTERDAY and spans exactly N days, so a chart
 * never ends on today's partial data. Matches Google Ads and GA4.
 */
const lastDays = (label: string, id: string, days: number): DateRangePreset => ({
  label,
  id,
  getRange: (today) => ({ start: iso(subDays(today, days)), end: iso(subDays(today, 1)) }),
});

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  {
    label: "Today",
    id: "today",
    getRange: (today) => ({ start: iso(today), end: iso(today) }),
  },
  {
    label: "Yesterday",
    id: "yesterday",
    getRange: (today) => {
      const yesterday = subDays(today, 1);
      return { start: iso(yesterday), end: iso(yesterday) };
    },
  },
  {
    label: "This week",
    id: "this-week",
    getRange: (today) => ({ start: iso(startOfWeek(today)), end: iso(today) }),
  },
  {
    label: "Last week",
    id: "last-week",
    getRange: (today) => {
      const lastWeek = subWeeks(today, 1);
      return { start: iso(startOfWeek(lastWeek)), end: iso(endOfWeek(lastWeek)) };
    },
  },
  lastDays("Last 7 days", "last-7", 7),
  lastDays("Last 14 days", "last-14", 14),
  lastDays("Last 28 days", "last-28", 28),
  lastDays("Last 30 days", "last-30", 30),
  {
    label: "Month to date",
    id: "mtd",
    getRange: (today) => ({ start: iso(startOfMonth(today)), end: iso(today) }),
  },
  {
    label: "Last month",
    id: "last-month",
    getRange: (today) => {
      const lastMonth = subMonths(today, 1);
      return { start: iso(startOfMonth(lastMonth)), end: iso(endOfMonth(lastMonth)) };
    },
  },
  lastDays("Last 60 days", "last-60", 60),
  lastDays("Last 90 days", "last-90", 90),
  {
    label: "This quarter",
    id: "this-quarter",
    getRange: (today) => ({ start: iso(startOfQuarter(today)), end: iso(today) }),
  },
  {
    label: "Last quarter",
    id: "last-quarter",
    getRange: (today) => {
      const lastQuarter = subQuarters(today, 1);
      return { start: iso(startOfQuarter(lastQuarter)), end: iso(endOfQuarter(lastQuarter)) };
    },
  },
  {
    label: "Last 6 months",
    id: "last-6m",
    getRange: (today) => ({ start: iso(subMonths(today, 6)), end: iso(subDays(today, 1)) }),
  },
  {
    label: "Year to date",
    id: "ytd",
    getRange: (today) => ({ start: iso(startOfYear(today)), end: iso(today) }),
  },
];

/**
 * The equally long window ending the day before `range` starts. This is what
 * `getCompareRange(range, "previous_period")` returns, exposed on its own for
 * the callers that always mean the preceding period and never consult the
 * page's compare selector — chiefly report snapshots, which are built without
 * one.
 */
export function previousPeriodRange(range: { start: string; end: string }): {
  start: string;
  end: string;
} {
  const days = Math.round(
    (new Date(range.end).getTime() - new Date(range.start).getTime()) / (1000 * 60 * 60 * 24)
  );
  return {
    start: format(subDays(new Date(range.start), days + 1), "yyyy-MM-dd"),
    end: format(subDays(new Date(range.start), 1), "yyyy-MM-dd"),
  };
}

/** How the selected range is compared against an earlier one. */
export type CompareMode = "none" | "previous_period" | "previous_year";

export const COMPARE_MODES: CompareMode[] = ["none", "previous_period", "previous_year"];

export const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  none: "No comparison",
  previous_period: "Previous period",
  previous_year: "Previous year",
};

export function isCompareMode(value: string | null | undefined): value is CompareMode {
  return !!value && (COMPARE_MODES as string[]).includes(value);
}

/**
 * The earlier window a range is compared against. `previous_period` is the
 * immediately preceding window of the same length; `previous_year` is the same
 * dates one year earlier. Returns null when comparison is off or the range is
 * unparseable. Pure — both inputs and output are `yyyy-MM-dd` strings.
 */
export function getCompareRange(
  range: { start: string; end: string },
  mode: CompareMode
): { start: string; end: string } | null {
  if (mode === "none") return null;

  const start = parseISO(range.start);
  const end = parseISO(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  if (mode === "previous_year") {
    return { start: iso(subYears(start, 1)), end: iso(subYears(end, 1)) };
  }

  const days = differenceInCalendarDays(end, start) + 1;
  if (days < 1) return null;
  const prevEnd = subDays(start, 1);
  return { start: iso(subDays(prevEnd, days - 1)), end: iso(prevEnd) };
}
