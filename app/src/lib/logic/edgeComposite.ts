// Trend Edge Predictor — port of matchup_previews_tab.py trend feature logic.

export const EDGE_SCALE = 0.12;
export const EDGE_WEIGHTS = {
  grade: 0.4,
  pmL3: 0.25,
  epaL3: 0.2,
  pmSlope: 0.1,
  tomL3: 0.05,
} as const;

export interface TrendFeatures {
  grade: number | null;
  pmL3: number | null; // mean points_margin, last 3 played weeks
  epaL3: number | null; // mean epa_diff, last 3
  pmSlope: number | null; // linreg slope of points_margin, last 5
  tomL3: number | null; // mean turnover_margin, last 3
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
  pmL3D: number;
  epaL3D: number;
  pmSlopeD: number;
  tomL3D: number;
  edge: number;
  pAway: number;
}

/** Weighted composite of away-minus-home differentials -> p(away). */
export function edgeComposite(away: TrendFeatures, home: TrendFeatures): EdgeParts {
  const d = (a: number | null, h: number | null) => (a ?? 0) - (h ?? 0);
  const gradeD = EDGE_WEIGHTS.grade * d(away.grade, home.grade);
  const pmL3D = EDGE_WEIGHTS.pmL3 * d(away.pmL3, home.pmL3);
  const epaL3D = EDGE_WEIGHTS.epaL3 * d(away.epaL3, home.epaL3);
  const pmSlopeD = EDGE_WEIGHTS.pmSlope * d(away.pmSlope, home.pmSlope);
  const tomL3D = EDGE_WEIGHTS.tomL3 * d(away.tomL3, home.tomL3);
  const edge = gradeD + pmL3D + epaL3D + pmSlopeD + tomL3D;
  const pAway = 1 / (1 + Math.exp(-EDGE_SCALE * edge));
  return { gradeD, pmL3D, epaL3D, pmSlopeD, tomL3D, edge, pAway };
}
