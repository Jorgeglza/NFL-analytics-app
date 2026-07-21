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
