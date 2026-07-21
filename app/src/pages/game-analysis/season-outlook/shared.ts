// Strength of schedule — new analytics (not a port). Average opponent Elo
// rating, split into games already played vs. games remaining. Uses
// buildEloIndex's pre-game ratings directly (leak-free by construction: the
// entry for a given game already stores each side's rating as it stood
// before that game, whether played or not).
import type { Row } from "../../../lib/data/loader";
import { buildEloIndex, scheduleToEloGames } from "../../../lib/logic/elo";

export interface SosRow {
  team: string;
  playedAvg: number | null;
  playedN: number;
  remainingAvg: number | null;
  remainingN: number;
}

export function computeStrengthOfSchedule(schedule: Row[], season: number): SosRow[] {
  const eloIdx = buildEloIndex(scheduleToEloGames(schedule));
  const games = schedule.filter((g) => Number(g.season) === season && g.game_type === "REG");

  const byTeam = new Map<string, { played: number[]; remaining: number[] }>();
  const bump = (team: string, opponentElo: number, played: boolean) => {
    if (!byTeam.has(team)) byTeam.set(team, { played: [], remaining: [] });
    const b = byTeam.get(team)!;
    (played ? b.played : b.remaining).push(opponentElo);
  };

  for (const g of games) {
    const entry = eloIdx.get(String(g.game_id));
    if (!entry) continue;
    const played = g.home_score != null && g.away_score != null;
    bump(String(g.home_team), entry.eloAway, played);
    bump(String(g.away_team), entry.eloHome, played);
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
