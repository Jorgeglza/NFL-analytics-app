// Historical spread-bucket win rates and the "recommended pick mix" derivation —
// extracted from spread_win_percentage_page_6.py's port (SpreadWinPct.tsx) so
// Game Picks' "Spread Trend Pick" prefill can reuse the identical calculation
// instead of re-deriving it. Quirks preserved: pick'em games (spread 0) have no
// Favorite; ties are excluded entirely (2026-07-20 deviation from the old app,
// see SpreadWinPct.tsx's header comment).
import type { Row } from "../data/loader";
import { wilson } from "./wilson";
import type { WinType } from "./winType";

export const WIN_TYPE_CATS: WinType[] = ["Favorite home", "Favorite away", "Underdog home", "Underdog away"];

export interface Game {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  spread: number;
  favorite: "home" | "away" | null; // null on pick'em, like the old page
  winner: "home" | "away" | null;
  played: boolean; // both scores present (ties included — excluded downstream via winType == null)
  winType: WinType | null;
  favWin: boolean;
  absSpread: number;
}

export function toGame(r: Row): Game | null {
  if (r.spread_line == null) return null;
  const spread = Number(r.spread_line);
  if (!Number.isFinite(spread)) return null;
  const favorite = spread < 0 ? "home" : spread > 0 ? "away" : null;
  const hs = r.home_score == null ? null : Number(r.home_score);
  const as_ = r.away_score == null ? null : Number(r.away_score);
  const winner = hs == null || as_ == null ? null : hs > as_ ? "home" : as_ > hs ? "away" : null;
  let winType: WinType | null = null;
  if (winner != null && favorite != null) {
    if (winner === favorite) winType = winner === "home" ? "Favorite home" : "Favorite away";
    else winType = winner === "home" ? "Underdog home" : "Underdog away";
  }
  return {
    gameId: String(r.game_id),
    season: Number(r.season),
    week: Number(r.week),
    homeTeam: String(r.home_team),
    awayTeam: String(r.away_team),
    spread,
    favorite,
    winner,
    played: hs != null && as_ != null,
    winType,
    favWin: winner != null && winner === favorite,
    absSpread: Math.abs(spread),
  };
}

// grid-aligned bucket (equivalent to the old floor/ceil pd.cut edges)
export function bucketOf(v: number, binSize: number, signed: boolean): { label: string; lo: number } {
  const base = signed ? v : Math.abs(v);
  const lo = Math.floor(base / binSize + 1e-9) * binSize;
  const frac = Math.abs(binSize - Math.round(binSize)) > 1e-9;
  const fmt = (x: number) => (frac ? x.toFixed(1) : String(Math.round(x)));
  return { label: `${fmt(lo)} to ${fmt(lo + binSize)}`, lo };
}

// bucket|side -> {n, wins} rate key, shared by historicFavRate/computeWeekPicks.
const rateKey = (b: string, side: string) => `${b}|${side}`;

/** Wilson-smoothed favorite win-rate lookup for (bucket, favSide), learned
 * from all REG played non-tie/non-pick'em games *except* one target
 * (season, week) — extracted from computeWeekPicks so other callers (the
 * Weekly Breakdown tab's upset-candidate scoring) can get the identical
 * historic rate without re-deriving it or duplicating the target week's
 * history-exclusion rule. Falls back to the side-wide rate when a bucket has
 * no history of its own. */
export function historicFavRate(reg: Game[], excludeSeason: number, excludeWeek: number, binSize: number, signed: boolean) {
  const histPlayed = reg.filter((g) => !(g.season === excludeSeason && g.week === excludeWeek) && g.played && g.winType != null);

  const rateAgg = new Map<string, { n: number; wins: number }>();
  const sideAgg = new Map<string, { n: number; wins: number }>();
  for (const g of histPlayed) {
    const b = bucketOf(g.spread, binSize, signed).label;
    const side = g.favorite ?? "none";
    const rk = rateKey(b, side);
    if (!rateAgg.has(rk)) rateAgg.set(rk, { n: 0, wins: 0 });
    const r = rateAgg.get(rk)!;
    r.n++;
    if (g.favWin) r.wins++;
    if (!sideAgg.has(side)) sideAgg.set(side, { n: 0, wins: 0 });
    const sr = sideAgg.get(side)!;
    sr.n++;
    if (g.favWin) sr.wins++;
  }
  return (b: string, side: string): number | null => {
    const r = rateAgg.get(rateKey(b, side));
    if (r && r.n > 0) return wilson(r.wins / r.n, r.n).center;
    const sr = sideAgg.get(side);
    if (sr && sr.n > 0) return wilson(sr.wins / sr.n, sr.n).center;
    return null;
  };
}

/** Rank = a game's position within its (season, week) when sorted by
 * |spread| descending (rank 1 = biggest favorite of the week), aggregated
 * across every REG played non-tie/non-pick'em game in `reg` to answer
 * "which rank gets upset most historically." Bye weeks/odd slate sizes mean
 * higher ranks have fewer samples — `n` is returned per rank so low-N ranks
 * can be greyed out the same way the bucket table handles Min N. */
