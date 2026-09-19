// Pairwise model-agreement matrix: how often each pair of models picks the
// same side, with "Actual" (the real game winner) treated as an 8th axis
// entry — so the (Model, Actual) cell is just that model's straight-up
// accuracy, and the same matrix answers both "how do the models compare to
// each other" and "how does each compare to the real winner" without a
// second component. New logic — no pairwise comparison existed anywhere in
// this app before (disagreementOf in ModelDotStrip.tsx is an aggregate
// spread across all models for one game, never a specific pair).
import { MODEL_KEYS, pickWinner, type MetricKey, type ProbBundle } from "./engine";

export type AxisKey = MetricKey | "actual";

export const AXIS_KEYS: AxisKey[] = [...MODEL_KEYS.map(([k]) => k), "actual"];

export const AXIS_LABELS: Record<AxisKey, string> = {
  ...Object.fromEntries(MODEL_KEYS) as Record<MetricKey, string>,
  actual: "Actual",
};

export interface AgreementCell {
  a: AxisKey;
  b: AxisKey;
  pct: number | null; // fraction of games where both sides agree, null on the diagonal
  n: number;
}

function sideOf(key: AxisKey, row: { bundle: ProbBundle; winner: "home" | "away" | null }): "home" | "away" | null {
  return key === "actual" ? row.winner : pickWinner(row.bundle[key]);
}

/** One entry per (a, b) axis pair, including self-pairs (pct null so the
 * chart can gray the diagonal out instead of showing a trivial 100%). */
export function computeAgreementMatrix(rows: { bundle: ProbBundle; winner: "home" | "away" | null }[]): AgreementCell[] {
  const cells: AgreementCell[] = [];
  for (const a of AXIS_KEYS) {
    for (const b of AXIS_KEYS) {
      if (a === b) {
        cells.push({ a, b, pct: null, n: 0 });
        continue;
      }
      let agree = 0;
      let n = 0;
      for (const row of rows) {
        const sa = sideOf(a, row);
        const sb = sideOf(b, row);
        if (sa == null || sb == null) continue;
        n++;
        if (sa === sb) agree++;
      }
      cells.push({ a, b, pct: n ? agree / n : null, n });
    }
  }
  return cells;
}
