// Port of spread_win_percentage_page_6.py — favorite win rates by spread bucket,
// calibration / stacked / heatmap / lift charts, details table and Weekly Picks.
// Quirks preserved: pick'em games (spread 0) have no Favorite.
// Deviation from the old page (explicit user request, 2026-07-20, matching the
// Win Types change): ties are excluded entirely from every rate on this page —
// headline KPIs, verdict tiers, category charts/bucket table, and Weekly
// Picks' historical rate all share the same population (`df`/`g.winType != null`).
import { useEffect, useMemo, useState } from "react";
import { getSchedule, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { MultiSelect } from "../../components/filters/MultiSelect";
import { useECharts } from "../../components/charts/useECharts";
import type { EChartsOption } from "echarts";
import { wilson } from "../../lib/logic/wilson";
import { WIN_TYPE_COLORS, CATEGORY_CODES, type WinType } from "../../lib/logic/winType";
import { Loading } from "../../components/Loading";

const WIN_TYPE_CATS: WinType[] = ["Favorite home", "Favorite away", "Underdog home", "Underdog away"];

interface Game {
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

function toGame(r: Row): Game | null {
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
function bucketOf(v: number, binSize: number, signed: boolean): { label: string; lo: number } {
  const base = signed ? v : Math.abs(v);
  const lo = Math.floor(base / binSize + 1e-9) * binSize;
  const frac = Math.abs(binSize - Math.round(binSize)) > 1e-9;
  const fmt = (x: number) => (frac ? x.toFixed(1) : String(Math.round(x)));
  return { label: `${fmt(lo)} to ${fmt(lo + binSize)}`, lo };
}

const fmtPct0 = (x: number | null) => (x == null || Number.isNaN(x) ? "N/A" : `${x.toFixed(0)}%`);

function median(values: number[]): number | null {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function kpis(games: Game[]) {
  const played = games.filter((g) => g.played);
  if (!played.length) return { favOverall: "N/A", favHome: "N/A", favAway: "N/A", udSmall: "N/A", medAbs: "N/A", n: "0" };
  const mean = (arr: Game[], f: (g: Game) => boolean) => (arr.length ? (arr.filter(f).length / arr.length) * 100 : null);
  const favH = played.filter((g) => g.favorite === "home");
  const favA = played.filter((g) => g.favorite === "away");
  const small = played.filter((g) => g.absSpread <= 3);
  const med = median(played.map((g) => g.absSpread));
  return {
    favOverall: fmtPct0(mean(played, (g) => g.favWin)),
    favHome: fmtPct0(favH.length ? mean(favH, (g) => g.favWin) : null),
    favAway: fmtPct0(favA.length ? mean(favA, (g) => g.favWin) : null),
    udSmall: fmtPct0(small.length ? mean(small, (g) => !g.favWin) : null),
    medAbs: med == null ? "N/A" : med.toFixed(1),
    n: played.length.toLocaleString(),
  };
}

interface BinRow {
  bucket: string;
  lo: number;
  N: number;
  favWins: number;
  udWins: number;
  p: number;
  ciLow: number;
  ciHigh: number;
  seasonMin: number;
  seasonMax: number;
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="min-w-36 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" style={{ borderTop: "3px solid #002f6c" }}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{title}</div>
      <div className="text-[22px] font-bold text-slate-900">{value}</div>
    </div>
  );
}

function Box({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {title && <div className="mb-2 text-sm font-semibold text-slate-700">{title}</div>}
      {children}
    </div>
  );
}

export default function SpreadWinPct() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [seasonsSel, setSeasonsSel] = useState<string[]>([]);
  const [weeksSel, setWeeksSel] = useState<string[]>([]);
  const [winTypes, setWinTypes] = useState<WinType[]>([...WIN_TYPE_CATS]);
  const [binSize, setBinSize] = useState(1.0);
  const [signed, setSigned] = useState(true);
  const [minN, setMinN] = useState(10);
  const [showCi, setShowCi] = useState(true);
  const [recoSeason, setRecoSeason] = useState("");
  const [recoWeek, setRecoWeek] = useState("");
  const [mixView, setMixView] = useState<"stacked" | "heatmap">("stacked");

  useEffect(() => {
    getSchedule().then((rows) => {
      setSchedule(rows);
      const reg = rows.filter((r) => r.game_type === "REG");
      const seasons = [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => a - b);
      const weeks = [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b);
      if (seasons.length) {
        const latest = seasons[seasons.length - 1];
        setSeasonsSel([String(latest)]);
        setWeeksSel(weeks.map(String));
        setRecoSeason(String(latest));
        const wks = reg.filter((r) => Number(r.season) === latest).map((r) => Number(r.week));
        setRecoWeek(String(Math.max(...wks)));
      }
    });
  }, []);

  const reg = useMemo(
    () => schedule.filter((r) => r.game_type === "REG").map(toGame).filter((g): g is Game => g != null),
    [schedule],
  );
  const allSeasons = useMemo(() => [...new Set(reg.map((g) => g.season))].sort((a, b) => a - b), [reg]);
  const allWeeks = useMemo(() => [...new Set(reg.map((g) => g.week))].sort((a, b) => a - b), [reg]);
  const recoWeeks = useMemo(
    () => [...new Set(reg.filter((g) => g.season === Number(recoSeason)).map((g) => g.week))].sort((a, b) => a - b),
    [reg, recoSeason],
  );

  // base = season/week filters (fallback to all when nothing selected, like the old page)
  const base = useMemo(() => {
    const ss = seasonsSel.length ? seasonsSel.map(Number) : allSeasons;
    const ws = weeksSel.length ? weeksSel.map(Number) : allWeeks;
    return reg.filter((g) => ss.includes(g.season) && ws.includes(g.week));
  }, [reg, seasonsSel, weeksSel, allSeasons, allWeeks]);

  // df = played games with a real win-type category (excludes ties and
  // pick'ems, which have no category) — feeds both the category-based charts
  // (calibration/heatmap/stacked/lift, bucket table) and the headline KPIs.
  // 2026-07-20: ties get their own category on Win Types and are excluded
  // entirely from every rate here (previously counted as a favorite loss).
  const df = useMemo(() => {
    const wts = winTypes.length ? winTypes : WIN_TYPE_CATS;
    return base.filter((g) => g.played && g.winType != null && wts.includes(g.winType));
  }, [base, winTypes]);

  const k = useMemo(() => kpis(df.length ? df : base), [df, base]);

  // ---------- verdict: tiered spread trend + plain-language recommendation ----------
  // Uses all played, non-tie, non-pick'em games in the season/week selection —
  // ignores the win-type filter so the verdict always reflects the full slate.
  const verdict = useMemo(() => {
    const played = base.filter((g) => g.played && g.winType != null);
    if (played.length < 30) return null;
    const mk = (label: string, short: string, games: Game[]) => {
      const n = games.length;
      const w = games.filter((g) => g.favWin).length;
      return { label, short, n, p: n ? w / n : null, ci: n ? wilson(w / n, n) : null };
    };
    const tiers = [
      mk("Small favorites — |spread| ≤ 3", "≤3", played.filter((g) => g.absSpread <= 3)),
      mk("Mid favorites — 3.5 to 6.5", "3.5–6.5", played.filter((g) => g.absSpread > 3 && g.absSpread < 7)),
      mk("Big favorites — 7+", "7+", played.filter((g) => g.absSpread >= 7)),
    ];
    const [small, mid, big] = tiers;
    const lines: string[] = [];
    if (big.p != null && small.p != null) {
      const rising = big.p > (mid.p ?? big.p) - 0.02 && (mid.p ?? 0) > small.p - 0.02;
      lines.push(
        rising
          ? `Favorite reliability rises with spread size: ${(100 * small.p).toFixed(0)}% at ≤3 points → ${(100 * (mid.p ?? 0)).toFixed(0)}% at 3.5–6.5 → ${(100 * big.p).toFixed(0)}% at 7+.`
          : `Favorite reliability does NOT rise cleanly with spread size in this selection (${(100 * small.p).toFixed(0)}% / ${(100 * (mid.p ?? 0)).toFixed(0)}% / ${(100 * big.p).toFixed(0)}%).`,
      );
      if (small.p < 0.58) lines.push(`Small favorites are close to a coin flip (${(100 * small.p).toFixed(0)}%) — underdog value historically lives in the ≤3 range.`);
      else lines.push(`Even small favorites have been solid here (${(100 * small.p).toFixed(0)}%).`);
      if (big.p >= 0.66) lines.push(`Backing 7+ point favorites straight-up has been the safest play (${(100 * big.p).toFixed(0)}% over ${big.n.toLocaleString()} games).`);
      else if (big.p < 0.6) lines.push(`Caution: big favorites underperform in this selection (${(100 * big.p).toFixed(0)}%).`);
    }
    return { tiers, lines, n: played.length };
  }, [base]);

  const byBin = useMemo<BinRow[]>(() => {
    const m = new Map<string, { lo: number; games: Game[] }>();
    for (const g of df) {
      const b = bucketOf(g.spread, binSize, signed);
      if (!m.has(b.label)) m.set(b.label, { lo: b.lo, games: [] });
      m.get(b.label)!.games.push(g);
    }
    return [...m.entries()]
      .map(([bucket, { lo, games }]) => {
        const N = games.length;
        const favWins = games.filter((g) => g.favWin).length;
        const p = favWins / N;
        const w = wilson(p, N);
        return {
          bucket,
          lo,
          N,
          favWins,
          udWins: N - favWins,
          p,
          ciLow: w.low,
          ciHigh: w.high,
          seasonMin: Math.min(...games.map((g) => g.season)),
          seasonMax: Math.max(...games.map((g) => g.season)),
        };
      })
      .sort((a, b) => a.lo - b.lo);
  }, [df, binSize, signed]);

  const chartBins = useMemo(() => byBin.filter((b) => b.N >= minN), [byBin, minN]);

  const calOption = useMemo(() => {
    if (!chartBins.length) return null;
    const x = chartBins.map((b) => b.bucket);
    return {
      grid: { left: 10, right: 15, top: 30, bottom: 10, containLabel: true },
      tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${Number(v).toFixed(1)}%` },
      legend: { top: 0, data: ["Favorite win %"] },
      xAxis: { type: "category" as const, data: x, name: "Spread bucket", nameLocation: "middle" as const, nameGap: 30, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: "value" as const, min: 0, max: 100, name: "Favorite win %" },
      series: [
        ...(showCi
          ? [
              { name: "ci_low", type: "line" as const, data: chartBins.map((b) => +(100 * b.ciLow).toFixed(1)), stack: "ci", lineStyle: { opacity: 0 }, symbol: "none", tooltip: { show: false } },
              { name: "ci_band", type: "line" as const, data: chartBins.map((b) => +(100 * (b.ciHigh - b.ciLow)).toFixed(1)), stack: "ci", lineStyle: { opacity: 0 }, symbol: "none", areaStyle: { color: "rgba(100,100,100,0.15)" }, tooltip: { show: false } },
            ]
          : []),
        {
          name: "Favorite win %",
          type: "line" as const,
          data: chartBins.map((b) => +(100 * b.p).toFixed(1)),
          symbolSize: 7,
          lineStyle: { width: 2 },
          itemStyle: { color: "#2459A7" },
        },
      ],
    };
  }, [chartBins, showCi]);

  const { stackedOption, heatOption } = useMemo(() => {
    if (!chartBins.length) return { stackedOption: null, heatOption: null };
    const x = chartBins.map((b) => b.bucket);
    const counts = new Map<string, number>(); // bucket|wt
    for (const g of df) {
      const b = bucketOf(g.spread, binSize, signed).label;
      if (!chartBins.some((cb) => cb.bucket === b)) continue;
      counts.set(`${b}|${g.winType}`, (counts.get(`${b}|${g.winType}`) ?? 0) + 1);
    }
    const totalOf = (b: string) => WIN_TYPE_CATS.reduce((s, wt) => s + (counts.get(`${b}|${wt}`) ?? 0), 0);

    const stackedOption = {
      grid: { left: 10, right: 10, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { seriesName: string; name: string; value: number }) => {
          const cnt = counts.get(`${p.name}|${p.seriesName}`) ?? 0;
          return `Bucket=${p.name}<br/>Win Type=${p.seriesName}<br/>Share=${Math.round(p.value)}%<br/>N (bucket)=${totalOf(p.name).toLocaleString()}<br/>Count (this type)=${cnt.toLocaleString()}`;
        },
      },
      xAxis: { type: "category" as const, data: x, name: "Spread bucket", nameLocation: "middle" as const, nameGap: 30, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: "value" as const, min: 0, max: 100, name: "% of outcomes" },
      series: WIN_TYPE_CATS.map((wt) => ({
        name: wt,
        type: "bar" as const,
        stack: "pct",
        itemStyle: { color: WIN_TYPE_COLORS[wt] },
        label: {
          show: true,
          fontSize: 10,
          color: "#000",
          formatter: (p: { value?: unknown }) => (Number(p.value) >= 5 ? `${CATEGORY_CODES[wt]} ${Math.round(Number(p.value))}%` : ""),
        },
        data: x.map((b) => {
          const t = totalOf(b);
          return t ? +(((counts.get(`${b}|${wt}`) ?? 0) / t) * 100).toFixed(2) : 0;
        }),
      })),
    };

    const heatData: [number, number, number][] = [];
    x.forEach((b, xi) => {
      const t = totalOf(b);
      WIN_TYPE_CATS.forEach((wt, yi) => {
        heatData.push([xi, yi, t ? +(((counts.get(`${b}|${wt}`) ?? 0) / t) * 100).toFixed(0) : 0]);
      });
    });
    const heatOption = {
      grid: { left: 10, right: 70, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: { value: [number, number, number] }) =>
          `Type=${WIN_TYPE_CATS[p.value[1]]}<br/>Bucket=${x[p.value[0]]}<br/>%=${p.value[2]}`,
      },
      xAxis: { type: "category" as const, data: x, name: "Spread bucket", nameLocation: "middle" as const, nameGap: 30, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: "category" as const, data: WIN_TYPE_CATS },
      visualMap: {
        min: 0,
        max: 100,
        right: 0,
        top: "center",
        calculable: false,
        text: ["%", ""],
        inRange: { color: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"] }, // YlOrRd
      },
      series: [{ type: "heatmap" as const, data: heatData }],
    };
    return { stackedOption, heatOption };
  }, [chartBins, df, binSize, signed]);

  const liftOption = useMemo(() => {
    if (!df.length) return null;
    const maxAbs = Math.max(...df.map((g) => g.absSpread));
    const thresholds: number[] = [];
    for (let t = 0; t <= maxAbs + 1e-9; t += 0.5) thresholds.push(+t.toFixed(1));
    const rows = thresholds.map((t) => {
      const sub = df.filter((g) => g.absSpread >= t);
      return { t, acc: sub.length ? (sub.filter((g) => g.favWin).length / sub.length) * 100 : null, n: sub.length };
    });
    const baseline = (df.filter((g) => g.favWin).length / df.length) * 100;
    return {
      grid: { left: 10, right: 45, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" as const },
      xAxis: { type: "category" as const, data: thresholds.map(String), name: "Threshold on |spread|", nameLocation: "middle" as const, nameGap: 26 },
      yAxis: [
        { type: "value" as const, min: 0, max: 100, name: "Hit rate %" },
        { type: "value" as const, name: "Games N", splitLine: { show: false } },
      ],
      series: [
        { name: "Hit rate (favorite)", type: "line" as const, data: rows.map((r) => (r.acc == null ? null : +r.acc.toFixed(1))), symbolSize: 6, itemStyle: { color: "#2459A7" } },
        { name: "Baseline", type: "line" as const, data: rows.map(() => +baseline.toFixed(1)), symbol: "none", lineStyle: { type: "dashed" as const }, itemStyle: { color: "#E87722" } },
        { name: "N (games)", type: "bar" as const, yAxisIndex: 1, data: rows.map((r) => r.n), itemStyle: { color: "rgba(100,100,100,0.35)" } },
      ],
    };
  }, [df]);

  // ============ Weekly Picks (full-week mix) ============
  const reco = useMemo(() => {
    if (!recoSeason || !recoWeek || !reg.length) return null;
    const rs = Number(recoSeason);
    const rw = Number(recoWeek);
    const weekGames = reg.filter((g) => g.season === rs && g.week === rw);
    if (!weekGames.length) return null;

    // history: all REG games with scores except the selected week, ties and
    // pick'ems excluded — same population as `df`/the headline KPIs above, so
    // Weekly Picks' implied rate always matches what the KPIs show for that bucket.
    const histPlayed = reg.filter((g) => !(g.season === rs && g.week === rw) && g.played && g.winType != null);

    // p̂ per (bucket, favSide) with Wilson center; side-wide fallback
    const rateKey = (b: string, side: string) => `${b}|${side}`;
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
    const pHatOf = (b: string, side: string): number | null => {
      const r = rateAgg.get(rateKey(b, side));
      if (r && r.n > 0) return wilson(r.wins / r.n, r.n).center;
      const sr = sideAgg.get(side);
      if (sr && sr.n > 0) return wilson(sr.wins / sr.n, sr.n).center;
      return null;
    };

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
  }, [reg, recoSeason, recoWeek, binSize, signed, df, minN]);

  const calRef = useECharts(calOption);
  const stackedRef = useECharts(stackedOption as EChartsOption | null);
  const heatRef = useECharts(heatOption as EChartsOption | null);
  const liftRef = useECharts(liftOption);

  if (!schedule.length) return <Loading label="Loading schedule…" />;

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Win % by Win Type &amp; Spread</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <MultiSelect label="Season" values={seasonsSel} options={allSeasons.map((s) => ({ value: String(s), label: String(s) }))} onChange={setSeasonsSel} />
        <MultiSelect label="Week" values={weeksSel} options={allWeeks.map((w) => ({ value: String(w), label: String(w) }))} onChange={setWeeksSel} />
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Win Types
          <div className="flex flex-wrap gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
            {WIN_TYPE_CATS.map((wt) => (
              <label key={wt} className="flex items-center gap-1 text-sm font-normal normal-case tracking-normal text-slate-800">
                <input
                  type="checkbox"
                  checked={winTypes.includes(wt)}
                  onChange={() =>
                    setWinTypes((cur) => (cur.includes(wt) ? cur.filter((x) => x !== wt) : [...cur, wt]))
                  }
                />
                {wt}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400" title="Width of each spread bucket in points. Smaller bins = finer curve but fewer games per bin.">
          Bin size ⓘ
          <div className="flex gap-2">
            {[0.5, 1, 2].map((b) => (
              <button key={b} onClick={() => setBinSize(b)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${binSize === b ? "bg-[#002f6c] text-white shadow-sm" : "bg-white text-slate-600 border border-slate-300"}`}>
                {b}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400" title="Signed keeps home favorites (negative) and away favorites (positive) in separate buckets; Absolute pools them by spread size only.">
          Spread mode ⓘ
          <div className="flex gap-2">
            {(["Signed", "Absolute"] as const).map((m) => (
              <button key={m} onClick={() => setSigned(m === "Signed")} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${(m === "Signed") === signed ? "bg-[#002f6c] text-white shadow-sm" : "bg-white text-slate-600 border border-slate-300"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400" title="Buckets with fewer games than this are hidden from charts and greyed in the table — tiny samples are noise, not signal.">
          Min N per bin ⓘ
          <input type="number" min={1} step={1} value={minN} onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))} className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700" title="Shades a 95% Wilson confidence band around each bucket's favorite win % — wider band = less certain estimate.">
          <input type="checkbox" checked={showCi} onChange={(e) => setShowCi(e.target.checked)} />
          Show CI (Calibration) ⓘ
        </label>
      </div>

      {/* Verdict — the takeaway, before the evidence */}
      {verdict && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ borderTop: "4px solid #002f6c" }}>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
            <div className="min-w-64 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">What the spread trend says ({verdict.n.toLocaleString()} games in selection)</div>
              <ul className="mt-1.5 space-y-1 text-sm text-slate-700">
                {verdict.lines.map((l, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-[#002f6c]">▸</span>
                    {l}
                  </li>
                ))}
              </ul>
              <button
                className="mt-2 rounded-full border border-[#002f6c]/30 px-3 py-1 text-xs font-semibold text-[#002f6c] transition-colors hover:bg-[#002f6c]/5"
                onClick={() => document.getElementById("weekly-picks")?.scrollIntoView({ block: "start" })}
              >
                Apply to a week — see recommended picks ↓
              </button>
            </div>
            <div className="flex gap-3">
              {verdict.tiers.map((t) => (
                <div key={t.short} className="w-28 rounded-xl border border-slate-200 px-2 py-2 text-center" title={`${t.label}: ${t.n.toLocaleString()} games${t.ci ? ` — 95% CI ${(100 * t.ci.low).toFixed(0)}–${(100 * t.ci.high).toFixed(0)}%` : ""}`}>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Fav {t.short}</div>
                  <div className={`text-xl font-bold tabular-nums ${t.p != null && t.p >= 0.62 ? "text-[#3C9A5F]" : t.p != null && t.p < 0.55 ? "text-[#C8102E]" : "text-slate-800"}`}>
                    {t.p == null ? "—" : `${(100 * t.p).toFixed(0)}%`}
                  </div>
                  <div className="text-[10px] text-slate-400">{t.n.toLocaleString()} gms</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="flex flex-wrap gap-3">
        <Kpi title="Favorite win % (overall)" value={k.favOverall} />
        <Kpi title="Fav home %" value={k.favHome} />
        <Kpi title="Fav away %" value={k.favAway} />
        <Kpi title="Underdog win % (|spread|≤3)" value={k.udSmall} />
        <Kpi title="Median |spread|" value={k.medAbs} />
        <Kpi title="Games (N)" value={k.n} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Box title="Calibration — favorite win % by spread bucket">
          {chartBins.length ? <div ref={calRef} className="h-[420px]" /> : <div className="grid h-[420px] place-items-center text-sm text-slate-400">No bins meet Min N</div>}
        </Box>
        <Box title="Lift — favorite hit rate vs |spread| threshold">
          {liftOption ? <div ref={liftRef} className="h-[420px]" /> : <div className="grid h-[420px] place-items-center text-sm text-slate-400">No data</div>}
        </Box>
      </div>
      <Box>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">Outcome mix by bucket — which win types make up each spread range</div>
          <div className="flex rounded-full border border-slate-200 bg-slate-100 p-0.5">
            {([["stacked", "Stacked"], ["heatmap", "Heatmap"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setMixView(v)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${mixView === v ? "bg-[#002f6c] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {mixView === "stacked" ? (
          stackedOption ? <div ref={stackedRef} className="h-[380px]" /> : <div className="grid h-[380px] place-items-center text-sm text-slate-400">No bins meet Min N</div>
        ) : heatOption ? (
          <div ref={heatRef} className="h-[380px]" />
        ) : (
          <div className="grid h-[380px] place-items-center text-sm text-slate-400">No bins meet Min N</div>
        )}
      </Box>

      {/* Details table */}
      <Box title="Bucket details (all bins — greyed rows below Min N)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                {["Bucket", "N", "Fav wins", "Fav win %", "Underdog wins", "CI low", "CI high", "Season span"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byBin.map((b) => (
                <tr key={b.bucket} className={`border-t border-slate-100 ${b.N < minN ? "bg-slate-200/60 font-semibold" : ""}`}>
                  <td className="px-3 py-1.5">{b.bucket}</td>
                  <td className="px-3 py-1.5">{b.N}</td>
                  <td className="px-3 py-1.5">{b.favWins}</td>
                  <td className="px-3 py-1.5">{(100 * b.p).toFixed(1)}%</td>
                  <td className="px-3 py-1.5">{b.udWins}</td>
                  <td className="px-3 py-1.5">{(100 * b.ciLow).toFixed(1)}%</td>
                  <td className="px-3 py-1.5">{(100 * b.ciHigh).toFixed(1)}%</td>
                  <td className="px-3 py-1.5">{b.seasonMin === b.seasonMax ? b.seasonMin : `${b.seasonMin}–${b.seasonMax}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>

      {/* Weekly Picks */}
      <div id="weekly-picks" className="scroll-mt-16">
      <Box title="Weekly Picks (full-week mix)">
        <p className="mb-3 text-xs text-slate-500">
          This panel <span className="font-semibold">applies</span> the historical bucket rates to one target week. The Season/Week here choose the week being
          predicted — the filters at the top of the page choose the <span className="font-semibold">historical population</span> the rates are learned from
          (the target week itself is always excluded from its own history).
        </p>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-4">
            <Select label="Season" value={recoSeason} onChange={(v) => setRecoSeason(v)} options={allSeasons.map((s) => ({ value: String(s), label: String(s) }))} />
            <Select label="Week" value={recoWeek} onChange={setRecoWeek} options={recoWeeks.map((w) => ({ value: String(w), label: String(w) }))} />
            {reco?.record && (
              <div className="flex items-center gap-1.5 self-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm" title="How these recommendations scored against final results">
                <span className="uppercase tracking-wider text-slate-400">Graded</span>
                <span className="text-[#3C9A5F]">{reco.record.correct}✓</span>
                <span className="text-[#C8102E]">{reco.record.total - reco.record.correct}✗</span>
                <span className="text-slate-600">({reco.record.pct}%)</span>
              </div>
            )}
          </div>
          {reco?.chips && (
            <div className="flex flex-wrap gap-2">
              {reco.chips.map((c) => (
                <div key={c.label} className="min-w-32 rounded-2xl px-3 py-2 text-white shadow-sm" style={{ background: WIN_TYPE_COLORS[c.label as WinType] }}>
                  <div className="text-[11px] opacity-90">{c.label}</div>
                  <div className="text-lg font-bold leading-none">{c.count}</div>
                  <div className="text-[11px] opacity-90">{c.pct.toFixed(0)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {reco?.summary && <div className="mb-2 text-xs text-slate-600">{reco.summary}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                {["Game", "Spread", "Fav side", "Bucket", "N", "Hist Fav %", "Recommended Pick", "Pick (team)", "Result", "Confidence %", "Note"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(reco?.rows ?? []).map((r) => (
                <tr key={r.gameId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-medium">{r.game}</td>
                  <td className="px-3 py-1.5">{r.spread}</td>
                  <td className="px-3 py-1.5">{r.favSide}</td>
                  <td className="px-3 py-1.5">{r.bucket}</td>
                  <td className="px-3 py-1.5">{r.n}</td>
                  <td className="px-3 py-1.5">{r.histFavPct}</td>
                  <td className="px-3 py-1.5">
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: WIN_TYPE_COLORS[r.reco as WinType] }}>
                      {r.reco}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{r.winner}</td>
                  <td className="px-3 py-1.5">
                    {r.result === "pending" ? (
                      <span className="text-slate-400">—</span>
                    ) : r.result === "correct" ? (
                      <span className="font-bold text-[#3C9A5F]" title={`Winner: ${r.actualTeam}`}>✓</span>
                    ) : (
                      <span className="font-bold text-[#C8102E]" title={`Winner: ${r.actualTeam}`}>✗ {r.actualTeam}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{r.confidence}</td>
                  <td className="px-3 py-1.5 text-amber-600">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      </div>
    </div>
  );
}
