// Pure data-derivation helpers shared across the Predictive Model tabs.
// Source data: pipeline/predictive_model/export_page.py's JSON extracts
// (app/public/data/predictive_model/) — see docs/predictive-model.md /
// docs/predictive-model-decision.md for the research + model choice behind
// this page.
import type { Row } from "../../lib/data/loader";

export const ALL_SEASONS = "All seasons";
export const ALL_TEAMS = "All teams";

export function seasonOptions(games: Row[]): string[] {
  const seasons = Array.from(new Set(games.map((g) => String(g.season)))).sort((a, b) => Number(b) - Number(a));
  return [ALL_SEASONS, ...seasons];
}

export function teamOptions(games: Row[]): string[] {
  const teams = Array.from(new Set(games.flatMap((g) => [String(g.home_team), String(g.away_team)]))).sort();
  return [ALL_TEAMS, ...teams];
}

export function filterGames(games: Row[], season: string, team: string): Row[] {
  return games.filter((g) => {
    if (season !== ALL_SEASONS && String(g.season) !== season) return false;
    if (team !== ALL_TEAMS && g.home_team !== team && g.away_team !== team) return false;
    return true;
  });
}

/** Straight-up accuracy for a slice of games (model's own margin sign vs actual). */
export function accuracyOf(games: Row[]): number | null {
  if (!games.length) return null;
  const correct = games.filter((g) => (Number(g.predicted_margin) > 0 ? 1 : 0) === Number(g.home_win)).length;
  return correct / games.length;
}

/** ATS accuracy for a slice of games (only rows with a graded cover). */
export function atsAccuracyOf(games: Row[]): { acc: number | null; n: number } {
  const graded = games.filter((g) => g.home_covers !== null && g.home_covers_prob !== null);
  if (!graded.length) return { acc: null, n: 0 };
  const correct = graded.filter((g) => (Number(g.home_covers_prob) >= 0.5 ? 1 : 0) === Number(g.home_covers)).length;
  return { acc: correct / graded.length, n: graded.length };
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "--" : `${(v * 100).toFixed(digits)}%`;
}

/** "diff_l3_epa_diff" -> "l3 epa diff" — shared feature-name display across tabs. */
export function labelFor(feature: string): string {
  return feature.replace(/^diff_/, "").replace(/_/g, " ");
}

export function isCorrect(g: Row): boolean {
  return (Number(g.predicted_margin) > 0 ? 1 : 0) === Number(g.home_win);
}

/** Straight-up accuracy per week number (pooled across whatever games are passed in). */
export function accuracyByWeek(games: Row[]): { week: number; n: number; acc: number | null }[] {
  const weeks = Array.from(new Set(games.map((g) => Number(g.week)))).sort((a, b) => a - b);
  return weeks.map((week) => {
    const rows = games.filter((g) => Number(g.week) === week);
    return { week, n: rows.length, acc: accuracyOf(rows) };
  });
}

export interface HeatmapCell {
  xi: number;
  yi: number;
  n: number;
  correctShare: number | null; // share of games in this cell that were correct straight-up picks
}

export interface Heatmap {
  xLabels: string[];
  yLabels: string[];
  cells: HeatmapCell[];
}

/** A cell (or bucket) is only outlined blue when correct picks are a strict
 * majority — an exact 50/50 split is shared between blue and red, and ties
 * render red (the "not clearly right" reading wins the tie). */
export function isCellCorrect(correctShare: number | null): boolean {
  return correctShare !== null && correctShare > 0.5;
}

/** Bucketizes predicted-margin (x) vs actual-margin (y) into a symmetric NxN
 * grid on identical bucket edges for both axes, so the diagonal (xi === yi)
 * is a meaningful "predicted == actual" reference line. Each cell's outline
 * is decided by real outcomes (majority of that cell's games correct or
 * not), not just quadrant geometry — handles buckets straddling zero. */
export function buildMarginHeatmap(games: Row[], bucketWidth = 10): Heatmap {
  if (!games.length) return { xLabels: [], yLabels: [], cells: [] };
  const maxAbs = Math.max(30, ...games.map((g) => Math.max(Math.abs(Number(g.predicted_margin)), Math.abs(Number(g.actual_margin)))));
  const halfBuckets = Math.ceil(maxAbs / bucketWidth);
  const edges: number[] = [];
  for (let i = -halfBuckets; i <= halfBuckets; i++) edges.push(i * bucketWidth);
  const nBuckets = edges.length - 1;
  const labels = edges.slice(0, -1).map((lo, i) => `${lo} to ${edges[i + 1]}`);

  const bucketIndex = (v: number) => {
    const idx = Math.floor((v - edges[0]) / bucketWidth);
    return Math.max(0, Math.min(nBuckets - 1, idx));
  };

  const grid: { n: number; correct: number }[][] = Array.from({ length: nBuckets }, () =>
    Array.from({ length: nBuckets }, () => ({ n: 0, correct: 0 })),
  );
  games.forEach((g) => {
    const xi = bucketIndex(Number(g.predicted_margin));
    const yi = bucketIndex(Number(g.actual_margin));
    grid[xi][yi].n += 1;
    if (isCorrect(g)) grid[xi][yi].correct += 1;
  });

  const cells: HeatmapCell[] = [];
  for (let xi = 0; xi < nBuckets; xi++) {
    for (let yi = 0; yi < nBuckets; yi++) {
      const cell = grid[xi][yi];
      if (cell.n > 0) cells.push({ xi, yi, n: cell.n, correctShare: cell.correct / cell.n });
    }
  }
  return { xLabels: labels, yLabels: labels, cells };
}

