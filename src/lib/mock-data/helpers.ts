import { format, addDays, differenceInDays } from "date-fns";

export function generateDateRange(start: Date, end: Date): string[] {
  const days = differenceInDays(end, start);
  return Array.from({ length: days + 1 }, (_, i) =>
    format(addDays(start, i), "yyyy-MM-dd")
  );
}

export function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

export function round(value: number, decimals: number = 2): number {
  return Number(value.toFixed(decimals));
}

export function weekdayMultiplier(dateStr: string): number {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6 ? randomBetween(0.6, 0.8) : randomBetween(0.95, 1.15);
}

export function trendMultiplier(
  index: number,
  total: number,
  direction: "up" | "down" | "stable"
): number {
  const progress = index / total;
  switch (direction) {
    case "up":
      return 1 + progress * 0.3;
    case "down":
      return 1 - progress * 0.25;
    case "stable":
      return 1 + (Math.random() - 0.5) * 0.1;
  }
}

/**
 * Monthly seasonality: simulate realistic monthly ad performance patterns.
 * January dip (post-holiday), March ramp, summer steady, Q4 surge.
 */
export function monthlySeasonality(dateStr: string): number {
  const month = new Date(dateStr).getMonth();
  const factors = [0.75, 0.82, 0.95, 1.0, 1.02, 0.95, 0.88, 0.90, 1.05, 1.10, 1.25, 1.40];
  return factors[month];
}

export interface AnomalyConfig {
  dayIndex: number;
  durationDays: number;
  type: "ctr_drop" | "cpm_spike" | "conversion_cliff" | "spend_surge" | "budget_cut" | "creative_fatigue" | "audience_saturation";
  cause: string;
  multiplier: number;
}

export function generateAnomalies(totalDays: number): AnomalyConfig[] {
  const anomalies: AnomalyConfig[] = [
    {
      dayIndex: 8,
      durationDays: 4,
      type: "ctr_drop",
      cause: "New creative variant launched with lower-performing copy",
      multiplier: 0.40,
    },
    {
      dayIndex: 22,
      durationDays: 3,
      type: "cpm_spike",
      cause: "Audience expansion into competitive segment increased auction costs",
      multiplier: 2.4,
    },
    {
      dayIndex: 38,
      durationDays: 5,
      type: "conversion_cliff",
      cause: "Landing page CTA button broken after site deployment on March 8",
      multiplier: 0.12,
    },
    {
      dayIndex: 55,
      durationDays: 7,
      type: "spend_surge",
      cause: "Budget doubled for spring sale promotion",
      multiplier: 2.0,
    },
    {
      dayIndex: 75,
      durationDays: 10,
      type: "creative_fatigue",
      cause: "Ad creative frequency exceeded 8x — audience saw same ads too often",
      multiplier: 0.55,
    },
    {
      dayIndex: 100,
      durationDays: 5,
      type: "budget_cut",
      cause: "Monthly budget cap reached early, spend throttled by platform",
      multiplier: 0.3,
    },
    {
      dayIndex: 120,
      durationDays: 8,
      type: "audience_saturation",
      cause: "Retargeting pool exhausted — shrinking audience with rising frequency",
      multiplier: 0.6,
    },
    {
      dayIndex: 145,
      durationDays: 4,
      type: "cpm_spike",
      cause: "Competitor launched aggressive campaign in same auction — CPMs surged 150%",
      multiplier: 2.5,
    },
    {
      dayIndex: 160,
      durationDays: 6,
      type: "spend_surge",
      cause: "End-of-quarter push — budget unlocked for final conversion sprint",
      multiplier: 1.8,
    },
  ];

  return anomalies.filter(a => a.dayIndex < totalDays);
}

export function isInAnomalyWindow(
  dayIndex: number,
  anomaly: AnomalyConfig
): boolean {
  return (
    dayIndex >= anomaly.dayIndex &&
    dayIndex < anomaly.dayIndex + anomaly.durationDays
  );
}
