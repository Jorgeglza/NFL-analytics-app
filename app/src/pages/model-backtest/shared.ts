// Pure display helpers shared across the Model Backtest tabs — mirrors
// pages/predictive-model/shared.ts's pct()/ALL_SEASONS conventions.
import type { BacktestSummary } from "../../lib/logic/backtest";

export const ALL_SEASONS = "All seasons";

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "--" : `${(v * 100).toFixed(digits)}%`;
}

/** Signed dollar amount, e.g. "+$1,234" / "-$56". */
export function money(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "--";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** ROI as a signed percentage, e.g. "+3.2%". */
export function roiPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "--";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v * 100).toFixed(digits)}%`;
}

/** Green when profitable, red when not, gray when there's nothing graded yet. */
export function profitColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return "#94a3b8";
  return v > 0 ? "#2CA25F" : v < 0 ? "#C8102E" : "#94a3b8";
}

export function seasonOptionsFrom(seasons: number[]): (number | typeof ALL_SEASONS)[] {
  return [ALL_SEASONS, ...[...seasons].sort((a, b) => b - a)];
}

/** Sort order for the "By Model" comparison — most profitable ROI first,
 * ties broken by accuracy, so the headline story ("what's best") reads
 * top-to-bottom without the reader having to sort a table themselves. */
export function rankByRoi<K>(entries: [K, BacktestSummary][]): [K, BacktestSummary][] {
  return [...entries].sort((a, b) => {
    const ra = a[1].roi ?? -Infinity;
    const rb = b[1].roi ?? -Infinity;
    if (rb !== ra) return rb - ra;
    return (b[1].accuracy ?? -Infinity) - (a[1].accuracy ?? -Infinity);
  });
}
