// Model Backtest — profitability of every prediction sub-model against real
// sportsbook moneyline payout odds, betting straight-up (the outright winner,
// no spread). New logic, not an old-app port: the pick machinery reused here
// (probBundle/pickWinner) already exists for Matchup Previews' Model
// Overview/Model Picker tabs (which answer accuracy only); this module turns
// a pick into real dollar profit against schedule.json's
// away_moneyline/home_moneyline, at a flat unit stake — see
// docs/FUTURE_DEVELOPMENT.md's original scoping and docs/logic-reference.md
// for the payout/ROI formulas.
import type { Row } from "../data/loader";
import { payout } from "./moneyline";
import { eloTeamKey } from "./elo";
import {
  MODEL_KEYS,
  type MetricKey,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
  type EloIndex,
  type PredictiveIndex,
  probBundle,
  pickWinner,
  resultWinner,
  favoriteSide,
  kickoffMs,
} from "../../pages/game-analysis/previews/engine";

/** Flat stake per bet ("1 unit"), confirmed with the user over a compounding
 * bankroll model — isolates pick-quality profitability from bankroll sizing,
 * and keeps every number here easy to hand-verify. */
export const DEFAULT_STAKE = 100;

export interface GameBacktestRow {
  gameId: string;
  season: number;
  week: number;
  kickoff: number;
  away: string;
  home: string;
  key: MetricKey;
  /** The model's straight-up pick, or null if it had no opinion on this game. */
  pick: "away" | "home" | null;
  actual: "away" | "home";
  correct: boolean | null;
  /** The picked side's own moneyline price (not the favorite's — whichever team was bet). */
  ml: number | null;
  stake: number;
  /** null = no bet placed (no pick, or no odds for the picked side). */
  profit: number | null;
  isMarketFavorite: boolean | null;
  /** Model's home-win probability for this game (for calibration), and the actual
   * home-win outcome — independent of which side was "picked". */
  pHome: number | null;
  homeWin: 0 | 1;
}

/**
 * One row per (completed regular-season game × sub-model). Calls `probBundle()`
 * once per game and fans out to `modelKeys.length` rows — never recomputed per
 * model, so this costs the same per-game work as Model Overview/Model Picker.
 */
export function buildGameBacktestRows(
  schedule: Row[],
  hist: HistAgg,
  gradesIdx: GradesIndex,
  twIdx: TeamWeekIndex,
  eloIdx: EloIndex,
  predIdx: PredictiveIndex | undefined,
  stake: number = DEFAULT_STAKE,
  modelKeys: readonly [MetricKey, string][] = MODEL_KEYS,
): GameBacktestRow[] {
  const rows: GameBacktestRow[] = [];
  for (const g of schedule) {
    if (g.game_type !== "REG") continue;
    const actual = resultWinner(g);
    if (actual == null) continue; // completed games only (excludes ties + unplayed)
    const season = Number(g.season);
    const week = Number(g.week);
    const away = String(g.away_team);
    const home = String(g.home_team);
    const spread = g.spread_line == null ? null : Number(g.spread_line);
    const fav = favoriteSide(spread);
    const awayMl = g.away_moneyline == null ? null : Number(g.away_moneyline);
    const homeMl = g.home_moneyline == null ? null : Number(g.home_moneyline);
    const bundle = probBundle(g, season, week, hist, gradesIdx, twIdx, eloIdx, predIdx);
    const gameId = String(g.game_id);
    const kickoff = kickoffMs(g);
    const homeWin: 0 | 1 = actual === "home" ? 1 : 0;
    for (const [key] of modelKeys) {
      const pick = pickWinner(bundle[key]);
      const ml = pick === "away" ? awayMl : pick === "home" ? homeMl : null;
      const correct = pick == null ? null : pick === actual;
      const profit = pick == null || ml == null ? null : payout(ml, stake, pick === actual);
      const [, pHome] = bundle[key];
      rows.push({
        gameId,
        season,
        week,
        kickoff,
        away,
        home,
        key,
        pick,
        actual,
        correct,
        ml,
        stake,
        profit,
        isMarketFavorite: pick == null || fav == null ? null : pick === fav,
        pHome,
        homeWin,
      });
    }
  }
  return rows;
}

