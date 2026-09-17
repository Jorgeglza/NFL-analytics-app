// Shared prediction engine for the Matchup Previews tabs — ports of the
// helpers duplicated across week_preview_tab.py / matchup_previews_tab.py /
// model_overview_tab.py. Uses lib/logic for the math.
import type { Row } from "../../../lib/data/loader";
import {
  BIN_SIZE_DEFAULT,
  ATS_WINDOW,
  MIN_N_BUCKET,
  MAX_BUCKET_WIDEN,
  homeCoverFairProb,
  vigLeanProbHome,
  atsTrendProbHome,
  marketCalibratedProbHome,
} from "../../../lib/logic/probBlend";
import { edgeComposite, meanLastN, EDGE_SCALE, type TrendFeatures } from "../../../lib/logic/edgeComposite";
import { impliedProb, fairProbs } from "../../../lib/logic/moneyline";
import { wilson } from "../../../lib/logic/wilson";
import { buildEloIndex, buildEloRatingHistory, scheduleToEloGames, eloTeamKey, type EloEntry, type EloRatingPoint } from "../../../lib/logic/elo";
import { indexEloHistoryByTeam } from "../../../lib/logic/powerRankings";
import { opponentLabel } from "../../../lib/logic/gameId";
import { pythWinPct, log5 } from "../../../lib/logic/pythagorean";
import { WIN_TYPE_COLORS } from "../../../lib/logic/winType";

export type MetricKey = "consensus" | "blend" | "trend" | "ml" | "elo" | "pyth" | "predictive";
export const MODEL_KEYS: [MetricKey, string][] = [
  ["consensus", "Average"],
  ["ml", "ML Fair"],
  ["blend", "Market-calibrated"],
  ["predictive", "Predictive (margin reg.)"],
  ["elo", "Elo"],
  ["pyth", "Pythagorean"],
  ["trend", "Trend Edge"],
];
export const MODEL_COLORS: Record<MetricKey, string> = {
  consensus: "#002f6c",
  blend: "#2459A7",
  trend: "#E87722",
  ml: "#3C9A5F",
  elo: "#7c3aed",
  pyth: "#C8102E",
  predictive: "#6B7280",
};

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
/** Mix a model color toward black — the selected state of a model picker pill. */
export function darkenColor(hex: string, amount = 0.32): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
/** Mix a model color toward white — the unselected/inactive state of a model picker pill. */
export function lightenColor(hex: string, amount = 0.82): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export const favoriteSide = (spread: number | null): "home" | "away" | null =>
  spread == null || Number.isNaN(spread) ? null : spread < 0 ? "home" : spread > 0 ? "away" : null;

/** Straight-up pick from an (away, home) probability pair — null-safe, ties go to
 * home (pAway >= pHome). Factored out of the identical inline comparisons in
 * WeekPreviewTab/MatchupTab/ModelOverviewTab/ModelPickerTab so every consumer
 * (including the Model Backtest page) shares one implementation. */
export function pickWinner(pAwayHome: readonly [number | null, number | null]): "away" | "home" | null {
  const [pA, pH] = pAwayHome;
  if (pA == null || pH == null) return null;
  return pA >= pH ? "away" : "home";
}

export const resultWinner = (g: Row): "home" | "away" | null => {
  if (g.home_score == null || g.away_score == null) return null;
  const hs = Number(g.home_score);
  const as_ = Number(g.away_score);
  return hs > as_ ? "home" : as_ > hs ? "away" : null;
};

export const bucketLo = (spread: number, binSize = BIN_SIZE_DEFAULT): number => Math.floor(spread / binSize + 1e-9) * binSize;

export const bucketLabel = (spread: number, binSize = BIN_SIZE_DEFAULT): string => {
  const lo = bucketLo(spread, binSize);
  return `${lo.toFixed(1)} to ${(lo + binSize).toFixed(1)}`;
};

// ---------- historical market rate (per bucket & fav side, ties excluded) ----------
export interface HistAgg {
  // key `${bucket}|${side}` -> per-game entries so a (season,week) can be excluded
  counts: Map<string, { n: number; wins: number }>;
  perWeek: Map<string, Map<string, { n: number; wins: number }>>; // `${season}|${week}` -> same-key partial
  // `${team}|${season}` -> ATS cover history sorted by week, for the Market-calibrated extras
  atsByTeamSeason: Map<string, { week: number; covered: number }[]>;
}

