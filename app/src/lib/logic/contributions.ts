// Port of teams_tab.py:compute_week_contributions using the pipeline's
// precomputed MinMax params + importances (contrib_params.json).
import type { Row, ContribParams } from "../data/loader";

export type GradeType = "Overall Grade" | "Offensive Grade" | "Defensive Grade";

export interface ContribRow {
  feature: string;
  importance: number;
  raw: number;
  norm: number;
  contribution: number; // |signed|
  signed: number;
}

/** Contributions for one team-week row, all features, sorted by |contribution| desc. */
export function weekContributions(twRow: Row, params: ContribParams[string]): ContribRow[] {
  const out: ContribRow[] = params.features.map((f, i) => {
    const raw = twRow[f] == null ? 0 : Number(twRow[f]) || 0; // pandas fillna(0)
    const range = params.data_max[i] - params.data_min[i];
    const norm = (raw - params.data_min[i]) / (range || 1); // sklearn zero-range guard
    const w = params.importance[i];
    const signed = w * (params.mode === "defense" ? 1 - norm : norm);
    return { feature: f, importance: w, raw, norm, contribution: Math.abs(signed), signed };
  });
  return out.sort((a, b) => b.contribution - a.contribution);
}

/** numpy-style linear-interpolation percentile (q in [0,100]) on a sorted copy. */
export function percentile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const idx = (q / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function sampleStd(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}
