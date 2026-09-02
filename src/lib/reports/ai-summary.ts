// The AI-summary block's text, written ONCE when a report is generated and
// frozen into the snapshot with every other number.
//
// Same provider, model and raw-fetch shape as `generateNarratives` in
// `src/lib/report/builder.ts` (OpenRouter, google/gemini-3.7-flash) —
// deliberately duplicated rather than shared, because the classic report
// builder is off-limits and its prompt/response contract (a JSON object of
// eight narratives) is not this one's (one block of prose).
//
// THIS MODULE NEVER THROWS. No API key, a non-2xx response, a malformed body or
// a timeout all fall back to a deterministic summary written from the period
// totals, flagged `generated: false`. A report must never fail to be created
// because a model was unreachable.

import { QUERY_METRIC_META } from "@/lib/dashboard/custom-widget";
import type { QueryMetric } from "@/lib/dashboard/custom-widget";
import type { ComparisonResult } from "@/lib/data/queries";
import { currencySymbol } from "@/lib/format";
import type { DateRange, SnapshotWidget } from "@/lib/reports/view-snapshot";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";

/** Hard ceiling on the model call. Report creation waits for this at most. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Headline lines lifted off the already-computed widgets, at most this many. */
const MAX_HIGHLIGHTS = 12;

export interface AiSummaryContext {
  clientName: string;
  /** ISO 4217 code; every amount below is in it. */
  currency: string;
  dateRange: DateRange;
  comparison: DateRange;
  /** Whole-client totals for the range and the period before it. */
  totals: ComparisonResult;
  /** One line per notable widget — see `widgetHighlights`. */
  highlights: string[];
}

export interface AiSummaryResult {
  content: string;
  /** false = the deterministic fallback, not model output. */
  generated: boolean;
}

// --- Context ---------------------------------------------------------------

function formatValue(metric: QueryMetric, value: number, sym: string): string {
  const { format } = QUERY_METRIC_META[metric];
  if (format === "currency") return `${sym}${Math.round(value).toLocaleString()}`;
  if (format === "percent") return `${value.toFixed(2)}%`;
  if (format === "ratio") return `${value.toFixed(2)}x`;
  return Math.round(value).toLocaleString();
}

/**
 * Compact, numbers-only lines describing what the report's own blocks show.
 * Read off the FROZEN widget data — no extra queries — so the prose can only
 * cite figures the reader can also see on the page.
 */
export function widgetHighlights(widgets: SnapshotWidget[], currency: string): string[] {
  const sym = currencySymbol(currency);
  const lines: string[] = [];

  for (const widget of widgets) {
    if (lines.length >= MAX_HIGHLIGHTS) break;
    const data = widget.data;
    if (!data) continue;

    if (data.kind === "health") {
      lines.push(`Health score: ${data.health.overallScore}/100 (grade ${data.health.grade})`);
      continue;
    }

    if (data.kind !== "metrics") continue;
    const viz = widget.viz;
    if (!viz || data.current.rows.length === 0) continue;

    const label = viz.title?.trim() || widget.type;
    const metrics = viz.metrics.slice(0, 3);

    // Ungrouped, unbucketed: one row of totals — the cheapest, most quotable line.
    if (viz.groupBy === "none" && viz.timeBucket === "none") {
      const row = data.current.rows[0];
      const parts = metrics.map(
        (m) => `${QUERY_METRIC_META[m].label} ${formatValue(m, Number(row[m] ?? 0), sym)}`
      );
      lines.push(`${label}: ${parts.join(", ")}`);
      continue;
    }

    // Grouped: the top three rows on the widget's own primary metric. Time
    // series are skipped — a day-by-day dump is neither compact nor quotable.
    if (viz.groupBy !== "none" && viz.timeBucket === "none") {
      const primary = metrics[0];
      const top = data.current.rows
        .slice(0, 3)
        .map((r) => `${r.label} ${formatValue(primary, Number(r[primary] ?? 0), sym)}`);
      if (top.length > 0) {
        lines.push(`${label} — top by ${QUERY_METRIC_META[primary].label}: ${top.join("; ")}`);
      }
    }
  }

  return lines;
}

function changeLine(label: string, pct: number): string {
  const dir = pct >= 0 ? "+" : "";
  return `${label} ${dir}${pct}%`;
}

