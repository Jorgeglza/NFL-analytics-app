// Pure data-derivation helpers shared across the Predictive Model tabs.
// Source data: pipeline/predictive_model/export_page.py's JSON extracts
// (app/public/data/predictive_model/) — see docs/predictive-model.md /
// docs/predictive-model-decision.md for the research + model choice behind
// this page.
import type { Row } from "../../lib/data/loader";
import { favorite, winType, CATEGORY_CODES, type WinType } from "../../lib/logic/winType";

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

/** Same "predicted winner vs actual" check as `isCorrect()`, but the pick
 * cutoff is a caller-supplied win-probability threshold (0-100) instead of
 * the fixed 50/50 line — `predicted_margin > 0` is exactly
 * `home_win_prob > 50%`, so `thresholdPct = 50` reproduces `isCorrect()`
 * exactly. Only meaningful for graded games (`home_win_prob !== null`). */
export function isCorrectAtThreshold(g: Row, thresholdPct: number): boolean {
  return (Number(g.home_win_prob) * 100 >= thresholdPct ? 1 : 0) === Number(g.home_win);
}

/** Sweeps every distinct predicted probability in `games` as a candidate
 * cutoff (pooled accuracy only changes at these points, so they're the only
 * values worth checking) and returns the one with the highest pooled
 * accuracy — the best a moving decision cutoff can do on this exact slice
 * of games. Ties keep the lowest qualifying cutoff, an arbitrary but stable
 * choice among equally-good options. Null if there are no graded games. */
export function bestThreshold(games: Row[]): { thresholdPct: number; acc: number; n: number } | null {
  const graded = games.filter((g) => g.home_win_prob !== null);
  if (!graded.length) return null;
  const candidates = Array.from(new Set(graded.map((g) => Number(g.home_win_prob) * 100))).sort((a, b) => a - b);
  let best = { thresholdPct: 50, acc: -1 };
  for (const t of candidates) {
    const correct = graded.filter((g) => isCorrectAtThreshold(g, t)).length;
    const acc = correct / graded.length;
    if (acc > best.acc) best = { thresholdPct: t, acc };
  }
  return { ...best, n: graded.length };
}

/** "AWAY@HOME" tooltip label — bolds the model's predicted winner and
 * colors the actual winner green, so a hover shows both at a glance
 * without reading the raw numbers. Ties get no green (no actual winner);
 * the predicted side is always bold, win or lose. Returns HTML — only for
 * use inside ECharts tooltip formatters (DOM-rendered by default, so
 * inline styles apply directly), never rendered as plain text. */
export function matchupLabel(g: Row): string {
  const home = String(g.home_team);
  const away = String(g.away_team);
  const predictedHome = Number(g.predicted_margin) > 0;
  const actualHome = Number(g.actual_margin) > 0;
  const actualAway = Number(g.actual_margin) < 0;
  const teamSpan = (code: string, bold: boolean, green: boolean) =>
    `<span style="font-weight:${bold ? 700 : 400};${green ? "color:#059669;" : ""}">${code}</span>`;
  return `${teamSpan(away, !predictedHome, actualAway)}@${teamSpan(home, predictedHome, actualHome)}`;
}

/** "AWAY-HOME" final score, in the same left-to-right order as
 * `matchupLabel()`'s "AWAY@HOME" so the two lines read as one column pair
 * when stacked in a tooltip. Null if scores aren't available. */
