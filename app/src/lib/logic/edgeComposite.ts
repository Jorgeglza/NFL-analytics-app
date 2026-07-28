// Trend Edge Predictor — recalibrated (Session: variable/window backtest over
// 2015-2025 REG games, see docs/IMPLEMENTATION_LOG.md). Variables, windows and
// weights are derived from AUC-lift against actual game winners, not hand-picked:
// - PM-slope (previous "improving/fading" term) tested near coin-flip (AUC~0.51-0.52
//   across every window) and was dropped in favor of recent win rate.
// - A 3-game window underperformed longer windows for every stat tested; all
//   surviving mean features use the last 6 played games.
// - Weights are each stat's own AUC lift (AUC-0.5) normalized to sum to 1; EDGE_SCALE
//   is fit by 1D Platt scaling (minimizing log-loss of sigmoid(EDGE_SCALE*edge)) against
//   actual outcomes.
export const EDGE_SCALE = 0.074;
export const EDGE_WEIGHTS = {
  grade: 0.21,
  pmL6: 0.23,
  epaL6: 0.22,
  winL6: 0.22,
  tomL6: 0.12,
} as const;

export interface TrendFeatures {
  grade: number | null;
  pmL6: number | null; // mean points_margin, last 6 played games
  epaL6: number | null; // mean epa_diff, last 6
  winL6: number | null; // mean win (0/1), last 6 — recent record
  tomL6: number | null; // mean turnover_margin, last 6
}

export function meanLastN(values: number[], n: number): number | null {
  const v = values.filter(Number.isFinite).slice(-n);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Least-squares slope over the last n values (x = 0..k-1). */
export function slopeLastN(values: number[], n: number): number | null {
  const v = values.filter(Number.isFinite).slice(-n);
  const k = v.length;
  if (k < 2) return null;
  const xMean = (k - 1) / 2;
  const yMean = v.reduce((a, b) => a + b, 0) / k;
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    num += (i - xMean) * (v[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return den === 0 ? null : num / den;
}

export interface EdgeParts {
  gradeD: number;
  pmL6D: number;
  epaL6D: number;
  winL6D: number;
  tomL6D: number;
  edge: number;
  pAway: number;
}

/** Weighted composite of away-minus-home differentials -> p(away). */
export function edgeComposite(away: TrendFeatures, home: TrendFeatures): EdgeParts {
  const d = (a: number | null, h: number | null) => (a ?? 0) - (h ?? 0);
  const gradeD = EDGE_WEIGHTS.grade * d(away.grade, home.grade);
  const pmL6D = EDGE_WEIGHTS.pmL6 * d(away.pmL6, home.pmL6);
  const epaL6D = EDGE_WEIGHTS.epaL6 * d(away.epaL6, home.epaL6);
  const winL6D = EDGE_WEIGHTS.winL6 * d(away.winL6, home.winL6);
  const tomL6D = EDGE_WEIGHTS.tomL6 * d(away.tomL6, home.tomL6);
  const edge = gradeD + pmL6D + epaL6D + winL6D + tomL6D;
  const pAway = 1 / (1 + Math.exp(-EDGE_SCALE * edge));
  return { gradeD, pmL6D, epaL6D, winL6D, tomL6D, edge, pAway };
}