function contextBlock(ctx: AiSummaryContext): string {
  const sym = currencySymbol(ctx.currency);
  const c = ctx.totals.current;
  const d = ctx.totals.deltas;

  return [
    `Client: ${ctx.clientName}`,
    `Period: ${ctx.dateRange.start} to ${ctx.dateRange.end} (vs ${ctx.comparison.start} to ${ctx.comparison.end})`,
    `Currency: ${ctx.currency}`,
    `Totals: ${c.totalImpressions.toLocaleString()} impressions, ${c.totalClicks.toLocaleString()} clicks, ${sym}${c.totalSpend.toLocaleString()} spend, ${c.totalConversions.toLocaleString()} conversions, ${c.avgCtr}% CTR, ${sym}${c.avgCpc} CPC, ${sym}${c.avgCpa} CPA, ${sym}${c.totalRevenue.toLocaleString()} revenue, ${c.avgRoas}x ROAS`,
    `Change vs previous period: ${[
      changeLine("spend", d.totalSpend.percentage),
      changeLine("conversions", d.totalConversions.percentage),
      changeLine("CPA", d.avgCpa.percentage),
      changeLine("CTR", d.avgCtr.percentage),
      changeLine("revenue", d.totalRevenue.percentage),
      changeLine("ROAS", d.avgRoas.percentage),
    ].join(", ")}`,
    ctx.highlights.length > 0 ? `Blocks in this report:\n${ctx.highlights.map((h) => `- ${h}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(ctx: AiSummaryContext, instructions: string): string {
  const sym = currencySymbol(ctx.currency);
  return `You are a senior media strategist writing the summary section of a client performance report for ${ctx.clientName}.

DATA:
${contextBlock(ctx)}

TASK: Write 2-4 short paragraphs summarising the period. Use the specific numbers above and nothing else — never invent a figure. Write every amount in ${ctx.currency} using the ${sym} symbol. Professional but plain language, no markdown headings, no bullet lists, no preamble.${
    instructions ? `\n\nAdditional instructions from the report author: ${instructions}` : ""
  }`;
}

// --- Deterministic fallback ------------------------------------------------

/**
 * What the block says when the model is unavailable: the same numbers, stated
 * plainly. Deterministic — the identical context always produces this text.
 */
export function fallbackSummary(ctx: AiSummaryContext): string {
  const sym = currencySymbol(ctx.currency);
  const c = ctx.totals.current;
  const d = ctx.totals.deltas;

  const headline = `For ${ctx.dateRange.start} to ${ctx.dateRange.end}, ${ctx.clientName} recorded ${c.totalImpressions.toLocaleString()} impressions, ${c.totalClicks.toLocaleString()} clicks and ${c.totalConversions.toLocaleString()} conversions on ${sym}${c.totalSpend.toLocaleString()} spend, at a ${c.avgCtr}% CTR and ${sym}${c.avgCpa} CPA.`;

  const change = `Against ${ctx.comparison.start} to ${ctx.comparison.end}, spend ${d.totalSpend.percentage >= 0 ? "rose" : "fell"} ${Math.abs(d.totalSpend.percentage)}% and conversions ${d.totalConversions.percentage >= 0 ? "rose" : "fell"} ${Math.abs(d.totalConversions.percentage)}%, leaving CPA ${d.avgCpa.percentage <= 0 ? "down" : "up"} ${Math.abs(d.avgCpa.percentage)}%.`;

  const revenue =
    c.totalRevenue > 0
      ? ` Revenue was ${sym}${c.totalRevenue.toLocaleString()} at ${c.avgRoas}x ROAS.`
      : "";

  return `${headline} ${change}${revenue}`;
}

// --- The call --------------------------------------------------------------

/**
 * Writes one AI-summary block. Never throws and never rejects: every failure
 * path returns the deterministic fallback with `generated: false`.
 */
export async function generateAiSummary(
  ctx: AiSummaryContext,
  instructions: string
): Promise<AiSummaryResult> {
  const fallback = { content: fallbackSummary(ctx), generated: false as const };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://adpulse.app",
        "X-Title": "AdPulse",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: buildPrompt(ctx, instructions) }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return fallback;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return fallback;

    return { content: content.trim(), generated: true };
  } catch {
    // Network error, abort on timeout, malformed JSON — all the same answer.
    return fallback;
  }
}