export function buildHist(schedule: Row[]): HistAgg {
  const counts = new Map<string, { n: number; wins: number }>();
  const perWeek = new Map<string, Map<string, { n: number; wins: number }>>();
  const atsByTeamSeason = new Map<string, { week: number; covered: number }[]>();
  const pushAts = (team: string, season: number, week: number, covered: number) => {
    const key = `${team}|${season}`;
    if (!atsByTeamSeason.has(key)) atsByTeamSeason.set(key, []);
    atsByTeamSeason.get(key)!.push({ week, covered });
  };
  for (const g of schedule) {
    if (g.game_type !== "REG" || g.spread_line == null) continue;
    const spread = Number(g.spread_line);
    const fav = favoriteSide(spread);
    const winner = resultWinner(g);
    if (winner == null || fav == null) continue; // ties + pick'ems excluded like the old groupby
    const key = `${bucketLabel(spread)}|${fav}`;
    const win = winner === fav ? 1 : 0;
    const c = counts.get(key) ?? { n: 0, wins: 0 };
    c.n++;
    c.wins += win;
    counts.set(key, c);
    const wkKey = `${g.season}|${g.week}`;
    if (!perWeek.has(wkKey)) perWeek.set(wkKey, new Map());
    const pw = perWeek.get(wkKey)!;
    const pc = pw.get(key) ?? { n: 0, wins: 0 };
    pc.n++;
    pc.wins += win;
    pw.set(key, pc);

    const coverMarginHome = Number(g.home_score) - Number(g.away_score) + spread;
    if (coverMarginHome !== 0) {
      const homeCovered = coverMarginHome > 0 ? 1 : 0;
      const season = Number(g.season);
      const week = Number(g.week);
      pushAts(String(g.home_team), season, week, homeCovered);
      pushAts(String(g.away_team), season, week, 1 - homeCovered);
    }
  }
  for (const rows of atsByTeamSeason.values()) rows.sort((a, b) => a.week - b.week);
  return { counts, perWeek, atsByTeamSeason };
}

