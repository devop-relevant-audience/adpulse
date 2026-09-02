// Contract for the "top movers" widget: what changed most between the selected
// period and the one immediately before it. Pure TypeScript, no React — shared
// by the widget, its config form, the snapshot builder and the frozen
// view-report renderer.
//
// `config.filters` is NOT owned here: like every other non-custom widget the
// shared filter form writes it and `useWidgetScope` reads it, and the dashboards
// PUT validates it with the loose schema.

import { QUERY_METRICS, QUERY_METRIC_META, QUERY_MAX_LIMIT } from "@/lib/dashboard/custom-widget";
import type { MetricQueryResult, MetricQueryRow, QueryMetric } from "@/lib/dashboard/custom-widget";
import type { Platform } from "@/lib/types/database";

export const TOP_MOVERS_GROUP_BYS = ["platform", "campaign"] as const;
export type TopMoversGroupBy = (typeof TOP_MOVERS_GROUP_BYS)[number];

export const TOP_MOVERS_DIRECTIONS = ["both", "up", "down"] as const;
export type TopMoversDirection = (typeof TOP_MOVERS_DIRECTIONS)[number];

export const TOP_MOVERS_DIRECTION_LABELS: Record<TopMoversDirection, string> = {
  both: "Both",
  up: "Risers",
  down: "Fallers",
};

export const TOP_MOVERS_GROUP_BY_LABELS: Record<TopMoversGroupBy, string> = {
  platform: "Platform",
  campaign: "Campaign",
};

export const TOP_MOVERS_LIMITS = [3, 5, 10, 20];
export const TOP_MOVERS_MAX_LIMIT = 20;
export const TOP_MOVERS_DEFAULT_LIMIT = 5;

/**
 * Widest slice both windows ask the server for. Ranking the prefilter is done
 * by SPEND, not by the chosen metric: the cut has to keep the campaigns that
 * matter, and "top 50 by CPA" is a list of tiny campaigns with freak ratios.
 */
export const TOP_MOVERS_QUERY_LIMIT = QUERY_MAX_LIMIT;
export const TOP_MOVERS_QUERY_SORT_BY: QueryMetric = "spend";

export interface TopMoversConfig {
  metric: QueryMetric;
  groupBy: TopMoversGroupBy;
  /** Rows shown, after ranking by absolute change. */
  limit: number;
  direction: TopMoversDirection;
}

export const DEFAULT_TOP_MOVERS_CONFIG: TopMoversConfig = {
  metric: "spend",
  groupBy: "campaign",
  limit: TOP_MOVERS_DEFAULT_LIMIT,
  direction: "both",
};

/** Coerce any persisted config into a renderable one. Never throws. */
export function normalizeTopMoversConfig(
  input: Partial<TopMoversConfig> | Record<string, unknown>
): TopMoversConfig {
  const raw = input as Record<string, unknown>;
  const limit = Number(raw.limit);
  return {
    metric: (QUERY_METRICS as readonly string[]).includes(String(raw.metric))
      ? (raw.metric as QueryMetric)
      : DEFAULT_TOP_MOVERS_CONFIG.metric,
    groupBy: (TOP_MOVERS_GROUP_BYS as readonly string[]).includes(String(raw.groupBy))
      ? (raw.groupBy as TopMoversGroupBy)
      : DEFAULT_TOP_MOVERS_CONFIG.groupBy,
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= TOP_MOVERS_MAX_LIMIT
        ? limit
        : TOP_MOVERS_DEFAULT_LIMIT,
    direction: (TOP_MOVERS_DIRECTIONS as readonly string[]).includes(String(raw.direction))
      ? (raw.direction as TopMoversDirection)
      : DEFAULT_TOP_MOVERS_CONFIG.direction,
  };
}

/** Panel title, e.g. "Top movers · Spend by campaign". */
export function describeTopMovers(cfg: TopMoversConfig): string {
  const heading =
    cfg.direction === "up" ? "Top risers" : cfg.direction === "down" ? "Top fallers" : "Top movers";
  return `${heading} · ${QUERY_METRIC_META[cfg.metric].label} by ${TOP_MOVERS_GROUP_BY_LABELS[
    cfg.groupBy
  ].toLowerCase()}`;
}

/**
 * `new` — the group has no comparable earlier value, `stopped` — no current
 * one. Both are stated in words instead of a percentage against zero, which
 * would be infinite or (worse) look like a real number.
 */
export type MoverStatus = "changed" | "new" | "stopped";

export interface Mover {
  /** Group key from the metric query (platform id or campaign id). */
  group: string;
  label: string;
  platform: Platform | null;
  status: MoverStatus;
  current: number | null;
  previous: number | null;
  /** Signed change; the whole current/previous value for new/stopped. */
  change: number;
  /** null when there is no base to divide by: new, stopped, or a previous of 0. */
  changePct: number | null;
  /**
   * Did the change go the way this metric wants (CPA down is good)? null for
   * new/stopped, where "good" is not something the numbers can say.
   */
  good: boolean | null;
}

function readValue(row: MetricQueryRow | undefined, metric: QueryMetric): number | null {
  if (!row) return null;
  const value = row[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ranks groups by ABSOLUTE change, not percentage: ฿2 → ฿6 is a 200% rise and
 * still irrelevant. The percentage rides along as a secondary figure.
 *
 * Both results must be ungrouped-by-time (`timeBucket: "none"`) so each group
 * has exactly one row per window.
 */
export function computeMovers(
  cfg: TopMoversConfig,
  current: MetricQueryResult,
  previous: MetricQueryResult | null
): Mover[] {
  const invert = QUERY_METRIC_META[cfg.metric].invert;
  const currentRows = new Map(current.rows.map((r) => [r.group, r]));
  const previousRows = new Map((previous?.rows ?? []).map((r) => [r.group, r]));

  const movers: Mover[] = [];
  for (const group of new Set([...currentRows.keys(), ...previousRows.keys()])) {
    const currentRow = currentRows.get(group);
    const previousRow = previousRows.get(group);
    const cur = readValue(currentRow, cfg.metric);
    const prev = readValue(previousRow, cfg.metric);
    if (cur == null && prev == null) continue;

    const status: MoverStatus = cur == null ? "stopped" : prev == null ? "new" : "changed";
    const change = (cur ?? 0) - (prev ?? 0);
    if (change === 0) continue; // a group that did not move is not a mover

    movers.push({
      group,
      label: currentRow?.label ?? previousRow?.label ?? group,
      platform: currentRow?.platform ?? previousRow?.platform ?? null,
      status,
      current: cur,
      previous: prev,
      change,
      changePct: cur != null && prev != null && prev !== 0 ? (change / Math.abs(prev)) * 100 : null,
      good: status === "changed" ? (change > 0 ? !invert : invert) : null,
    });
  }

  const directed =
    cfg.direction === "both"
      ? movers
      : movers.filter((m) => (cfg.direction === "up" ? m.change > 0 : m.change < 0));

  return directed
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, cfg.limit);
}
