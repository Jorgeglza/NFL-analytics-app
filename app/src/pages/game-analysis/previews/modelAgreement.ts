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

export function sideOf(key: AxisKey, row: { bundle: ProbBundle; winner: "home" | "away" | null }): "home" | "away" | null {
  return key === "actual" ? row.winner : pickWinner(row.bundle[key]);
}

// Models actually being compared for the three "listening recommendation"
// analyses below — consensus excluded (it's a derived average of the
// others, not an independent pick), same convention as disagreementOf.
const PICK_KEYS: MetricKey[] = MODEL_KEYS.map(([k]) => k).filter((k) => k !== "consensus");

export interface AllAgreeStat {
  winRate: number | null;
  n: number;
}

/** Among games where every non-consensus model picks the same side, the
 * actual win rate of that agreed side. */
export function computeAllAgreeStat(rows: { bundle: ProbBundle; winner: "home" | "away" | null }[]): AllAgreeStat {
  let wins = 0;
  let n = 0;
  for (const row of rows) {
    if (row.winner == null) continue;
    const sides = PICK_KEYS.map((k) => sideOf(k, row)).filter((s): s is "home" | "away" => s != null);
    if (sides.length < 2) continue;
    const agreed = sides.every((s) => s === sides[0]);
    if (!agreed) continue;
    n++;
    if (sides[0] === row.winner) wins++;
  }
  return { winRate: n ? wins / n : null, n };
}

export interface PairwiseResolution {
  a: MetricKey;
  b: MetricKey;
  accA: number | null;
  accB: number | null;
  n: number;
  better: MetricKey | null; // null when accA === accB (or no data)
}

/** For every pair of (non-consensus) models, restricted to games where that
 * pair actually disagrees: each model's own accuracy in that subset, and
 * which one has historically been right more often. */
export function computePairwiseResolution(rows: { bundle: ProbBundle; winner: "home" | "away" | null }[]): Map<string, PairwiseResolution> {
  const out = new Map<string, PairwiseResolution>();
  for (let i = 0; i < PICK_KEYS.length; i++) {
    for (let j = i + 1; j < PICK_KEYS.length; j++) {
      const a = PICK_KEYS[i];
      const b = PICK_KEYS[j];
      let correctA = 0;
      let correctB = 0;
      let n = 0;
      for (const row of rows) {
        if (row.winner == null) continue;
        const sa = sideOf(a, row);
        const sb = sideOf(b, row);
        if (sa == null || sb == null || sa === sb) continue;
        n++;
        if (sa === row.winner) correctA++;
        if (sb === row.winner) correctB++;
      }
      const accA = n ? correctA / n : null;
      const accB = n ? correctB / n : null;
      const better = accA == null || accB == null || accA === accB ? null : accA > accB ? a : b;
      out.set(pairKey(a, b), { a, b, accA, accB, n, better });
    }
  }
  return out;
}

export function pairKey(a: MetricKey, b: MetricKey): string {
  return [a, b].sort().join("|");
}

export interface TossUpAccuracy {
  acc: number | null;
  n: number;
}

/** Per model, restricted to games where THAT model's own probability was
 * within `band` of 50/50 (its own toss-up calls) — is a model that says
 * "toss-up" actually more reliable than another in exactly those spots? */
export function computeTossUpAccuracy(
  rows: { bundle: ProbBundle; winner: "home" | "away" | null }[],
  band = 0.05,
): Map<MetricKey, TossUpAccuracy> {
  const out = new Map<MetricKey, TossUpAccuracy>();
  for (const key of [...PICK_KEYS, "consensus" as MetricKey]) {
    let correct = 0;
    let n = 0;
    for (const row of rows) {
      if (row.winner == null) continue;
      const p = row.bundle[key][1];
      if (p == null || Math.abs(p - 0.5) > band) continue;
      n++;
      const side = sideOf(key, row);
      if (side === row.winner) correct++;
    }
    out.set(key, { acc: n ? correct / n : null, n });
  }
  return out;
}

/** Best-performing model specifically in toss-up spots, requiring at least
 * `minN` graded toss-up calls so a tiny sample can't "win" by luck. */
export function bestTossUpModel(tossUp: Map<MetricKey, TossUpAccuracy>, minN = 5): MetricKey | null {
  let best: MetricKey | null = null;
  let bestAcc = -1;
  for (const [key, { acc, n }] of tossUp) {
    if (acc == null || n < minN) continue;
    if (acc > bestAcc) {
      bestAcc = acc;
      best = key;
    }
  }
  return best;
}

export type GameCategory =
  | { kind: "toss-up" }
  | { kind: "all-agree" }
  | { kind: "disagree"; a: MetricKey; b: MetricKey }
  | { kind: "unknown" }; // fewer than 2 models available for this game

/** Classifies one game for the "listening recommendation" annotation:
 * toss-up takes priority (decision-relevant regardless of agreement), then
 * all-agree, then disagreement between the two most extreme models (the
 * same pair disagreementOf's max−min spread identifies). */
export function categorizeGame(bundle: ProbBundle, band = 0.05): GameCategory {
  const consensus = bundle.consensus[1];
  const probs = PICK_KEYS.map((k) => bundle[k][1]).filter((p): p is number => p != null);
  const reference = consensus ?? (probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : null);
  if (reference != null && Math.abs(reference - 0.5) <= band) return { kind: "toss-up" };

  const sides = PICK_KEYS.map((k) => ({ k, side: sideOf(k, { bundle, winner: null }) })).filter((s): s is { k: MetricKey; side: "home" | "away" } => s.side != null);
  if (sides.length >= 2 && sides.every((s) => s.side === sides[0].side)) return { kind: "all-agree" };

  if (probs.length < 2) return { kind: "unknown" };
  let maxKey = PICK_KEYS[0];
  let minKey = PICK_KEYS[0];
  let maxP = -1;
  let minP = 2;
  for (const k of PICK_KEYS) {
    const p = bundle[k][1];
    if (p == null) continue;
    if (p > maxP) {
      maxP = p;
      maxKey = k;
    }
    if (p < minP) {
      minP = p;
      minKey = k;
    }
  }
  return { kind: "disagree", a: maxKey, b: minKey };
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
