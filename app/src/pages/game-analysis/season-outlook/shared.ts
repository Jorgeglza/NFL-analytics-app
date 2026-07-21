// Strength of schedule — new analytics (not a port). Average opponent Elo
// rating, split into games at/before `throughWeek` (the backtest "as of"
// week — defaults to the current week) vs. games after it. Played games use
// the opponent's actual pre-game rating (leak-free by construction, from
// buildEloIndex's per-game entries). Games after throughWeek use the
// opponent's rating AS OF throughWeek instead — otherwise a later "remaining"
// game's opponent strength would already reflect real results the backtest
// is supposed to not know about yet (same reasoning as playoffSim.ts).
import type { Row } from "../../../lib/data/loader";
import { buildEloIndex, buildEloRatingHistory, scheduleToEloGames } from "../../../lib/logic/elo";
import { indexEloHistoryByTeam, eloAsOf } from "../../../lib/logic/powerRankings";

export interface SosRow {
  team: string;
  playedAvg: number | null;
  playedN: number;
  remainingAvg: number | null;
  remainingN: number;
}

export function computeStrengthOfSchedule(schedule: Row[], season: number, throughWeek: number): SosRow[] {
  const eloIdx = buildEloIndex(scheduleToEloGames(schedule));
  const eloByTeam = indexEloHistoryByTeam(buildEloRatingHistory(scheduleToEloGames(schedule)));
  const games = schedule.filter((g) => Number(g.season) === season && g.game_type === "REG");

  const byTeam = new Map<string, { played: number[]; remaining: number[] }>();
  const bump = (team: string, opponentElo: number, played: boolean) => {
    if (!byTeam.has(team)) byTeam.set(team, { played: [], remaining: [] });
    const b = byTeam.get(team)!;
    (played ? b.played : b.remaining).push(opponentElo);
  };

  for (const g of games) {
    const week = Number(g.week);
    const home = String(g.home_team);
    const away = String(g.away_team);
    if (week <= throughWeek) {
      const entry = eloIdx.get(String(g.game_id));
      if (!entry) continue;
      bump(home, entry.eloAway, true);
      bump(away, entry.eloHome, true);
    } else {
      bump(home, eloAsOf(eloByTeam, away, season, throughWeek), false);
      bump(away, eloAsOf(eloByTeam, home, season, throughWeek), false);
    }
  }

  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  return [...byTeam.entries()]
    .map(([team, { played, remaining }]) => ({
      team,
      playedAvg: avg(played),
      playedN: played.length,
      remainingAvg: avg(remaining),
      remainingN: remaining.length,
    }))
    .sort((a, b) => (b.remainingAvg ?? -Infinity) - (a.remainingAvg ?? -Infinity));
}

// ---------- opponent-difficulty heatmap (whole season, not throughWeek-scoped) ----------

export interface HeatmapCell {
  opponent: string;
  opponentElo: number;
  home: boolean;
}

export interface HeatmapRow {
  team: string;
  avgOpponentElo: number;
  cells: Map<number, HeatmapCell>; // week -> cell
}

export interface HeatmapData {
  weeks: number[];
  rows: HeatmapRow[]; // sorted hardest average schedule first
  eloMin: number;
  eloMax: number;
}

/**
 * Every REG game's opponent for every team, for a teams x weeks grid.
 * Uses buildEloIndex's per-game pre-game ratings directly (leak-free by
 * construction — not throughWeek-scoped, this is a whole-season overview).
 */
export function computeOpponentHeatmap(schedule: Row[], season: number): HeatmapData {
  const eloIdx = buildEloIndex(scheduleToEloGames(schedule));
  const games = schedule.filter((g) => Number(g.season) === season && g.game_type === "REG");
  const weeks = [...new Set(games.map((g) => Number(g.week)))].sort((a, b) => a - b);
  const teams = [...new Set(games.flatMap((g) => [String(g.home_team), String(g.away_team)]))].sort();

  const cellsByTeam = new Map<string, Map<number, HeatmapCell>>(teams.map((t) => [t, new Map()]));
  let eloMin = Infinity;
  let eloMax = -Infinity;

  for (const g of games) {
    const entry = eloIdx.get(String(g.game_id));
    if (!entry) continue;
    const week = Number(g.week);
    const home = String(g.home_team);
    const away = String(g.away_team);
    cellsByTeam.get(home)!.set(week, { opponent: away, opponentElo: entry.eloAway, home: true });
    cellsByTeam.get(away)!.set(week, { opponent: home, opponentElo: entry.eloHome, home: false });
    eloMin = Math.min(eloMin, entry.eloAway, entry.eloHome);
    eloMax = Math.max(eloMax, entry.eloAway, entry.eloHome);
  }

  const rows: HeatmapRow[] = teams
    .map((team) => {
      const cells = cellsByTeam.get(team)!;
      const vals = [...cells.values()].map((c) => c.opponentElo);
      const avgOpponentElo = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { team, avgOpponentElo, cells };
    })
    .sort((a, b) => b.avgOpponentElo - a.avgOpponentElo);

  return {
    weeks,
    rows,
    eloMin: Number.isFinite(eloMin) ? eloMin : 1505,
    eloMax: Number.isFinite(eloMax) ? eloMax : 1505,
  };
}
