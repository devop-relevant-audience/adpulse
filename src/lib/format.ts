// Canonical display formatters for the whole app.
//
// These consolidate copies that were previously duplicated across dashboard
// components, chart tiles, and the report exporters. Two currency variants are
// kept because the codebase deliberately renders currency two ways:
//   - `formatCurrency` shows cents on sub-$1K values (detail tables, reports).
//   - `formatCurrencyCompact` shows whole dollars on sub-$1K values (chart
//     labels, summary tiles, donut centers).
// All helpers guard against non-finite input by rendering an em dash.

/**
 * Human-readable count. Abbreviates thousands (K) and millions (M); smaller
 * values fall back to locale grouping. Non-finite input renders as "—".
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Currency with cents on small values. Abbreviates 100K+ (whole thousands) and
 * 1M+ ($X.XXM). Non-finite input renders as "—".
 */
export function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 100_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Compact currency for charts and summary tiles: whole dollars on small values,
 * abbreviated K/M above. Non-finite input renders as "—".
 */
export function formatCurrencyCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Percentage with two decimals (e.g. "12.34%"). */
export function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}
