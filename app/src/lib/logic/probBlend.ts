// Market-calibrated: bucket history + a minority dose of two market reads that
// are genuinely different from ML Fair (see docs/IMPLEMENTATION_LOG.md).
//
// History: this used to blend the bucket's historical win rate with a
// grades-model probability (60/40, later N-adaptive) — removed after a backtest
// showed pure market history matched or beat that blend. Pure market history was
// then found to be too similar to ML Fair for ensemble purposes (both are just
// "what does the market think"), so a second backtest tested two alternative,
// genuinely different market reads:
//   - Spread-odds vig lean: the juice on each side of the spread bet itself
//     (e.g. away -111 / home +101) reflects real-time market lean, independent
//     of the moneyline. Standalone AUC ~0.54 — weak.
//   - Team-specific ATS trend: each team's own recent against-the-spread cover
//     rate (last 16 played games), vs. the league-wide bucket rate. Standalone
//     AUC ~0.56 — also weak (ATS records are close to random by design).
// A 50/50 blend of those two alone backtested at AUC 0.56 / hit-rate 54% —
// far below pure bucket history's AUC 0.69 / hit-rate 66%. So instead of
// replacing bucket history, they're added as a MARKET_EXTRAS_W-weighted minority
// dose: at MARKET_BUCKET_W=0.85 the backtest showed Brier/hit-rate essentially
// unchanged from pure bucket history while the formula is now measurably
// different from ML Fair. A division-game probability adjustment was also
// tested and dropped: division games showed no meaningful difference in
// favorite win rate historically (65.95% vs 65.06% non-div, well within noise
// for ~1,000 games each) — there was no real signal to attach an adjustment to.

import { fairProbs } from "./moneyline";

export const BIN_SIZE_DEFAULT = 1.0;
export const SIGNED_SPREAD = true;
export const MIN_N_BUCKET = 25;

/** How much a bucket's sample size N earns toward full confidence (1 at N>=MIN_N_BUCKET). */
export function nFactor(n: number): number {
  return Math.min(1, n / MIN_N_BUCKET);
}

/** Confidence % — |p-0.5|*2 scaled by bucket sample size. */
export function confidence(p: number, nBucket: number): number {
  const edge = Math.abs(p - 0.5) * 2;
  return 100 * edge * (0.7 + 0.3 * nFactor(nBucket));
}

// ---------- vig lean + team ATS trend (the "extras") ----------

/** Games of ATS history a team's rolling cover rate looks back over. */
export const ATS_WINDOW = 16;
/** Logistic scale fit by 1D Platt scaling against actual game winners. */
export const VIG_SCALE = -10.15;
export const ATS_SCALE = 0.535;
/** Weight kept on bucket history; the remainder goes to the vig-lean/ATS-trend average. */
export const MARKET_BUCKET_W = 0.85;

/** Vig-free probability the home side covers the spread, from the spread's own odds (not history). */
export function homeCoverFairProb(awaySpreadOdds: number | null, homeSpreadOdds: number | null): number | null {
  return fairProbs(awaySpreadOdds, homeSpreadOdds).homeFair;
}

/** p(home wins) implied by the spread-odds vig lean (logistic). */
export function vigLeanProbHome(homeCoverFair: number | null): number | null {
  if (homeCoverFair == null) return null;
  const lean = homeCoverFair - 0.5;
  return 1 / (1 + Math.exp(-VIG_SCALE * lean));
}

/** p(home wins) implied by each team's recent ATS cover-rate differential (home - away). */
export function atsTrendProbHome(atsDiffHome: number | null): number | null {
  if (atsDiffHome == null) return null;
  return 1 / (1 + Math.exp(-ATS_SCALE * atsDiffHome));
}

/**
 * Final Market-calibrated probability: MARKET_BUCKET_W on the bucket's
 * historical rate, the rest on the average of whichever "extra" signals
 * (vig lean, ATS trend) are available. Falls back to pure bucket history if
 * neither extra is available (missing spread odds or insufficient ATS history).
 */
export function marketCalibratedProbHome(pBucket: number | null, pVigLean: number | null, pAtsTrend: number | null): number | null {
  if (pBucket == null) return null;
  const extras = [pVigLean, pAtsTrend].filter((p): p is number => p != null);
  if (!extras.length) return pBucket;
  const pExtras = extras.reduce((a, b) => a + b, 0) / extras.length;
  return MARKET_BUCKET_W * pBucket + (1 - MARKET_BUCKET_W) * pExtras;
}