export function computeRankStats(reg: Game[]): { rank: number; n: number; upsets: number; upsetRate: number }[] {
  const byWeek = new Map<string, Game[]>();
  for (const g of reg) {
    if (!g.played || g.winType == null) continue;
    const k = `${g.season}|${g.week}`;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k)!.push(g);
  }
  const agg = new Map<number, { n: number; upsets: number }>();
  for (const games of byWeek.values()) {
    const sorted = [...games].sort((a, b) => b.absSpread - a.absSpread);
    sorted.forEach((g, i) => {
      const rank = i + 1;
      if (!agg.has(rank)) agg.set(rank, { n: 0, upsets: 0 });
      const a = agg.get(rank)!;
      a.n++;
      if (!g.favWin) a.upsets++;
    });
  }
  return [...agg.entries()]
    .map(([rank, { n, upsets }]) => ({ rank, n, upsets, upsetRate: n ? upsets / n : 0 }))
    .sort((a, b) => a.rank - b.rank);
}

/** Computes the recommended-pick mix for one target (season, week) — shared by
 * the single-week "Weekly Picks" table and the rolling backtest on Spread Win %,
 * so both stay numerically identical (same history-exclusion + Wilson-fallback
 * rule). Also reused by Game Picks' "Spread Trend Pick" prefill button. */
export function computeWeekPicks(
  reg: Game[],
  rs: number,
  rw: number,
  binSize: number,
  signed: boolean,
  df: Game[],
  minN: number,
) {
  const weekGames = reg.filter((g) => g.season === rs && g.week === rw);
  if (!weekGames.length) return null;

  const pHatOf = historicFavRate(reg, rs, rw, binSize, signed);

  // N from top filters per (bucket, side)
  const nTop = new Map<string, number>();
  for (const g of df) {
    const kk = rateKey(bucketOf(g.spread, binSize, signed).label, g.favorite ?? "none");
    nTop.set(kk, (nTop.get(kk) ?? 0) + 1);
  }

  const assignable = weekGames
    .filter((g) => g.favorite === "home" || g.favorite === "away")
    .map((g) => {
      const bucket = bucketOf(g.spread, binSize, signed).label;
      const p = pHatOf(bucket, g.favorite!) ?? 0.5;
      return { g, bucket, pHat: p, nTop: nTop.get(rateKey(bucket, g.favorite!)) ?? 0 };
    });
  if (!assignable.length) return { summary: `Week ${rw}, ${rs}: No assignable games with a favorite.`, rows: [], chips: null, record: null };

  let targetFav = Math.round(assignable.reduce((s, a) => s + a.pHat, 0));
  targetFav = Math.max(0, Math.min(targetFav, assignable.length));
  assignable.sort((a, b) => b.pHat - a.pHat || b.nTop - a.nTop);

  const rows = assignable.map((a, i) => {
    const pick = i < targetFav ? "Favorite" : "Underdog";
    const label =
      pick === "Favorite"
        ? a.g.favorite === "home"
          ? "Favorite home"
          : "Favorite away"
        : a.g.favorite === "home"
          ? "Underdog away"
          : "Underdog home";
    const confidence = pick === "Favorite" ? a.pHat : 1 - a.pHat;
    const pickTeam = label.endsWith("home") ? a.g.homeTeam : a.g.awayTeam;
    const actualTeam = a.g.winner == null ? null : a.g.winner === "home" ? a.g.homeTeam : a.g.awayTeam;
    return {
      game: `${a.g.awayTeam} @ ${a.g.homeTeam}`,
      spread: a.g.spread,
      favSide: a.g.favorite!,
      bucket: a.bucket,
      n: a.nTop,
      histFavPct: `${(100 * a.pHat).toFixed(1)}%`,
      reco: label,
      winner: pickTeam,
      actualTeam,
      result: actualTeam == null ? ("pending" as const) : actualTeam === pickTeam ? ("correct" as const) : ("wrong" as const),
      confidence: `${Math.round(100 * confidence)}%`,
      note: a.nTop < minN ? "Low N" : "",
      gameId: a.g.gameId,
    };
  });

  // grade the recommendations against final results (audit: hit-rate tally)
  const graded = rows.filter((r) => r.result !== "pending");
  const correct = graded.filter((r) => r.result === "correct").length;
  const record = graded.length ? { correct, total: graded.length, pct: Math.round((100 * correct) / graded.length) } : null;

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.reco] = (counts[r.reco] ?? 0) + 1;
  const total = rows.length;
  const chips = WIN_TYPE_CATS.map((wt) => ({
    label: wt,
    count: counts[wt] ?? 0,
    pct: total ? ((counts[wt] ?? 0) / total) * 100 : 0,
  }));

  const expectedFav = assignable.reduce((s, a) => s + a.pHat, 0) / assignable.length;
  const favAssigned = Math.min(targetFav, rows.length);
  const summary = `Week ${rw}, ${rs}: Expected favorite share ≈ ${(expectedFav * 100).toFixed(1)}% (target favorites ≈ ${targetFav}/${assignable.length}); Assigned picks → Favorites ${favAssigned}, Underdogs ${assignable.length - favAssigned}.`;
  return { summary, rows, chips, record };
}
