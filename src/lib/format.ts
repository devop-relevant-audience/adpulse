// Canonical display formatters for the whole app.
//
// These consolidate copies that were previously duplicated across dashboard
// components, chart tiles, and the report exporters. Two currency variants are
// kept because the codebase deliberately renders currency two ways:
//   - `formatCurrency` shows minor units on sub-1K values (detail tables, reports).
//   - `formatCurrencyCompact` shows whole units on sub-1K values (chart
//     labels, summary tiles, donut centers).
// All helpers guard against non-finite input by rendering an em dash.
//
// Currency: every amount is stored in its ad account's native currency (THB,
// JPY, USD, …). Callers pass the client's ISO 4217 code; components get it from
// `useCurrencyFormat()` (src/hooks/use-currency-format.ts). Demo clients have
// no ad account and fall back to DEFAULT_CURRENCY. Cross-client sums that mix
// currencies are not meaningful — no FX conversion exists yet.

export const DEFAULT_CURRENCY = "USD";

const symbolCache = new Map<string, { symbol: string; minorDigits: number }>();

/** Narrow symbol ("$", "฿", "¥") and the currency's minor-unit digits (JPY = 0). */
function currencyInfo(currency: string): { symbol: string; minorDigits: number } {
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
  const cached = symbolCache.get(code);
  if (cached) return cached;
  let info: { symbol: string; minorDigits: number };
  try {
    const fmt = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    });
    const symbol = fmt.formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
    info = { symbol, minorDigits: fmt.resolvedOptions().maximumFractionDigits ?? 2 };
  } catch {
    // Unknown/invalid code: show the code itself so the number is never mislabeled.
    info = { symbol: `${code} `, minorDigits: 2 };
  }
  symbolCache.set(code, info);
  return info;
}

/** Display symbol for a currency code ("$", "฿", "¥"); unknown codes render as the code. */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  return currencyInfo(currency).symbol;
}

/**
 * Human-readable count. Abbreviates thousands (K) and millions (M); smaller
 * values fall back to locale grouping, rounded to at most one decimal (none
 * from 100 up) so fractional conversions never print float noise like
 * "7.366099999999999". Non-finite input renders as "—".
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 });
}

/**
 * Drop the still-accumulating current day from a dated series. A chart whose
 * range ends today would otherwise always end in a steep fake dropoff (today
 * only has a few hours of data). "Today" is the runtime's local date — the
 * viewer's browser date on the client, the server date inside report
 * snapshots. Rows without a date (un-bucketed totals) pass through untouched.
 */
export function excludeCurrentDay<T extends { date?: string | null }>(rows: T[]): T[] {
  const today = new Date().toLocaleDateString("en-CA"); // yyyy-MM-dd
  return rows.filter((r) => r.date !== today);
}

/**
 * Currency with minor units on small values (none for zero-decimal currencies
 * like JPY). Abbreviates 100K+ (whole thousands) and 1M+ (X.XXM). Non-finite
 * input renders as "—".
 */
export function formatCurrency(n: number, currency: string = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(n)) return "—";
  const { symbol, minorDigits } = currencyInfo(currency);
  if (Math.abs(n) >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 100_000) return `${symbol}${(n / 1_000).toFixed(0)}K`;
  if (Math.abs(n) >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}K`;
  return `${symbol}${n.toFixed(minorDigits)}`;
}

/**
 * Compact currency for charts and summary tiles: whole units on small values,
 * abbreviated K/M above. Non-finite input renders as "—".
 */
export function formatCurrencyCompact(n: number, currency: string = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(n)) return "—";
  const { symbol } = currencyInfo(currency);
  if (Math.abs(n) >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}K`;
  return `${symbol}${n.toFixed(0)}`;
}

/** Percentage with two decimals (e.g. "12.34%"). */
export function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}
