// Power Rankings composite score — new analytics (not a port). Blends three
// independent signals — Elo rating, season-to-date Overall Grade, and
// Pythagorean win% from cumulative points for/against — each min-max
// normalized to 0-1 across that week's teams, then averaged (equal weights;
// a team missing one signal, e.g. week 1 with no grade yet, is averaged over
// whatever signals it has rather than penalized to 0).
import type { Row } from "../data/loader";
import { buildEloRatingHistory, scheduleToEloGames, eloPHome, eloMovMultiplier, ELO_INIT, ELO_HFA, ELO_K, type EloRatingPoint } from "./elo";
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

// ---------- per-team "how did we get this number" breakdown, for the Power Rankings detail popup ----------

export interface EloGameDetail {
  played: boolean;
  opponent: string | null;
  home: boolean | null;
  teamScore: number | null;
  opponentScore: number | null;
  preGameElo: number;
  opponentPreGameElo: number;
  hfa: number;
  k: number;
  movMultiplier: number | null;
  delta: number | null;
  postGameElo: number;
}

export interface WeeklyGradeDetail {
  week: number;
  grade: number;
  opponent: string | null;
  home: boolean | null;
  teamScore: number | null;
  opponentScore: number | null;
}

export interface WeeklyCompositeDetail {
  week: number;
  composite: number;
  leagueAvg: number;
}

export interface TeamCompositeBreakdown {
  team: string;
  season: number;
  week: number;
  composite: number;
  rank: number;
  eloGame: EloGameDetail;
  eloNorm: number | null;
  eloRange: [number, number];
  weeklyGrades: WeeklyGradeDetail[];
  gradeAvg: number | null;
  gradeNorm: number | null;
  gradeRange: [number, number] | null;
  weeklyPoints: { week: number; pointsFor: number; pointsAgainst: number }[];
  pointsForTotal: number;
  pointsAgainstTotal: number;
  pythPct: number | null;
  pythNorm: number | null;
  pythRange: [number, number] | null;
  weeklyComposite: WeeklyCompositeDetail[];
}

/**
 * Reuses computePowerRankings for the final composite/elo/grade/pyth values
 * (so the popup can never disagree with the table), then adds the raw
 * per-week inputs and normalization ranges that explain how those numbers
 * were reached.
 */