/** Bucketizes predicted win probability (x, fixed-width % bins) against the
 * actual outcome (y: Away win / Home win — only 2 rows, since the outcome
 * itself is binary) — the "%" mode's parallel to the margin heatmap. A cell
 * is "correct" when its bucket is on the side of 50% matching that row's
 * outcome (e.g. a 60-70% bucket in the "Home win" row is a correct call). */
export function buildProbabilityHeatmap(games: Row[], bucketWidthPct = 10): Heatmap {
  const graded = games.filter((g) => g.home_win_prob !== null);
  if (!graded.length) return { xLabels: [], yLabels: [], cells: [] };
  const nBuckets = Math.round(100 / bucketWidthPct);
  const xLabels = Array.from({ length: nBuckets }, (_, i) => `${i * bucketWidthPct}-${(i + 1) * bucketWidthPct}%`);
  const yLabels = ["Away win", "Home win"];

  const bucketIndex = (p: number) => Math.max(0, Math.min(nBuckets - 1, Math.floor((p * 100) / bucketWidthPct)));

  const grid: { n: number; correct: number }[][] = Array.from({ length: nBuckets }, () => [
    { n: 0, correct: 0 },
    { n: 0, correct: 0 },
  ]);
  graded.forEach((g) => {
    const xi = bucketIndex(Number(g.home_win_prob));
    const yi = Number(g.home_win); // 0 = away win row, 1 = home win row
    grid[xi][yi].n += 1;
    if (isCorrect(g)) grid[xi][yi].correct += 1;
  });

  const cells: HeatmapCell[] = [];
  for (let xi = 0; xi < nBuckets; xi++) {
    for (let yi = 0; yi < 2; yi++) {
      const cell = grid[xi][yi];
      if (cell.n > 0) cells.push({ xi, yi, n: cell.n, correctShare: cell.correct / cell.n });
    }
  }
  return { xLabels, yLabels, cells };
}

/** Per-season calibration: does the model's own predicted win probability
 * track the observed win rate? (Distinct from pick accuracy — a model can
 * be directionally right most of the time while still over/under-stating
 * its confidence.) */
export function calibrationBySeason(games: Row[]): { season: number | "pooled"; n: number; avgPredicted: number; observedRate: number }[] {
  const seasons = Array.from(new Set(games.map((g) => Number(g.season)))).sort((a, b) => a - b);
  const rows = seasons.map((season) => ({ season: season as number | "pooled", ...calibrationRow(games.filter((g) => Number(g.season) === season)) }));
  rows.push({ season: "pooled", ...calibrationRow(games) });
  return rows;
}

/** Per-week calibration, pooled across whatever games are passed in. */
export function calibrationByWeek(games: Row[]): { week: number; n: number; avgPredicted: number; observedRate: number }[] {
  const weeks = Array.from(new Set(games.map((g) => Number(g.week)))).sort((a, b) => a - b);
  return weeks.map((week) => ({ week, ...calibrationRow(games.filter((g) => Number(g.week) === week)) }));
}

function calibrationRow(rows: Row[]): { n: number; avgPredicted: number; observedRate: number } {
  const graded = rows.filter((g) => g.home_win_prob !== null);
  const avgPredicted = graded.length ? graded.reduce((s, g) => s + Number(g.home_win_prob), 0) / graded.length : 0;
  const observedRate = graded.length ? graded.reduce((s, g) => s + Number(g.home_win), 0) / graded.length : 0;
  return { n: graded.length, avgPredicted, observedRate };
}

/** Compact comparison of what differs between correct and incorrect picks. */
export function missComparison(games: Row[]): {
  n: number;
  avgAbsSpread: number | null;
  avgAbsPredicted: number | null;
  avgAbsError: number | null;
  avgConfidencePct: number | null; // |predicted probability - 50%| — the % mode's equivalent of "how confident"
}[] {
  const groups = [games.filter(isCorrect), games.filter((g) => !isCorrect(g))];
  return groups.map((rows) => {
    if (!rows.length) return { n: 0, avgAbsSpread: null, avgAbsPredicted: null, avgAbsError: null, avgConfidencePct: null };
    const spreadRows = rows.filter((g) => g.spread_line !== null);
    const probRows = rows.filter((g) => g.home_win_prob !== null);
    return {
      n: rows.length,
      avgAbsSpread: spreadRows.length
        ? spreadRows.reduce((s, g) => s + Math.abs(Number(g.spread_line)), 0) / spreadRows.length
        : null,
      avgAbsPredicted: rows.reduce((s, g) => s + Math.abs(Number(g.predicted_margin)), 0) / rows.length,
      avgAbsError: rows.reduce((s, g) => s + Math.abs(Number(g.actual_margin) - Number(g.predicted_margin)), 0) / rows.length,
      avgConfidencePct: probRows.length
        ? probRows.reduce((s, g) => s + Math.abs(Number(g.home_win_prob) - 0.5), 0) / probRows.length
        : null,
    };
  });
}
