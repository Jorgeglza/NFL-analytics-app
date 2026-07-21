// Shared "what week is it right now" rule (audit: inconsistent week defaults
// across pages). One definition, used by Home (launchpad), Game Picks, and
// Team Comparison (random weekly matchup) so they never disagree.
import type { Row } from "../data/loader";

export interface CurrentWeek {
  season: number;
  week: number;
  games: Row[];
}

/**
 * Latest season in the schedule, and its "current" week: the earliest
 * in-progress week while the season is live, else the last completed
 * regular-season week, else week 1.
 */
export function currentWeek(schedule: Row[]): CurrentWeek | null {
  if (!schedule.length) return null;
  const seasons = [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a);
  const season = seasons[0];
  const cur = schedule.filter((r) => Number(r.season) === season);
  const unplayed = cur.filter((r) => r.home_score == null).map((r) => Number(r.week));
  const playedReg = cur.filter((r) => r.home_score != null && r.game_type === "REG").map((r) => Number(r.week));
  const week = unplayed.length ? Math.min(...unplayed) : playedReg.length ? Math.max(...playedReg) : 1;
  const games = cur.filter((r) => Number(r.week) === week);
  return { season, week, games };
}
