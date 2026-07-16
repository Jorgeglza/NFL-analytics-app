// Rank-bar helpers shared by Team Comparison / Matchup pages.

export const RANK_SQUASH = 0.5;

/** Compress a 0..1 ratio toward 0.5 so rank bars never look absolute. */
export function squashRatio(ratio: number, squash = RANK_SQUASH): number {
  return 0.5 + (ratio - 0.5) * squash;
}

/** Logo scale used by the value-bets rank connector (1 = best rank). */
export function rankLogoScale(rank: number, maxRank = 32): number {
  return 1.2 - ((rank - 1) / (maxRank - 1)) * 0.4;
}

/** Mismatch score: positive = offensive advantage. */
export function mismatchScore(offRank: number, defAllowedRank: number): number {
  return defAllowedRank - offRank;
}

/** Matchup-bets KPI edge variant. */
export function mismatchEdge(offRank: number, defAllowedRank: number, maxRank: number): number {
  return (maxRank - offRank + 1) + defAllowedRank;
}
