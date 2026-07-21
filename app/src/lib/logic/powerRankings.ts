// Power Rankings composite score — new analytics (not a port). Blends three
// independent signals — Elo rating, season-to-date Overall Grade, and
// Pythagorean win% from cumulative points for/against — each min-max
// normalized to 0-1 across that week's teams, then averaged (equal weights;
// a team missing one signal, e.g. week 1 with no grade yet, is averaged over
// whatever signals it has rather than penalized to 0).
import type { Row } from "../data/loader";
import { buildEloRatingHistory, scheduleToEloGames, ELO_INIT, type EloRatingPoint } from "./elo";
import { pythWinPct } from "./pythagorean";

export interface PowerRankingRow {
  team: string;
  elo: number;
  grade: number | null;
  pythPct: number | null;
  composite: number; // 0-1, higher = stronger
  rank: number;
  prevRank: number | null;
  movement: number | null; // prevRank - rank; positive = moved up
}

export function indexEloHistoryByTeam(history: EloRatingPoint[]): Map<string, EloRatingPoint[]> {
  const m = new Map<string, EloRatingPoint[]>();
  for (const p of history) {
    if (!m.has(p.team)) m.set(p.team, []);
    m.get(p.team)!.push(p);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.season - b.season || a.week - b.week);
  return m;
}

/** Team's Elo rating as of the end of (season, week) — last played game at or before it, else ELO_INIT. */
export function eloAsOf(byTeam: Map<string, EloRatingPoint[]>, team: string, season: number, week: number): number {
  const arr = byTeam.get(team);
  if (!arr?.length) return ELO_INIT;
  let rating = ELO_INIT;
  for (const p of arr) {
    if (p.season > season || (p.season === season && p.week > week)) break;
    rating = p.rating;
  }
  return rating;
}

function avgOverallGrade(grades: Row[], team: string, season: number, week: number): number | null {
  const rows = grades.filter(
    (r) => String(r.Team) === team && Number(r.Season) === season && Number(r.Week) <= week && r["Overall Grade"] != null,
  );
  if (!rows.length) return null;
  return rows.reduce((s, r) => s + Number(r["Overall Grade"]), 0) / rows.length;
}

function pointsForAgainst(schedule: Row[], team: string, season: number, week: number): { pf: number; pa: number } | null {
  let pf = 0;
  let pa = 0;
  let n = 0;
  for (const g of schedule) {
    if (Number(g.season) !== season || g.game_type !== "REG" || Number(g.week) > week) continue;
    if (g.home_score == null || g.away_score == null) continue;
    if (g.home_team === team) {
      pf += Number(g.home_score);
      pa += Number(g.away_score);
      n++;
    } else if (g.away_team === team) {
      pf += Number(g.away_score);
      pa += Number(g.home_score);
      n++;
    }
  }
  return n ? { pf, pa } : null;
}

function minMax01(vals: (number | null)[]): (number | null)[] {
  const nums = vals.filter((v): v is number => v != null);
  if (!nums.length) return vals.map(() => null);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (hi === lo) return vals.map((v) => (v == null ? null : 0.5));
  return vals.map((v) => (v == null ? null : (v - lo) / (hi - lo)));
}

/** Mean of a team's available normalized signals (nulls skipped, not zeroed). */
function compositeOf(signals: (number | null)[]): number {
  const present = signals.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;
}

/** Composite score per team from three parallel per-team metric arrays. */
function compositesFor(elos: number[], grades: (number | null)[], pyths: (number | null)[]): number[] {
  const normElo = minMax01(elos);
  const normGrade = minMax01(grades);
  const normPyth = minMax01(pyths);
  return elos.map((_, i) => compositeOf([normElo[i], normGrade[i], normPyth[i]]));
}

/** Rank teams 1..N by composite score, descending (1 = strongest). */
function rankTeams(teams: string[], composite: number[]): Map<string, number> {
  const order = teams.map((t, i) => ({ t, c: composite[i] })).sort((a, b) => b.c - a.c);
  const out = new Map<string, number>();
  order.forEach((o, i) => out.set(o.t, i + 1));
  return out;
}

/**
 * Composite power ranking for every team active in `season` as of `week`,
 * with movement vs. the prior week (null at week 1 or a team's first week).
 */
export function computePowerRankings(schedule: Row[], grades: Row[], season: number, week: number): PowerRankingRow[] {
  const eloHistory = buildEloRatingHistory(scheduleToEloGames(schedule));
  const byTeam = indexEloHistoryByTeam(eloHistory);
  const teams = [...new Set(schedule.filter((r) => Number(r.season) === season).flatMap((r) => [String(r.home_team), String(r.away_team)]))].sort();

  const pythsFor = (wk: number) =>
    teams.map((t) => {
      const pfa = pointsForAgainst(schedule, t, season, wk);
      return pfa ? pythWinPct(pfa.pf, pfa.pa) : null;
    });

  const buildFor = (wk: number): Map<string, number> | null => {
    if (wk < 1) return null;
    const elosWk = teams.map((t) => eloAsOf(byTeam, t, season, wk));
    const gradesWk = teams.map((t) => avgOverallGrade(grades, t, season, wk));
    return rankTeams(teams, compositesFor(elosWk, gradesWk, pythsFor(wk)));
  };

  const elos = teams.map((t) => eloAsOf(byTeam, t, season, week));
  const gradesArr = teams.map((t) => avgOverallGrade(grades, t, season, week));
  const pyths = pythsFor(week);
  const composite = compositesFor(elos, gradesArr, pyths);
  const ranks = rankTeams(teams, composite);
  const prevRanks = buildFor(week - 1);

  return teams
    .map((team, i) => {
      const rank = ranks.get(team)!;
      const prevRank = prevRanks?.get(team) ?? null;
      return {
        team,
        elo: elos[i],
        grade: gradesArr[i],
        pythPct: pyths[i],
        composite: composite[i],
        rank,
        prevRank,
        movement: prevRank == null ? null : prevRank - rank,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}
