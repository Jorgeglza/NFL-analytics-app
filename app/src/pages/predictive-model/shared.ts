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