export function scoreLabel(g: Row): string | null {
  if (g.away_score === null || g.home_score === null) return null;
  return `${g.away_score}-${g.home_score}`;
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

export interface ReliabilityBucket {
  binLo: number;
  binHi: number;
  n: number;
  meanPredicted: number; // avg predicted probability of games actually in this bin
  observedRate: number; // actual home-win rate of games in this bin
}

/** Reliability-diagram buckets: bins predicted win probability into
 * fixed-width bins and compares mean predicted vs. observed win rate per
 * bin — the standard tool for "is this probability itself accurate," a
 * different question from pick accuracy. Mirrors
 * pipeline/predictive_model/evaluate.py's calibration_table exactly,
 * including its edge convention (`np.digitize(..., right=True)`, i.e. bins
 * are `(lo, hi]` not `[lo, hi)` — only observable for probabilities landing
 * exactly on a bin edge), just computed client-side so it can be scoped to
 * the current season/team filter instead of only the pooled global number
 * on the Confidence tab. */
export function reliabilityBuckets(games: Row[], nBins = 10): ReliabilityBucket[] {
  const graded = games.filter((g) => g.home_win_prob !== null);
  if (!graded.length) return [];
  const edges = Array.from({ length: nBins + 1 }, (_, i) => i / nBins);
  // (lo, hi] bins, matching np.digitize(p, edges[1:-1], right=True): p==0
  // falls in bin 0 (nothing below it to exclude); every other edge value
  // belongs to the *lower* bin, not the upper one.
  const bucketIndex = (p: number) => Math.max(0, Math.min(nBins - 1, Math.ceil(p * nBins) - 1));

  const bins: { n: number; sumPredicted: number; sumObserved: number }[] = Array.from({ length: nBins }, () => ({
    n: 0,
    sumPredicted: 0,
    sumObserved: 0,
  }));
  graded.forEach((g) => {
    const p = Number(g.home_win_prob);
    const b = bins[bucketIndex(p)];
    b.n += 1;
    b.sumPredicted += p;
    b.sumObserved += Number(g.home_win);
  });

  return bins
    .map((b, i) => ({
      binLo: edges[i],
      binHi: edges[i + 1],
      n: b.n,
      meanPredicted: b.n ? b.sumPredicted / b.n : 0,
      observedRate: b.n ? b.sumObserved / b.n : 0,
    }))
    .filter((b) => b.n > 0);
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

// Matches Game Picks / Win Types / Spread Win % everywhere else in the app —
// same closing-spread-derived categories, no local reclassification logic.
// "Uncategorized" (ties, or games with no spread_line) gets the app's
// existing neutral gray rather than a made-up 5th color.
export const UNCATEGORIZED_CATEGORY = "Uncategorized (tie / no spread)";
export const UNCATEGORIZED_COLOR = "#e0e0e0";
export const CATEGORY_ORDER: (WinType | typeof UNCATEGORIZED_CATEGORY)[] = [
  "Favorite home",
  "Favorite away",
  "Underdog home",
  "Underdog away",
  UNCATEGORIZED_CATEGORY,
];

/** Classifies a game by the closing spread (`spread_line`, home-perspective
 * — negative means the home team was favored, same convention as
 * `lib/logic/winType.ts` and the schedule table it's ported from) crossed
 * with the actual winner. `winType()` normally takes raw home/away scores,
 * but since it only compares their sign, passing `(actual_margin, 0)`
 * reproduces the identical classification from the margin already on
 * hand — no separate score fields needed. */
export function categoryOf(g: Row): WinType | typeof UNCATEGORIZED_CATEGORY {
  const wt = winType(Number(g.actual_margin), 0, g.spread_line === null ? null : Number(g.spread_line));
  return wt ?? UNCATEGORIZED_CATEGORY;
}

/** Short code for a category — "Favorite home" -> "FH", etc, same
 * abbreviations as `CATEGORY_CODES` elsewhere in the app. */
export function categoryCode(category: WinType | typeof UNCATEGORIZED_CATEGORY): string {
  return category === UNCATEGORIZED_CATEGORY ? "—" : CATEGORY_CODES[category];
}

export interface CategoryStat {
  category: WinType | typeof UNCATEGORIZED_CATEGORY;
  n: number;
  correct: number;
  wrong: number;
  acc: number | null;
}

/** Per-category (closing-spread favorite/underdog x home/away) game count
 * and the model's straight-up pick accuracy within that category. Exposes
 * `correct`/`wrong` counts directly (not just `acc`) so a stacked bar can
 * use exact integers instead of re-deriving them from a rounded percentage.
 * `correctFn` defaults to the standard 50% cutoff (`isCorrect`) but accepts
 * `isCorrectAtThreshold` bound to a custom cutoff, for UI that lets the
 * decision threshold move. */
export function categoryStats(games: Row[], correctFn: (g: Row) => boolean = isCorrect): CategoryStat[] {
  return CATEGORY_ORDER.map((category) => {
    const rows = games.filter((g) => categoryOf(g) === category);
    const correct = rows.filter(correctFn).length;
    return { category, n: rows.length, correct, wrong: rows.length - correct, acc: rows.length ? correct / rows.length : null };
  });
}

/** Same per-category accuracy, broken out by week — "does the model do
 * better or worse on home favorites (or any other category) as the season
 * progresses." */
export function categoryStatsByWeek(games: Row[], correctFn: (g: Row) => boolean = isCorrect): { week: number; stats: CategoryStat[] }[] {
  const weeks = Array.from(new Set(games.map((g) => Number(g.week)))).sort((a, b) => a - b);
  return weeks.map((week) => ({ week, stats: categoryStats(games.filter((g) => Number(g.week) === week), correctFn) }));
}

export type FavoriteLocation = Extract<WinType, "Favorite home" | "Favorite away">;

export const FAVORITE_LOCATION_ORDER: (FavoriteLocation | typeof UNCATEGORIZED_CATEGORY)[] = [
  "Favorite home",
  "Favorite away",
  UNCATEGORIZED_CATEGORY,
];

/** Pre-game-only classification: which side the closing spread favors, with
 * no dependency on who actually won (unlike `categoryOf()`, which crosses
 * favorite with the actual winner). "Underdog" has no pre-game meaning, so
 * this only has 2 real buckets — for evaluating the model on information
 * known before kickoff. */
export function favoriteLocationOf(g: Row): FavoriteLocation | typeof UNCATEGORIZED_CATEGORY {
  const f = favorite(g.spread_line === null ? null : Number(g.spread_line));
  if (f === "home") return "Favorite home";
  if (f === "away") return "Favorite away";
  return UNCATEGORIZED_CATEGORY;
}

/** Same shape as `categoryStats()`, grouped by pre-game favorite location instead. */
export function favoriteLocationStats(games: Row[], correctFn: (g: Row) => boolean = isCorrect): CategoryStat[] {
  return FAVORITE_LOCATION_ORDER.map((category) => {
    const rows = games.filter((g) => favoriteLocationOf(g) === category);
    const correct = rows.filter(correctFn).length;
    return { category, n: rows.length, correct, wrong: rows.length - correct, acc: rows.length ? correct / rows.length : null };
  });
}

/** Same shape as `categoryStatsByWeek()`, grouped by pre-game favorite location instead. */
export function favoriteLocationStatsByWeek(games: Row[], correctFn: (g: Row) => boolean = isCorrect): { week: number; stats: CategoryStat[] }[] {
  const weeks = Array.from(new Set(games.map((g) => Number(g.week)))).sort((a, b) => a - b);
  return weeks.map((week) => ({ week, stats: favoriteLocationStats(games.filter((g) => Number(g.week) === week), correctFn) }));
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
