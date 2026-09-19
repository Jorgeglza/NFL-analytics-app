// Shared math for the Pick'em "This Week" view — correlating a selected
// week's actual results against every prior week's. The model machinery
// itself (Elo, Pythagorean, Trend Edge, market blend, predictive lookup) is
// reused wholesale from previews/engine.ts, not duplicated here.

/** Pearson product-moment correlation coefficient. Returns null if fewer
 * than 2 pairs, or if either series has zero variance (undefined r) — same
 * null-on-degenerate-input convention as this app's other stats helpers
 * (lib/logic/contributions.ts). */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/** Plain-language read of a correlation coefficient's magnitude, matching
 * the direct, non-hedging tone already used in the pickem Story view. */
export function correlationRead(r: number | null): string {
  if (r == null) return "not enough data";
  const a = Math.abs(r);
  if (a < 0.1) return "no meaningful relationship";
  if (a < 0.3) return "weak relationship";
  if (a < 0.5) return "moderate relationship";
  return "strong relationship";
}