export function computeTeamBreakdown(schedule: Row[], grades: Row[], season: number, week: number, team: string): TeamCompositeBreakdown | null {
  const rankings = computePowerRankings(schedule, grades, season, week);
  const row = rankings.find((r) => r.team === team);
  if (!row) return null;

  const elos = rankings.map((r) => r.elo);
  const gradeVals = rankings.map((r) => r.grade).filter((v): v is number => v != null);
  const pythVals = rankings.map((r) => r.pythPct).filter((v): v is number => v != null);
  const eloRange: [number, number] = [Math.min(...elos), Math.max(...elos)];
  const gradeRange: [number, number] | null = gradeVals.length ? [Math.min(...gradeVals), Math.max(...gradeVals)] : null;
  const pythRange: [number, number] | null = pythVals.length ? [Math.min(...pythVals), Math.max(...pythVals)] : null;
  const normOf = (v: number | null, range: [number, number] | null) =>
    v == null || range == null ? null : range[1] === range[0] ? 0.5 : (v - range[0]) / (range[1] - range[0]);

  const byTeam = indexEloHistoryByTeam(buildEloRatingHistory(scheduleToEloGames(schedule)));
  const game = schedule.find(
    (g) => Number(g.season) === season && Number(g.week) === week && g.game_type === "REG" && (String(g.home_team) === team || String(g.away_team) === team),
  );

  let eloGame: EloGameDetail;
  if (!game) {
    const rating = eloAsOf(byTeam, team, season, week);
    eloGame = {
      played: false,
      opponent: null,
      home: null,
      teamScore: null,
      opponentScore: null,
      preGameElo: rating,
      opponentPreGameElo: rating,
      hfa: ELO_HFA,
      k: ELO_K,
      movMultiplier: null,
      delta: null,
      postGameElo: rating,
    };
  } else {
    const homeTeam = String(game.home_team);
    const awayTeam = String(game.away_team);
    const eloHomePre = eloAsOf(byTeam, homeTeam, season, week - 1);
    const eloAwayPre = eloAsOf(byTeam, awayTeam, season, week - 1);
    const played = game.home_score != null && game.away_score != null;
    const teamIsHome = team === homeTeam;
    const opponent = teamIsHome ? awayTeam : homeTeam;
    let movMultiplier: number | null = null;
    let delta: number | null = null;
    let teamScore: number | null = null;
    let opponentScore: number | null = null;
    let postGameElo = teamIsHome ? eloHomePre : eloAwayPre;
    if (played) {
      const hs = Number(game.home_score);
      const as_ = Number(game.away_score);
      const marginHome = hs - as_;
      const pHome = eloPHome(eloAwayPre, eloHomePre);
      const actualHome = marginHome > 0 ? 1 : marginHome < 0 ? 0 : 0.5;
      const diffWinner = marginHome >= 0 ? eloHomePre + ELO_HFA - eloAwayPre : eloAwayPre - (eloHomePre + ELO_HFA);
      movMultiplier = marginHome === 0 ? 1 : eloMovMultiplier(marginHome, diffWinner);
      const homeDelta = ELO_K * movMultiplier * (actualHome - pHome);
      delta = teamIsHome ? homeDelta : -homeDelta;
      postGameElo = (teamIsHome ? eloHomePre : eloAwayPre) + delta;
      teamScore = teamIsHome ? hs : as_;
      opponentScore = teamIsHome ? as_ : hs;
    }
    eloGame = {
      played,
      opponent,
      home: teamIsHome,
      teamScore,
      opponentScore,
      preGameElo: teamIsHome ? eloHomePre : eloAwayPre,
      opponentPreGameElo: teamIsHome ? eloAwayPre : eloHomePre,
      hfa: ELO_HFA,
      k: ELO_K,
      movMultiplier,
      delta,
      postGameElo,
    };
  }

  const gameByWeek = new Map<number, Row>();
  for (const g of schedule) {
    if (Number(g.season) !== season || g.game_type !== "REG") continue;
    if (String(g.home_team) === team || String(g.away_team) === team) gameByWeek.set(Number(g.week), g);
  }

  const weeklyGrades: WeeklyGradeDetail[] = grades
    .filter((r) => String(r.Team) === team && Number(r.Season) === season && Number(r.Week) <= week && r["Overall Grade"] != null)
    .map((r) => {
      const w = Number(r.Week);
      const g = gameByWeek.get(w);
      const isHome = g ? String(g.home_team) === team : null;
      const opponent = g ? (isHome ? String(g.away_team) : String(g.home_team)) : null;
      const played = !!g && g.home_score != null && g.away_score != null;
      return {
        week: w,
        grade: Number(r["Overall Grade"]),
        opponent,
        home: isHome,
        teamScore: played ? (isHome ? Number(g!.home_score) : Number(g!.away_score)) : null,
        opponentScore: played ? (isHome ? Number(g!.away_score) : Number(g!.home_score)) : null,
      };
    })
    .sort((a, b) => a.week - b.week);

  const weeklyPoints: { week: number; pointsFor: number; pointsAgainst: number }[] = [];
  for (const g of schedule) {
    if (Number(g.season) !== season || g.game_type !== "REG" || Number(g.week) > week) continue;
    if (g.home_score == null || g.away_score == null) continue;
    if (g.home_team === team) weeklyPoints.push({ week: Number(g.week), pointsFor: Number(g.home_score), pointsAgainst: Number(g.away_score) });
    else if (g.away_team === team) weeklyPoints.push({ week: Number(g.week), pointsFor: Number(g.away_score), pointsAgainst: Number(g.home_score) });
  }
  weeklyPoints.sort((a, b) => a.week - b.week);

  const seasonWeeksThrough = [
    ...new Set(schedule.filter((r) => Number(r.season) === season && r.game_type === "REG" && Number(r.week) <= week).map((r) => Number(r.week))),
  ].sort((a, b) => a - b);
  const weeklyComposite: WeeklyCompositeDetail[] = seasonWeeksThrough
    .map((w) => {
      const wkRankings = computePowerRankings(schedule, grades, season, w);
      const teamRow = wkRankings.find((r) => r.team === team);
      if (!teamRow) return null;
      const leagueAvg = wkRankings.reduce((s, r) => s + r.composite, 0) / wkRankings.length;
      return { week: w, composite: teamRow.composite, leagueAvg };
    })
    .filter((p): p is WeeklyCompositeDetail => p != null);

  return {
    team,
    season,
    week,
    composite: row.composite,
    rank: row.rank,
    eloGame,
    eloNorm: normOf(row.elo, eloRange),
    eloRange,
    weeklyGrades,
    gradeAvg: row.grade,
    gradeNorm: normOf(row.grade, gradeRange),
    gradeRange,
    weeklyPoints,
    pointsForTotal: weeklyPoints.reduce((s, p) => s + p.pointsFor, 0),
    pointsAgainstTotal: weeklyPoints.reduce((s, p) => s + p.pointsAgainst, 0),
    pythPct: row.pythPct,
    pythNorm: normOf(row.pythPct, pythRange),
    pythRange,
    weeklyComposite,
  };
}

/** Rank-only trend for one team across every week of the season (for the detail popup's chart). */
export function computeTeamRankTrend(schedule: Row[], grades: Row[], season: number, team: string, weeks: number[]): { week: number; rank: number }[] {
  return weeks
    .map((w) => {
      const row = computePowerRankings(schedule, grades, season, w).find((r) => r.team === team);
      return row ? { week: w, rank: row.rank } : null;
    })
    .filter((p): p is { week: number; rank: number } => p != null);
}
