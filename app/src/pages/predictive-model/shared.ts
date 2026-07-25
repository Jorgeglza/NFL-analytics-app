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

/** Fixed confidence buckets by |predicted margin| — reveals whether the model is
 * more reliable on lopsided calls than close ones ("what's different about the misses"). */
const CONFIDENCE_BUCKETS: [number, number, string][] = [
  [0, 3, "0-3"],
  [3, 7, "3-7"],
  [7, 12, "7-12"],
  [12, 20, "12-20"],
  [20, Infinity, "20+"],
];

export function accuracyByConfidence(games: Row[]): { bucket: string; n: number; acc: number | null }[] {
  return CONFIDENCE_BUCKETS.map(([lo, hi, label]) => {
    const rows = games.filter((g) => {
      const m = Math.abs(Number(g.predicted_margin));
      return m >= lo && m < hi;
    });
    return { bucket: label, n: rows.length, acc: accuracyOf(rows) };
  });
}

/** Compact comparison of what differs between correct and incorrect picks. */
export function missComparison(games: Row[]): {
  n: number;
  avgAbsSpread: number | null;
  avgAbsPredicted: number | null;
  avgAbsError: number | null;
}[] {
  const groups = [games.filter(isCorrect), games.filter((g) => !isCorrect(g))];
  return groups.map((rows) => {
    if (!rows.length) return { n: 0, avgAbsSpread: null, avgAbsPredicted: null, avgAbsError: null };
    const spreadRows = rows.filter((g) => g.spread_line !== null);
    return {
      n: rows.length,
      avgAbsSpread: spreadRows.length
        ? spreadRows.reduce((s, g) => s + Math.abs(Number(g.spread_line)), 0) / spreadRows.length
        : null,
      avgAbsPredicted: rows.reduce((s, g) => s + Math.abs(Number(g.predicted_margin)), 0) / rows.length,
      avgAbsError: rows.reduce((s, g) => s + Math.abs(Number(g.actual_margin) - Number(g.predicted_margin)), 0) / rows.length,
    };
  });
}