export interface BacktestSummary {
  /** Rows with a pick (regardless of odds availability). */
  n: number;
  /** Rows with a pick AND a priceable moneyline — the denominator for profit/ROI. */
  nGraded: number;
  wins: number;
  losses: number;
  accuracy: number | null;
  totalProfit: number | null;
  roi: number | null;
}

export function summarize(rows: GameBacktestRow[]): BacktestSummary {
  const withPick = rows.filter((r) => r.pick != null);
  const wins = withPick.filter((r) => r.correct === true).length;
  const losses = withPick.filter((r) => r.correct === false).length;
  const graded = withPick.filter((r) => r.profit != null);
  const stake = rows[0]?.stake ?? DEFAULT_STAKE;
  const totalProfit = graded.length ? graded.reduce((s, r) => s + (r.profit ?? 0), 0) : null;
  return {
    n: withPick.length,
    nGraded: graded.length,
    wins,
    losses,
    accuracy: withPick.length ? wins / withPick.length : null,
    totalProfit,
    roi: totalProfit != null && graded.length ? totalProfit / (graded.length * stake) : null,
  };
}

export function summarizeByModel(rows: GameBacktestRow[], modelKeys: readonly [MetricKey, string][] = MODEL_KEYS): Map<MetricKey, BacktestSummary> {
  const out = new Map<MetricKey, BacktestSummary>();
  for (const [key] of modelKeys) out.set(key, summarize(rows.filter((r) => r.key === key)));
  return out;
}

export function summarizeBySeason(rows: GameBacktestRow[], key: MetricKey): { season: number; summary: BacktestSummary }[] {
  const modelRows = rows.filter((r) => r.key === key);
  const seasons = Array.from(new Set(modelRows.map((r) => r.season))).sort((a, b) => a - b);
  return seasons.map((season) => ({ season, summary: summarize(modelRows.filter((r) => r.season === season)) }));
}

/** Same season breakdown as `summarizeBySeason`, plus the favorite/underdog split within each
 * season — how many picks that season had this side as the market's pre-game spread favorite,
 * and how the model did in each case. */
export function summarizeBySeasonWithFavorite(
  rows: GameBacktestRow[],
  key: MetricKey,
): { season: number; summary: BacktestSummary; favorite: BacktestSummary; underdog: BacktestSummary }[] {
  const modelRows = rows.filter((r) => r.key === key);
  const seasons = Array.from(new Set(modelRows.map((r) => r.season))).sort((a, b) => a - b);
  return seasons.map((season) => {
    const seasonRows = modelRows.filter((r) => r.season === season);
    return {
      season,
      summary: summarize(seasonRows),
      favorite: summarize(seasonRows.filter((r) => r.isMarketFavorite === true)),
      underdog: summarize(seasonRows.filter((r) => r.isMarketFavorite === false)),
    };
  });
}

/** The team actually bet on (home or away side, whichever the model picked) — null if no pick.
 * Raw schedule code, e.g. a pre-2016 Rams pick returns "STL" — use `canonicalPickedTeamOf` to
 * merge relocated franchises onto their current code. */
export function pickedTeamOf(r: GameBacktestRow): string | null {
  if (r.pick === "away") return r.away;
  if (r.pick === "home") return r.home;
  return null;
}

/** Same as `pickedTeamOf`, but merges relocated franchises onto their current team code (the
 * same `TEAM_ALIAS` map Elo carries ratings across: STL→LA, SD→LAC, OAK→LV) so a team's history
 * rolls up as one continuous team instead of splitting at the relocation. */
export function canonicalPickedTeamOf(r: GameBacktestRow): string | null {
  const t = pickedTeamOf(r);
  return t == null ? null : eloTeamKey(t);
}

