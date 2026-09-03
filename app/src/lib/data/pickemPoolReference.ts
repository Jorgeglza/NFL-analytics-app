// Static 2025 Yahoo Pro Football Pick'em pool reference — a frozen one-time
// snapshot from the user's own "Model vs. the Pool" analysis (98 scored
// entrants, TAMPICO2025 group), NOT derived from this app's pipeline. This
// app has no live pool-picks data source, so these numbers can't be
// recomputed or kept current — they exist only as narrative reference points
// for the Pick'em Recommendations Story view. Do not treat as live data, and
// do not extend past the 2025 season without a fresh pool export to back it.
//
// human_best/human_avg/human_min = the pool's top, average, and worst
// correct-pick count that week (out of `games` scored games). Source: the
// artifact's per-week table.
export interface PoolWeek {
  week: number;
  games: number;
  humanBest: number;
  humanAvg: number;
  humanMin: number;
}

export const POOL_REFERENCE_SEASON = 2025;

export const POOL_WEEKLY_2025: PoolWeek[] = [
  { week: 1, games: 16, humanBest: 15, humanAvg: 11.3, humanMin: 8 },
  { week: 2, games: 16, humanBest: 15, humanAvg: 11.6, humanMin: 9 },
  { week: 3, games: 16, humanBest: 14, humanAvg: 10.4, humanMin: 6 },
  { week: 4, games: 16, humanBest: 12, humanAvg: 9.5, humanMin: 0 },
  { week: 5, games: 14, humanBest: 9, humanAvg: 5.7, humanMin: 3 },
  { week: 6, games: 15, humanBest: 12, humanAvg: 9.1, humanMin: 5 },
  { week: 7, games: 15, humanBest: 14, humanAvg: 10.5, humanMin: 0 },
  { week: 8, games: 13, humanBest: 11, humanAvg: 8.3, humanMin: 4 },
  { week: 9, games: 14, humanBest: 11, humanAvg: 8.2, humanMin: 0 },
  { week: 10, games: 14, humanBest: 11, humanAvg: 8.6, humanMin: 3 },
  { week: 11, games: 15, humanBest: 14, humanAvg: 10.4, humanMin: 6 },
  { week: 12, games: 14, humanBest: 13, humanAvg: 10.1, humanMin: 7 },
  { week: 13, games: 16, humanBest: 13, humanAvg: 9.2, humanMin: 0 },
  { week: 14, games: 14, humanBest: 10, humanAvg: 7.3, humanMin: 0 },
  { week: 15, games: 16, humanBest: 13, humanAvg: 9.3, humanMin: 0 },
  { week: 16, games: 16, humanBest: 14, humanAvg: 10.1, humanMin: 0 },
  { week: 17, games: 16, humanBest: 12, humanAvg: 8.3, humanMin: 0 },
  { week: 18, games: 16, humanBest: 13, humanAvg: 9.2, humanMin: 0 },
];

/** Looks up the 2025 reference row for a given week (season not required —
 * this table only covers 2025). Returns null past week 18. */
export function poolWeekReference(week: number): PoolWeek | null {
  return POOL_WEEKLY_2025.find((w) => w.week === week) ?? null;
}

/** Upset-call rate by entrant type: share of that week's upset games (the
 * favorite lost) picked correctly, averaged per week then across the 2025
 * season. Weekly winner(s) vs. pool average vs. the model/market/Elo entrants
 * scored against the same pool — the artifact's core finding that model-style
 * pickers lag human winners specifically on upsets. */
export const UPSET_CALL_RATES_2025 = {
  winner: 0.6092,
  pool: 0.2525,
  model: 0.117,
  market: 0.0745,
  elo: 0.1383,
};

/** Favorite-pick rate: winners take the favorite about as often as the pool
 * at large — riding the favorite isn't where anyone separates. */
export const FAVORITE_PICK_RATE_2025 = { winner: 0.7715, pool: 0.7803 };
