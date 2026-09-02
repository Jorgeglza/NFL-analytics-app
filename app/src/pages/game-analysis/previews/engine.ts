// Shared prediction engine for the Matchup Previews tabs — ports of the
// helpers duplicated across week_preview_tab.py / matchup_previews_tab.py /
// model_overview_tab.py. Uses lib/logic for the math.
import type { Row } from "../../../lib/data/loader";
import {
  BIN_SIZE_DEFAULT,
  ATS_WINDOW,
  homeCoverFairProb,
  vigLeanProbHome,
  atsTrendProbHome,
  marketCalibratedProbHome,
} from "../../../lib/logic/probBlend";
import { edgeComposite, meanLastN, EDGE_SCALE, type TrendFeatures } from "../../../lib/logic/edgeComposite";
import { impliedProb, fairProbs } from "../../../lib/logic/moneyline";
import { wilson } from "../../../lib/logic/wilson";
import { buildEloIndex, scheduleToEloGames, type EloEntry } from "../../../lib/logic/elo";
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

export const bucketLabel = (spread: number, binSize = BIN_SIZE_DEFAULT): string => {
  const lo = Math.floor(spread / binSize + 1e-9) * binSize;
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

/** Wilson-centered p̂ + N for a bucket/side, excluding one season-week. */
export function marketRate(hist: HistAgg, bucket: string, favSide: string, exclSeason: number, exclWeek: number): { pHat: number; n: number } | null {
  const key = `${bucket}|${favSide}`;
  const c = hist.counts.get(key);
  if (!c) return null;
  const ex = hist.perWeek.get(`${exclSeason}|${exclWeek}`)?.get(key);
  const n = c.n - (ex?.n ?? 0);
  const wins = c.wins - (ex?.wins ?? 0);
  if (n <= 0) return null;
  return { pHat: wilson(wins / n, n).center, n };
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

// ---------- Elo index over the full schedule ----------
export type EloIndex = Map<string, EloEntry>;

export function buildScheduleEloIndex(schedule: Row[]): EloIndex {
  return buildEloIndex(scheduleToEloGames(schedule));
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

/** week whose median gameday is closest to today (REG only). */
export function defaultWeekNearToday(schedule: Row[], season: number): number | null {
  const byWeek = new Map<number, number[]>();
  for (const g of schedule) {
    if (Number(g.season) !== season || g.game_type !== "REG" || g.gameday == null) continue;
    const t = Date.parse(String(g.gameday));
    if (Number.isNaN(t)) continue;
    const w = Number(g.week);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(t);
  }
  if (!byWeek.size) return null;
  const today = Date.now();
  let best: number | null = null;
  let bestDist = Infinity;
  for (const [w, ts] of byWeek) {
    ts.sort((a, b) => a - b);
    const med = ts.length % 2 ? ts[(ts.length - 1) / 2] : (ts[ts.length / 2 - 1] + ts[ts.length / 2]) / 2;
    const d = Math.abs(med - today);
    if (d < bestDist) {
      bestDist = d;
      best = w;
    }
  }
  return best;
}

export function kickoffMs(g: Row): number {
  const d = g.gameday == null ? NaN : Date.parse(`${g.gameday}T${g.gametime ?? "00:00"}`);
  return Number.isNaN(d) ? Number.MAX_SAFE_INTEGER : d;
}

export { EDGE_SCALE, impliedProb };