/** Credits the picked team (home or away, whichever the model actually bet on), with relocated
 * franchises merged onto their current code (STL→LA, SD→LAC, OAK→LV) — not both teams in the
 * game, only the one side that was wagered on. */
export function summarizeByTeam(rows: GameBacktestRow[], key: MetricKey): { team: string; summary: BacktestSummary }[] {
  const modelRows = rows.filter((r) => r.key === key && r.pick != null);
  const teams = Array.from(new Set(modelRows.map(canonicalPickedTeamOf))).filter((t): t is string => t != null).sort();
  return teams.map((team) => ({ team, summary: summarize(modelRows.filter((r) => canonicalPickedTeamOf(r) === team)) }));
}

export interface FavoriteSplit {
  favorite: BacktestSummary;
  underdog: BacktestSummary;
  /** No spread on record for the game, so favorite/underdog status is unknown. */
  unknown: BacktestSummary;
}

/** Splits a team's (or any) bets by whether the picked side was the market's
 * pre-game spread favorite — answers "does this model do better backing this
 * team as a favorite or as an underdog," and how often each comes up. */
export function summarizeByFavoriteStatus(rows: GameBacktestRow[]): FavoriteSplit {
  return {
    favorite: summarize(rows.filter((r) => r.isMarketFavorite === true)),
    underdog: summarize(rows.filter((r) => r.isMarketFavorite === false)),
    unknown: summarize(rows.filter((r) => r.isMarketFavorite == null)),
  };
}

export interface CumulativePoint {
  gameId: string;
  kickoff: number;
  season: number;
  week: number;
  profit: number;
  cumProfit: number;
  cumBets: number;
}

/** Chronological running profit for one model — the headline "is it
 * profitable" chart. Only graded bets (pick + odds both present) count. */
export function cumulativeProfitSeries(rows: GameBacktestRow[], key: MetricKey): CumulativePoint[] {
  const modelRows = rows
    .filter((r) => r.key === key && r.profit != null)
    .sort((a, b) => a.kickoff - b.kickoff || a.gameId.localeCompare(b.gameId));
  let cum = 0;
  let bets = 0;
  return modelRows.map((r) => {
    cum += r.profit as number;
    bets += 1;
    return { gameId: r.gameId, kickoff: r.kickoff, season: r.season, week: r.week, profit: r.profit as number, cumProfit: cum, cumBets: bets };
  });
}

export interface ReliabilityBucket {
  binLo: number;
  binHi: number;
  n: number;
  meanPredicted: number;
  observedRate: number;
}

/** Reliability-diagram buckets for one model's home-win probability vs the
 * observed home-win rate — same bin convention as
 * pages/predictive-model/shared.ts's `reliabilityBuckets()` (fixed-width
 * bins, `(lo, hi]`), generalized from `home_win_prob` to any `MetricKey`'s
 * bundle probability so this page's Calibration tab can reuse the identical
 * chart shape as the Predictive Model page's Confidence tab. */
export function calibrationBuckets(rows: GameBacktestRow[], key: MetricKey, nBins = 10): ReliabilityBucket[] {
  const graded = rows.filter((r) => r.key === key && r.pHome != null);
  if (!graded.length) return [];
  const edges = Array.from({ length: nBins + 1 }, (_, i) => i / nBins);
  const bucketIndex = (p: number) => Math.max(0, Math.min(nBins - 1, Math.ceil(p * nBins) - 1));
  const bins: { n: number; sumPredicted: number; sumObserved: number }[] = Array.from({ length: nBins }, () => ({ n: 0, sumPredicted: 0, sumObserved: 0 }));
  graded.forEach((r) => {
    const p = r.pHome as number;
    const b = bins[bucketIndex(p)];
    b.n += 1;
    b.sumPredicted += p;
    b.sumObserved += r.homeWin;
  });
  return bins
    .map((b, i) => ({ binLo: edges[i], binHi: edges[i + 1], n: b.n, meanPredicted: b.n ? b.sumPredicted / b.n : 0, observedRate: b.n ? b.sumObserved / b.n : 0 }))
    .filter((b) => b.n > 0);
}
