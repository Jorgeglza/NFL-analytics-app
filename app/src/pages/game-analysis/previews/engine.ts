// Shared prediction engine for the Matchup Previews tabs — ports of the
// helpers duplicated across week_preview_tab.py / matchup_previews_tab.py /
// model_overview_tab.py. Uses lib/logic for the math.
import type { Row } from "../../../lib/data/loader";
import { gradeModelProb, blendProbs, BIN_SIZE_DEFAULT } from "../../../lib/logic/probBlend";
import { edgeComposite, meanLastN, slopeLastN, EDGE_SCALE, type TrendFeatures } from "../../../lib/logic/edgeComposite";
import { impliedProb, fairProbs } from "../../../lib/logic/moneyline";
import { wilson } from "../../../lib/logic/wilson";
import { buildEloIndex, scheduleToEloGames, type EloEntry } from "../../../lib/logic/elo";
import { pythWinPct, log5 } from "../../../lib/logic/pythagorean";
import { WIN_TYPE_COLORS } from "../../../lib/logic/winType";

export type MetricKey = "consensus" | "blend" | "trend" | "ml" | "elo" | "pyth";
export const MODEL_KEYS: [MetricKey, string][] = [
  ["consensus", "Average"],
  ["blend", "Market-calibrated"],
  ["trend", "Trend Edge"],
  ["ml", "ML Fair"],
  ["elo", "Elo"],
  ["pyth", "Pythagorean"],
];
export const MODEL_COLORS: Record<MetricKey, string> = {
  consensus: "#002f6c",
  blend: "#2459A7",
  trend: "#E87722",
  ml: "#3C9A5F",
  elo: "#7c3aed",
  pyth: "#C8102E",
};

export const favoriteSide = (spread: number | null): "home" | "away" | null =>
  spread == null || Number.isNaN(spread) ? null : spread < 0 ? "home" : spread > 0 ? "away" : null;

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
}

export function buildHist(schedule: Row[]): HistAgg {
  const counts = new Map<string, { n: number; wins: number }>();
  const perWeek = new Map<string, Map<string, { n: number; wins: number }>>();
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
  }
  return { counts, perWeek };
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
      // old code coerces NaN feature means to 0
      return {
        grade: null, // grade passed separately into edgeComposite
        pmL3: meanLastN(col("points_margin"), 3) ?? 0,
        epaL3: meanLastN(col("epa_diff"), 3) ?? 0,
        tomL3: meanLastN(col("turnover_margin"), 3) ?? 0,
        pmSlope: slopeLastN(col("points_margin"), 5) ?? 0,
      };
    },
  };
}

// ---------- Elo index over the full schedule ----------
export type EloIndex = Map<string, EloEntry>;

export function buildScheduleEloIndex(schedule: Row[]): EloIndex {
  return buildEloIndex(scheduleToEloGames(schedule));
}

// ---------- probability bundle ----------
export interface ProbBundle {
  blend: [number | null, number | null]; // (away, home)
  trend: [number | null, number | null];
  ml: [number | null, number | null];
  elo: [number | null, number | null];
  pyth: [number | null, number | null];
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
): ProbBundle {
  const away = String(game.away_team);
  const home = String(game.home_team);
  const spread = game.spread_line == null ? null : Number(game.spread_line);
  const fav = favoriteSide(spread);

  let pMarketHome: number | null = null;
  if (spread != null && fav != null) {
    const m = marketRate(hist, bucketLabel(spread), fav, season, week);
    if (m) pMarketHome = fav === "home" ? m.pHat : 1 - m.pHat;
  }

  const wkPlayed = Math.max(0, week - 1);
  const gAway = gradesIdx.avgOverall(away, season, wkPlayed);
  const gHome = gradesIdx.avgOverall(home, season, wkPlayed);
  const pModelAway = gradeModelProb(gAway, gHome);
  const pModelHome = pModelAway == null ? null : 1 - pModelAway;

  const pHomeBlend = blendProbs(pMarketHome, pModelHome);
  const pAwayBlend = pHomeBlend == null ? null : 1 - pHomeBlend;

  const fa = { ...twIdx.features(away, season, wkPlayed), grade: gAway };
  const fh = { ...twIdx.features(home, season, wkPlayed), grade: gHome };
  const edge = edgeComposite(fa, fh);
  const pAwayTrend = edge.pAway;
  const pHomeTrend = 1 - pAwayTrend;

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

  const nanmean = (vals: (number | null)[]): number | null => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const lm = nanmean([pAwayBlend, pAwayTrend, pAwayMl, pAwayElo, pAwayPyth]);
  const rm = nanmean([pHomeBlend, pHomeTrend, pHomeMl, pHomeElo, pHomePyth]);
  let cons: [number | null, number | null] = [null, null];
  if (lm != null && rm != null && lm + rm > 0) cons = [lm / (lm + rm), rm / (lm + rm)];

  return {
    blend: [pAwayBlend, pHomeBlend],
    trend: [pAwayTrend, pHomeTrend],
    ml: [pAwayMl, pHomeMl],
    elo: [pAwayElo, pHomeElo],
    pyth: [pAwayPyth, pHomePyth],
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