/** Team's ATS cover rate over its last `n` played games this season, through week `wk`. */
export function atsRate(hist: HistAgg, team: string, season: number, wk: number, n = ATS_WINDOW): number | null {
  const rows = (hist.atsByTeamSeason.get(`${team}|${season}`) ?? []).filter((r) => r.week <= wk);
  const v = rows.slice(-n).map((r) => r.covered);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Raw single-bucket p̂ + N for a bucket/side, excluding one season-week —
 * no widening, just what actually happened in that exact 1-point bucket.
 * `marketRate` sums this across however many neighboring buckets widening
 * needs. */
function singleBucketRate(
  hist: HistAgg,
  label: string,
  favSide: string,
  exclSeason: number,
  exclWeek: number,
): { n: number; wins: number } {
  const key = `${label}|${favSide}`;
  const c = hist.counts.get(key);
  if (!c) return { n: 0, wins: 0 };
  const ex = hist.perWeek.get(`${exclSeason}|${exclWeek}`)?.get(key);
  return { n: c.n - (ex?.n ?? 0), wins: c.wins - (ex?.wins ?? 0) };
}

/** Wilson-centered p̂ + N (plus its 95% CI) for a bucket/side, excluding one
 * season-week. A bucket short of MIN_N_BUCKET games widens outward one
 * bucket-width at a time (±1, then ±2, …binSize), pooling the nearest
 * spread sizes first since favorite win rate moves fairly smoothly with
 * spread — this used to just return null on a thin/empty bucket (silently
 * dropping the whole Market-calibrated blend for it). `widened`/
 * `halfWidthPts` say whether and how far it had to reach; `ciLow`/`ciHigh`
 * are the Wilson 95% interval on the (possibly widened) pooled sample —
 * the direct answer to "how much should I trust this exact number", since
 * a thin bucket's estimate can have the same pHat as a deep one but a much
 * wider interval. */
export function marketRate(
  hist: HistAgg,
  bucket: string,
  favSide: string,
  exclSeason: number,
  exclWeek: number,
  binSize = BIN_SIZE_DEFAULT,
): { pHat: number; n: number; widened: boolean; halfWidthPts: number; ciLow: number; ciHigh: number } | null {
  const lo = parseFloat(bucket);
  if (!Number.isFinite(lo)) return null;

  const acc = { n: 0, wins: 0 };
  const add = (label: string) => {
    const r = singleBucketRate(hist, label, favSide, exclSeason, exclWeek);
    acc.n += r.n;
    acc.wins += r.wins;
  };

  add(bucket);
  let halfWidthPts = 0;
  for (let k = 1; acc.n < MIN_N_BUCKET && k <= MAX_BUCKET_WIDEN; k++) {
    const before = acc.n;
    add(bucketLabel(lo - k * binSize, binSize));
    add(bucketLabel(lo + k * binSize, binSize));
    if (acc.n > before) halfWidthPts = k * binSize;
  }

  if (acc.n <= 0) return null;
  const w = wilson(acc.wins / acc.n, acc.n);
  return { pHat: w.center, n: acc.n, widened: halfWidthPts > 0, halfWidthPts, ciLow: w.low, ciHigh: w.high };
}

export interface BucketWindowPoint {
  lo: number;
  label: string;
  n: number;
  pHat: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  /** true for the game's own bucket. */
  isTarget: boolean;
}

/** Unwidened per-bucket favorite win % + Wilson CI + N across a window of
 * nearby 1-point spread buckets, centered on the game's own bucket — the
 * same shape *and same convention* as Spread Analytics' full "Calibration —
 * favorite win % by spread bucket" chart, just zoomed to the section around
 * this game. Unlike marketRate (which is deliberately one-sided — the
 * Market-calibrated blend treats a home favorite and an away favorite as
 * different bets, since home-field advantage is its own effect on top of
 * spread size), this combines both favSides per bucket, same as the full
 * page's own byBin does: "did the favorite win" is comparable whichever
 * team was favored, so the curve is continuous across the whole spread
 * range. That's what keeps the target bucket centered with real neighbors
 * on both sides — a bucket near the pick'em line (spread flips from a home
 * to an away favorite right at 0) has no games of its *own side* past 0,
 * but the favorite-win-rate curve itself doesn't have that seam. */
export function bucketWindow(
  hist: HistAgg,
  targetSpread: number,
  exclSeason: number,
  exclWeek: number,
  halfWindowPts: number,
  binSize = BIN_SIZE_DEFAULT,
): BucketWindowPoint[] {
  const targetLo = bucketLo(targetSpread, binSize);
  const halfWindow = Math.round(halfWindowPts / binSize);
  const pts: BucketWindowPoint[] = [];
  for (let k = -halfWindow; k <= halfWindow; k++) {
    const lo = targetLo + k * binSize;
    const label = bucketLabel(lo, binSize);
    const home = singleBucketRate(hist, label, "home", exclSeason, exclWeek);
    const away = singleBucketRate(hist, label, "away", exclSeason, exclWeek);
    const n = home.n + away.n;
    const wins = home.wins + away.wins;
    const w = n > 0 ? wilson(wins / n, n) : null;
    pts.push({ lo, label, n, pHat: w?.center ?? null, ciLow: w?.low ?? null, ciHigh: w?.high ?? null, isTarget: k === 0 });
  }
  return pts;
}

// ---------- grades ----------
export type GradeMetric = "Overall Grade" | "Offensive Grade" | "Defensive Grade";

export interface GradesIndex {
  /** avg Overall Grade for team over weeks <= wk (null if none) */
  avgOverall(team: string, season: number, wk: number): number | null;
  /** [ovr, off, def] rounded ints or null over weeks <= wk */
  triple(team: string, season: number, wk: number): [number | null, number | null, number | null];
  /** League rank (1 = best) of a team's season-to-date average grade metric, and league size — same construction as Team Comparison's grade ranks (audit §4/§7: grades shown with no scale context). */
  rank(team: string, season: number, wk: number, metric: GradeMetric): { rank: number; nTeams: number } | null;
}

export function buildGradesIndex(grades: Row[]): GradesIndex {
  const byTeamSeason = new Map<string, Row[]>();
  const teamsBySeason = new Map<number, Set<string>>();
  for (const r of grades) {
    const season = Number(r.Season);
    const team = String(r.Team);
    const k = `${team}|${season}`;
    if (!byTeamSeason.has(k)) byTeamSeason.set(k, []);
    byTeamSeason.get(k)!.push(r);
    if (!teamsBySeason.has(season)) teamsBySeason.set(season, new Set());
    teamsBySeason.get(season)!.add(team);
  }
  for (const rows of byTeamSeason.values()) rows.sort((a, b) => Number(a.Week) - Number(b.Week));
  const avgCol = (team: string, season: number, wk: number, col: string): number | null => {
    const rows = (byTeamSeason.get(`${team}|${season}`) ?? []).filter((r) => Number(r.Week) <= wk && r[col] != null);
    if (!rows.length) return null;
    return rows.reduce((s, r) => s + Number(r[col]), 0) / rows.length;
  };
  return {
    avgOverall: (t, s, w) => avgCol(t, s, w, "Overall Grade"),
    triple: (t, s, w) => {
      const o = avgCol(t, s, w, "Overall Grade");
      const of_ = avgCol(t, s, w, "Offensive Grade");
      const d = avgCol(t, s, w, "Defensive Grade");
      return [o == null ? null : Math.round(o), of_ == null ? null : Math.round(of_), d == null ? null : Math.round(d)];
    },
    rank: (team, season, wk, metric) => {
      const teams = teamsBySeason.get(season);
      if (!teams) return null;
      const avgs = [...teams]
        .map((t) => ({ t, v: avgCol(t, season, wk, metric) }))
        .filter((a): a is { t: string; v: number } => a.v != null)
        .sort((a, b) => b.v - a.v);
      const idx = avgs.findIndex((a) => a.t === team);
      return idx < 0 ? null : { rank: idx + 1, nTeams: avgs.length };
    },
  };
}

// ---------- trend features ----------
export interface TeamWeekIndex {
  rowsFor(team: string, season: number): Row[]; // sorted by week
  features(team: string, season: number, wkInclusive: number): TrendFeatures;
}

export function buildTeamWeekIndex(teamWeekBySeason: Map<number, Row[]>): TeamWeekIndex {
  const cache = new Map<string, Row[]>();
  const rowsFor = (team: string, season: number): Row[] => {
    const k = `${team}|${season}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        (teamWeekBySeason.get(season) ?? [])
          .filter((r) => String(r.team) === team)
          .sort((a, b) => Number(a.week) - Number(b.week)),
      );
    }
    return cache.get(k)!;
  };
  return {
    rowsFor,
    features: (team, season, wk) => {
      const rows = rowsFor(team, season).filter((r) => Number(r.week) <= wk);
      const col = (c: string) => rows.map((r) => Number(r[c])).filter(Number.isFinite);
      // Null (not 0) when a team has no played games yet this season — edgeComposite
      // treats an all-null feature set as "no trend data" and returns pAway=null
      // instead of a misleading 50/50. With 1-5 games played, meanLastN naturally
      // averages over whatever's available rather than requiring the full window.
      return {
        grade: null, // grade passed separately into edgeComposite
        pmL6: meanLastN(col("points_margin"), 6),
        epaL6: meanLastN(col("epa_diff"), 6),
        winL6: meanLastN(col("win"), 6),
        tomL6: meanLastN(col("turnover_margin"), 6),
      };
    },
  };
}

// ---------- Points-margin timeline, for the Pythagorean card's per-game bar chart ----------
// Season-scoped (Pythagorean's inputs — Σpoints/Σpoints_allowed — reset every season, unlike
// Elo's rolling multi-season rating), so unlike alignedEloTimeline there's no cross-season union
// needed: just this one season's played weeks for both teams, up through wkPlayed.
export interface MarginPoint {
  team: string;
  season: number;
  week: number;
  margin: number;
  scored: number;
  allowed: number;
  win: boolean | null;
  /** "@OPP" (away) or "OPP" (home), from opponentLabel(game_id, team). */
  opponent: string;
}

export interface MarginTimelineSlot {
  season: number;
  week: number;
  away: MarginPoint | null;
  home: MarginPoint | null;
}

/** Builds the shared per-week timeline for `awayTeam`/`homeTeam`'s points-margin bar chart —
 * the union of both teams' played weeks this season, through `wkPlayed`. A week only one of them
 * played (an ordinary bye, or — within the postseason — a first-round bye skipping Wild Card
 * weekend while the other team played) is `null` for the side that didn't, the same "real gap,
 * not silently stitched" philosophy as `alignedEloTimeline`. */
export function alignedMarginTimeline(twIdx: TeamWeekIndex, awayTeam: string, homeTeam: string, season: number, wkPlayed: number): MarginTimelineSlot[] {
  const toPoint = (r: Row, team: string): MarginPoint | null => {
    if (r.points == null || r.points_allowed == null) return null;
    return {
      team,
      season: Number(r.season),
      week: Number(r.week),
      scored: Number(r.points),
      allowed: Number(r.points_allowed),
      margin: Number(r.points) - Number(r.points_allowed),
      win: r.win == null ? null : Number(r.win) === 1,
      opponent: opponentLabel(r.game_id == null ? null : String(r.game_id), team),
    };
  };
  const forTeam = (team: string): MarginPoint[] =>
    twIdx
      .rowsFor(team, season)
      .filter((r) => Number(r.week) <= wkPlayed)
      .map((r) => toPoint(r, team))
      .filter((p): p is MarginPoint => p != null);
  const awayArr = forTeam(awayTeam);
  const homeArr = forTeam(homeTeam);
  const awayByWeek = new Map(awayArr.map((p) => [p.week, p]));
  const homeByWeek = new Map(homeArr.map((p) => [p.week, p]));
  const weeks = [...new Set([...awayByWeek.keys(), ...homeByWeek.keys()])].sort((a, b) => a - b);
  return weeks.map((week) => ({ season, week, away: awayByWeek.get(week) ?? null, home: homeByWeek.get(week) ?? null }));
}

// ---------- Elo index over the full schedule ----------
export type EloIndex = Map<string, EloEntry>;

export function buildScheduleEloIndex(schedule: Row[]): EloIndex {
  return buildEloIndex(scheduleToEloGames(schedule));
}

// ---------- Elo rating history, for the per-team sparkline on the Elo card ----------
export type EloHistoryIndex = Map<string, EloRatingPoint[]>;

export function buildScheduleEloHistoryIndex(schedule: Row[]): EloHistoryIndex {
  return indexEloHistoryByTeam(buildEloRatingHistory(scheduleToEloGames(schedule)));
}

/** One "slot" on the shared Elo timeline both teams' sparklines share — a (season, week) that at
 * least one of the two teams actually played, strictly before the previewed matchup. Whichever
 * team didn't play that week (a bye, or — the case that actually prompted this — one team made
 * the playoffs and the other's season simply ended) has `null` there: a real gap in that team's
 * line, not a game that never happened silently stitched next to an unrelated one. */
export interface EloTimelineSlot {
  season: number;
  week: number;
  away: EloRatingPoint | null;
  home: EloRatingPoint | null;
}

/** Builds the shared timeline for `awayTeam`/`homeTeam`'s Elo sparklines: the union of both
 * teams' played weeks strictly before (season, week), trimmed to the last `n` distinct weeks —
 * "distinct weeks", not "n games per team", so a team with fewer games in that window (again,
 * most commonly the non-playoff team next to one that made a run) is genuinely shown with gaps
 * rather than its older games sliding up to fill the count and silently misaligning against the
 * other team's more recent ones. Postseason weeks (WC/DIV/CON/SB) are numbered 19-22 in the
 * source data, sorting naturally after REG's 1-18 within the same season — no separate handling
 * needed for season-boundary ordering. */
export function alignedEloTimeline(
  byTeam: EloHistoryIndex,
  awayTeam: string,
  homeTeam: string,
  season: number,
  week: number,
  n = 17,
): EloTimelineSlot[] {
  const before = (p: EloRatingPoint) => p.season < season || (p.season === season && p.week < week);
  const awayArr = (byTeam.get(eloTeamKey(awayTeam)) ?? []).filter(before);
  const homeArr = (byTeam.get(eloTeamKey(homeTeam)) ?? []).filter(before);
  const slotKey = (p: { season: number; week: number }) => `${p.season}-${p.week}`;
  const awayBySlot = new Map(awayArr.map((p) => [slotKey(p), p]));
  const homeBySlot = new Map(homeArr.map((p) => [slotKey(p), p]));
  const allSlots = new Map<string, { season: number; week: number }>();
  for (const p of [...awayArr, ...homeArr]) allSlots.set(slotKey(p), { season: p.season, week: p.week });
  const sorted = [...allSlots.values()].sort((a, b) => a.season - b.season || a.week - b.week);
  return sorted.slice(-n).map((slot) => ({
    ...slot,
    away: awayBySlot.get(slotKey(slot)) ?? null,
    home: homeBySlot.get(slotKey(slot)) ?? null,
  }));
}

// ---------- predictive model (margin regression) — precomputed lookup ----------
// Reuses app/public/data/predictive_model/games.json (historical, every completed test-season
// game — pipeline/predictive_model/export_page.py) merged with upcoming.json (the single next
// unplayed REG week, refreshed independently — pipeline/predictive_model/export_upcoming.py /
// .github/workflows/predictive-refresh.yml). Both already carry a closed-form home_win_prob per
// game. No feature/model porting to TS: this is a lookup, not a re-implementation. Games not
// covered (seasons before the export's first test season, or any week beyond the one live
// upcoming export) simply have no entry — probBundle resolves that to null, which the consensus
// nanmean already skips. See docs/predictive-model.md / docs/predictive-model-decision.md for
// the research behind the model (still no confirmed edge over the market).
export type PredictiveIndex = Map<string, number>; // key -> home_win_prob

// Coverage summary shown by every consumer's "predictive model" disclaimer footer —
// `upcoming` is only set once export_upcoming.py has produced a real prediction for a game.
export interface PredictiveCoverage {
  min: number;
  max: number;
  upcoming?: { season: number; week: number };
}

export function predictiveKey(season: number | string, week: number | string, awayTeam: string, homeTeam: string): string {
  return `${season}|${week}|${awayTeam}|${homeTeam}`;
}

export function buildPredictiveIndex(rows: Row[]): PredictiveIndex {
  const idx: PredictiveIndex = new Map();
  for (const r of rows) {
    if (r.home_win_prob == null) continue;
    idx.set(predictiveKey(Number(r.season), Number(r.week), String(r.away_team), String(r.home_team)), Number(r.home_win_prob));
  }
  return idx;
}

/** Whether the predictive model's L3 rolling-window features (points margin,
 * EPA, success/explosive rate, etc. — pipeline/predictive_model/features.py)
 * had a full 3-game window on *both* sides for this game. False whenever
 * either team is within its first 3 played weeks of the season — those
 * features still compute (shift(1).rolling(3, min_periods=1)), they just
 * average over however many prior games are actually available (1 or 2)
 * instead of the intended 3. Matchup tab uses this to flag the predicted
 * home win probability with a "*" for exactly this game/matchup, nowhere
 * else — every other page reads the same precomputed prediction without
 * this caveat attached. */
export function predictiveWindowFull(twIdx: TeamWeekIndex, awayTeam: string, homeTeam: string, season: number, week: number): boolean {
  const priorPlayedCount = (team: string) => twIdx.rowsFor(team, season).filter((r) => Number(r.week) < week).length;
  return priorPlayedCount(awayTeam) >= 3 && priorPlayedCount(homeTeam) >= 3;
}

// Per-game feature breakdown, for the Matchup tab's Predictive card ("what's leading to this
// prediction"). Reuses game_features.json (historical — export_page.py) merged with
// upcoming_features.json (the live next week — export_upcoming.py's mirror of the same exact
// linear decomposition, added alongside its prediction so the live pick gets a breakdown too).
export type PredictiveFeaturesIndex = Map<string, Row>;

export function buildPredictiveFeaturesIndex(rows: Row[]): PredictiveFeaturesIndex {
  const idx: PredictiveFeaturesIndex = new Map();
  for (const r of rows) {
    idx.set(predictiveKey(Number(r.season), Number(r.week), String(r.away_team), String(r.home_team)), r);
  }
  return idx;
}

export interface PredictiveDriver {
  /** Representative feature name (for `labelFor`/`describeFeature`) — the plainest member of its family. */
  feature: string;
  /** This concept's exact contribution to the predicted margin, in points, for THIS game —
   *  summed across every collinear family member (see `topPredictiveDrivers`), so it varies
   *  game to game and is safe to read as a real point value, unlike a lone raw coefficient. */
  contrib: number;
  /** How many raw model columns were combined into `contrib` (>1 means transforms/splits folded in). */
  familySize: number;
  /** Home-minus-away diff value the model actually trains on (null for game-context columns). */
  diff: number | null;
  /** Raw per-team values behind the diff, when available (not every feature has a per-team split). */
  home: number | null;
  away: number | null;
}

// A handful of the model's 41 columns are the same underlying signal split several ways (a
// feature alongside its own signed-square/signed-sqrt transform; total EPA diff alongside its
// pass/rush split; overall grade alongside offense/defense and its own transforms). Individually
// their linear coefficients can be huge and near-cancelling (docs/predictive-model-decision.md's
// explicit warning — observed directly during development: BAL had the clearly better raw L3 EPA
// diff for a real game, yet that one column's own coefficient contribution pointed the other
// way). Summed together, a family's contribution reconstructs the concept's real net effect on
// the prediction — the redundant split is exactly what cancels, not the signal — so this is safe
// to show as a real, per-game point value. Listed member names are the *plain* diff_ suffix
// (i.e. with the shared "diff_" and, for context columns, nothing stripped); the first member in
// each list is the representative shown to the user (plainest / most encompassing).
const FEATURE_FAMILIES: { key: string; members: string[] }[] = [
  { key: "elo", members: ["elo", "sq_elo", "sqrt_elo"] },
  { key: "l3_start_field_pos", members: ["l3_start_field_pos", "sq_l3_start_field_pos", "sqrt_l3_start_field_pos"] },
  { key: "l3_start_ep", members: ["l3_start_ep", "sq_l3_start_ep", "sqrt_l3_start_ep"] },
  { key: "cum_overall_grade", members: ["cum_overall_grade", "sq_cum_overall_grade", "sqrt_cum_overall_grade", "cum_offense_grade", "cum_defense_grade"] },
  { key: "l3_epa_diff", members: ["l3_epa_diff", "l3_pass_epa_diff", "l3_rush_epa_diff"] },
];

/** Family key + representative display feature for one raw model column (e.g. "diff_sqrt_elo"
 *  and "diff_elo" both resolve to family key "elo", represented by "diff_elo"). */
function featureFamily(feature: string): { key: string; repr: string } {
  const hadDiff = feature.startsWith("diff_");
  const base = hadDiff ? feature.slice(5) : feature;
  const fam = FEATURE_FAMILIES.find((f) => f.members.includes(base));
  if (!fam) return { key: base, repr: feature };
  return { key: fam.key, repr: hadDiff ? `diff_${fam.key}` : fam.key };
}

/** Reconstructs the predictive model's exact predicted margin (home − away)
 *  from a `PredictiveFeaturesIndex` row: `intercept` plus every feature's own
 *  `_contrib` value sums to exactly the predicted margin (the same linear
 *  decomposition `topPredictiveDrivers` ranks a top-N slice of — this just
 *  sums all of them instead). Used to turn the model's margin, combined with
 *  the market's total line, into a projected final score. */
export function predictedMarginFromFeatures(featureRow: Row | null): number | null {
  if (!featureRow) return null;
  let total = Number(featureRow.intercept ?? 0);
  for (const col of Object.keys(featureRow)) {
    if (col.endsWith("_contrib")) total += Number(featureRow[col] ?? 0);
  }
  return total;
}

/** Top `n` concepts by |contribution| **for this specific game**, families collapsed (see
 *  `FEATURE_FAMILIES`) so the ranking and point values are safe to read at face value and
 *  actually vary per game — unlike ranking by global importance, which is the same fixed list
 *  and percentages for every single matchup. `featureRow` comes from `PredictiveFeaturesIndex`;
 *  the feature-column list is read directly off its own keys (every `..._contrib` column), no
 *  separate feature-list input needed. */
export function topPredictiveDrivers(featureRow: Row | null, n = 5): PredictiveDriver[] {
  if (!featureRow) return [];
  const byFamily = new Map<string, { repr: string; contrib: number; size: number }>();
  for (const col of Object.keys(featureRow)) {
    if (!col.endsWith("_contrib")) continue;
    const feature = col.slice(0, -"_contrib".length);
    const { key, repr } = featureFamily(feature);
    const c = Number(featureRow[col] ?? 0);
    const cur = byFamily.get(key);
    if (cur) {
      cur.contrib += c;
      cur.size += 1;
    } else {
      byFamily.set(key, { repr, contrib: c, size: 1 });
    }
  }
  return [...byFamily.values()]
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .slice(0, n)
    .map(({ repr, contrib, size }) => {
      const homeRaw = featureRow[`${repr}_home`];
      const awayRaw = featureRow[`${repr}_away`];
      const diffRaw = featureRow[repr];
      return {
        feature: repr,
        contrib,
        familySize: size,
        diff: diffRaw == null ? null : Number(diffRaw),
        home: homeRaw == null ? null : Number(homeRaw),
        away: awayRaw == null ? null : Number(awayRaw),
      };
    });
}

/** Shared footer disclaimer wording for every tab that surfaces the predictive model. */
export function predictiveDisclaimer(coverage: PredictiveCoverage | null): string {
  const range = coverage ? `seasons ${coverage.min}–${coverage.max}` : "no seasons";
  const live = coverage?.upcoming ? `, plus a live prediction for Week ${coverage.upcoming.week} (${coverage.upcoming.season})` : "";
  return `⚠ Predictive model: historical (${range})${live}; excluded automatically outside that coverage.`;
}

// ---------- probability bundle ----------
export interface ProbBundle {
  blend: [number | null, number | null]; // (away, home)
  trend: [number | null, number | null];
  ml: [number | null, number | null];
  elo: [number | null, number | null];
  pyth: [number | null, number | null];
  predictive: [number | null, number | null];
  consensus: [number | null, number | null];
}

export function probBundle(
  game: Row,
  season: number,
  week: number,
  hist: HistAgg,
  gradesIdx: GradesIndex,
  twIdx: TeamWeekIndex,
  eloIdx?: EloIndex,
  predIdx?: PredictiveIndex,
): ProbBundle {
  const away = String(game.away_team);
  const home = String(game.home_team);
  const spread = game.spread_line == null ? null : Number(game.spread_line);
  const fav = favoriteSide(spread);

  const wkPlayed = Math.max(0, week - 1);

  // Market-calibrated: mostly the bucket's Wilson-smoothed historical rate, plus
  // a minority dose of spread-odds vig lean + team ATS trend (see probBlend.ts).
  let pMarketHome: number | null = null;
  if (spread != null && fav != null) {
    const m = marketRate(hist, bucketLabel(spread), fav, season, week);
    if (m) pMarketHome = fav === "home" ? m.pHat : 1 - m.pHat;
  }
  const homeCoverFair = homeCoverFairProb(
    game.away_spread_odds == null ? null : Number(game.away_spread_odds),
    game.home_spread_odds == null ? null : Number(game.home_spread_odds),
  );
  const pVigLeanHome = vigLeanProbHome(homeCoverFair);
  const atsHome = atsRate(hist, home, season, wkPlayed);
  const atsAway = atsRate(hist, away, season, wkPlayed);
  const atsDiffHome = atsHome != null && atsAway != null ? atsHome - atsAway : null;
  const pAtsTrendHome = atsTrendProbHome(atsDiffHome);
  const pHomeBlend = marketCalibratedProbHome(pMarketHome, pVigLeanHome, pAtsTrendHome);
  const pAwayBlend = pHomeBlend == null ? null : 1 - pHomeBlend;

  const gAway = gradesIdx.avgOverall(away, season, wkPlayed);
  const gHome = gradesIdx.avgOverall(home, season, wkPlayed);

  const fa = { ...twIdx.features(away, season, wkPlayed), grade: gAway };
  const fh = { ...twIdx.features(home, season, wkPlayed), grade: gHome };
  const edge = edgeComposite(fa, fh);
  const pAwayTrend = edge.pAway;
  const pHomeTrend = pAwayTrend == null ? null : 1 - pAwayTrend;

  const { awayFair, homeFair } = fairProbs(
    game.away_moneyline == null ? null : Number(game.away_moneyline),
    game.home_moneyline == null ? null : Number(game.home_moneyline),
  );
  // vig-free requires both sides, like the old _vig_free
  const pAwayMl = awayFair != null && homeFair != null ? awayFair : null;
  const pHomeMl = awayFair != null && homeFair != null ? homeFair : null;

  // Elo (pre-game ratings; prediction exists even for unplayed games)
  const eloEntry = eloIdx?.get(String(game.game_id));
  const pHomeElo = eloEntry ? eloEntry.pHome : null;
  const pAwayElo = pHomeElo == null ? null : 1 - pHomeElo;

  // Pythagorean expectation through week-1 points for/against, matched via log5
  const pythOf = (team: string): number | null => {
    const rows = twIdx.rowsFor(team, season).filter((r) => Number(r.week) <= wkPlayed && r.points != null && r.points_allowed != null);
    if (!rows.length) return null;
    const pf = rows.reduce((s, r) => s + Number(r.points), 0);
    const pa = rows.reduce((s, r) => s + Number(r.points_allowed), 0);
    return pythWinPct(pf, pa);
  };
  const pythAwayExp = pythOf(away);
  const pythHomeExp = pythOf(home);
  const pAwayPyth = pythAwayExp != null && pythHomeExp != null ? log5(pythAwayExp, pythHomeExp) : null;
  const pHomePyth = pAwayPyth == null ? null : 1 - pAwayPyth;

  // Predictive (margin regression) — precomputed lookup, historical-only (see above).
  const pHomePred = predIdx?.get(predictiveKey(season, week, away, home)) ?? null;
  const pAwayPred = pHomePred == null ? null : 1 - pHomePred;

  const nanmean = (vals: (number | null)[]): number | null => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const lm = nanmean([pAwayBlend, pAwayTrend, pAwayMl, pAwayElo, pAwayPyth, pAwayPred]);
  const rm = nanmean([pHomeBlend, pHomeTrend, pHomeMl, pHomeElo, pHomePyth, pHomePred]);
  let cons: [number | null, number | null] = [null, null];
  if (lm != null && rm != null && lm + rm > 0) cons = [lm / (lm + rm), rm / (lm + rm)];

  return {
    blend: [pAwayBlend, pHomeBlend],
    trend: [pAwayTrend, pHomeTrend],
    ml: [pAwayMl, pHomeMl],
    elo: [pAwayElo, pHomeElo],
    pyth: [pAwayPyth, pHomePyth],
    predictive: [pAwayPred, pHomePred],
    consensus: cons,
  };
}

// ---------- win-type codes ----------
export const WIN_TYPE_CODE_LONG: Record<string, string> = {
  FH: "Favorite home",
  FA: "Favorite away",
  UH: "Underdog home",
  UA: "Underdog away",
};
// Derived from the shared win-type palette (lib/logic/winType.ts) rather than
// a second hardcoded copy keyed by code.
export const WIN_TYPE_CODE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(WIN_TYPE_CODE_LONG).map(([code, long]) => [code, WIN_TYPE_COLORS[long as keyof typeof WIN_TYPE_COLORS]]),
);

export function winTypeCode(favSide: string | null, winningSide: string | null): string | null {
  if (favSide !== "home" && favSide !== "away") return null;
  if (winningSide !== "home" && winningSide !== "away") return null;
  if (favSide === "home" && winningSide === "home") return "FH";
  if (favSide === "away" && winningSide === "away") return "FA";
  if (favSide === "home" && winningSide === "away") return "UA";
  return "UH";
}

/** light yellow -> green background by confidence (0 at 50/50, 1 at 100%). */
export function pickBgColor(conf01: number): string {
  const s = [255, 248, 201];
  const e = [44, 162, 95];
  const t = Math.max(0, Math.min(1, conf01));
  return `#${s.map((v, i) => Math.round(v + (e[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Earliest REG week in `season` with an unplayed game, else the last
 * completed REG week (or 1 if none has been played yet) — same "current
 * week" definition as lib/logic/defaultWeek.ts's currentWeek(), just scoped
 * to a caller-given season instead of always the schedule's latest one.
 * Previously picked the week whose median gameday was closest to *right
 * now*, which put it on the week that had just finished (rather than the
 * upcoming one) for the multi-day gap between one week ending and the next
 * kicking off — exactly the Tue-Thu window this app's own weekly-refresh
 * cron runs in. */
export function defaultWeekNearToday(schedule: Row[], season: number): number | null {
  const reg = schedule.filter((g) => Number(g.season) === season && g.game_type === "REG");
  if (!reg.length) return null;
  const unplayed = reg.filter((g) => g.home_score == null).map((g) => Number(g.week));
  if (unplayed.length) return Math.min(...unplayed);
  const played = reg.filter((g) => g.home_score != null).map((g) => Number(g.week));
  return played.length ? Math.max(...played) : 1;
}

export function kickoffMs(g: Row): number {
  const d = g.gameday == null ? NaN : Date.parse(`${g.gameday}T${g.gametime ?? "00:00"}`);
  return Number.isNaN(d) ? Number.MAX_SAFE_INTEGER : d;
}

export { EDGE_SCALE, impliedProb };
