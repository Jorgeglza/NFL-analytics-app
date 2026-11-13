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
 *
 * This deliberately reflects the schedule alone, not data availability — the
 * schedule can (and does) list next season before the pipeline has any
 * team_week/grades output for it, and the closest upcoming week is still the
 * right "current week" to show (e.g. Home's banner). Pages that need actual
 * stats fall back on their own when that week/season has no data yet (see
 * TeamComparison/Scorecards' season-fallback effect).
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

/**
 * True when the predictive model's "upcoming" export (refreshed by its own
 * workflow) still points at a week the schedule says is already over —
 * i.e. its week is behind `currentWeek(schedule)`, or every game in it has a
 * score. Happens every Monday night → Tuesday refresh, and for longer when
 * that refresh fails. Callers should then label the block as last week's and
 * default to the schedule's current week instead.
 */
export function isUpcomingStale(
  meta: { season: number | null; week: number | null; n_games: number } | null,
  schedule: Row[],
): boolean {
  if (!meta || !meta.n_games || meta.season == null || meta.week == null) return false;
  const cw = currentWeek(schedule);
  if (!cw) return false;
  if (meta.season < cw.season || (meta.season === cw.season && meta.week < cw.week)) return true;
  const rows = schedule.filter((r) => Number(r.season) === meta.season && Number(r.week) === meta.week);
  return rows.length > 0 && rows.every((r) => r.home_score != null);
}
