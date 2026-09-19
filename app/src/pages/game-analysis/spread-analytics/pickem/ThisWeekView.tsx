// Pick'em Recommendations — "This Week" sub-view. Single filter: a REG-season
// week NUMBER, aggregated across every season in the dataset (not a
// season+week pair like the other pickem views). Three sections: how the
// spread has behaved for this week number over the years, how the app's full
// model set has behaved on this week's games (card grid paginated by season,
// newest first — reuses the Matchup Previews game-card/dot-strip design), and
// whether the selected week's actual results correlate with each prior
// week's (expected to fade the further back you go).
import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, CustomSeriesOption, CustomSeriesRenderItemAPI, CustomSeriesRenderItemReturn } from "echarts";
import {
  getSchedule,
  getGrades,
  getPredictiveModelGames,
  getPredictiveModelUpcoming,
  getPredictiveModelUpcomingMeta,
  getTeamWeek,
  type Row,
  type PredictiveModelUpcomingMeta,
} from "../../../../lib/data/loader";
import { Card, Kpi, tableWrapCls, theadCls, trCls, stickyColCls, stickyColHeadCls, scrollHintCls, ScrollHint } from "../../../../components/ui";
import { Select } from "../../../../components/filters/Select";
import { Loading, ErrorRetry, Empty } from "../../../../components/Loading";
import { useECharts } from "../../../../components/charts/useECharts";
import { buildHistogramBins, sturgesBinCount, type HistogramBins } from "../../../../components/charts/histogram";
import { percentile, sampleStd } from "../../../../lib/logic/contributions";
import { pearsonCorrelation, correlationRead } from "../../../../lib/logic/weekHistory";
import { getTeamMetaMap, type TeamMeta } from "../../../../lib/team/meta";
import { TeamLogoLink } from "../../../../components/team/TeamLogoLink";
import { ModelDotStrip, disagreementOf } from "../../previews/ModelDotStrip";
import {
  buildHist,
  buildGradesIndex,
  buildTeamWeekIndex,
  buildScheduleEloIndex,
  buildPredictiveIndex,
  probBundle,
  resultWinner,
  pickWinner,
  pickBgColor,
  kickoffMs,
  MODEL_KEYS,
  MODEL_COLORS,
  type MetricKey,
  type ProbBundle,
} from "../../previews/engine";

const DISAGREEMENT_LOW = 0.1; // pp gap below this = "low" (models mostly agree)
const DISAGREEMENT_HIGH = 0.25; // pp gap above this = "high" (models split hard)

function bucketOfDisagreement(spread: number): "Low (<10pp)" | "Medium (10–25pp)" | "High (>25pp)" {
  if (spread < DISAGREEMENT_LOW) return "Low (<10pp)";
  if (spread <= DISAGREEMENT_HIGH) return "Medium (10–25pp)";
  return "High (>25pp)";
}
const DISAGREEMENT_BUCKETS = ["Low (<10pp)", "Medium (10–25pp)", "High (>25pp)"] as const;

const stepBtnCls =
  "grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-150 hover:text-slate-900 active:scale-90 disabled:opacity-30 disabled:hover:text-slate-500 disabled:active:scale-100";

interface GameModelRow {
  g: Row;
  season: number;
  home: string;
  away: string;
  bundle: ProbBundle;
  nModels: number; // how many non-consensus models had a value for this game
  disagreement: number; // max - min across available models (0 if nModels < 2)
  winner: "home" | "away" | null;
  underdogWon: boolean | null;
}

/** A nicer-looking value-axis histogram bar: gradient fill + rounded top
 * corners. Scoped locally rather than changing the shared
 * `histogramBarSeries()` in components/charts/histogram.ts, which
 * WeeklyTab.tsx/ConfidenceTab.tsx also rely on for their current look. */
function prettyHistogramSeries(bins: HistogramBins, name = "Games"): CustomSeriesOption {
  const { lo, width, counts } = bins;
  const data = counts.map((c, i) => [lo + i * width, lo + (i + 1) * width, c]);
  return {
    name,
    type: "custom",
    renderItem: (_params: unknown, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
      const yValue = api.value(2) as number;
      const start = api.coord([api.value(0) as number, yValue]);
      const size = api.size!([(api.value(1) as number) - (api.value(0) as number), yValue]) as number[];
      const pad = size[0] * 0.08;
      return {
        type: "rect",
        shape: { x: start[0] + pad, y: start[1], width: Math.max(1, size[0] - pad * 2), height: size[1], r: [5, 5, 0, 0] },
        style: api.style(),
      };
    },
    itemStyle: {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "#2459A7" },
        { offset: 1, color: "#9db6e8" },
      ]),
    },
    encode: { x: [0, 1], y: 2, tooltip: [0, 1, 2] },
    data,
  } as CustomSeriesOption;
}

/** Mini version of ModelDotStrip's visual language for an *aggregate* stat:
 * each model's average confidence (probability assigned to whichever side
 * it picked, so always 50–100%) across every game in the selected week,
 * pooled over all seasons. Home/away position isn't meaningful once pooled
 * across many different matchups, so this reframes the same track as
 * "Toss-up → Lock" instead. */
function AvgConfidenceStrip({ avg }: { avg: Partial<Record<MetricKey, number>> }) {
  const entries = MODEL_KEYS.filter(([k]) => avg[k] != null);
  if (!entries.length) return null;
  return (
    <div className="relative mt-5 h-6 w-full max-w-lg rounded-full bg-slate-100">
      <span className="absolute -top-4 left-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">Toss-up</span>
      <span className="absolute -top-4 right-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">Lock</span>
      {entries.map(([k, lbl]) => {
        const conf = avg[k]!;
        const pos = Math.max(0, Math.min(1, (conf - 0.5) / 0.5)) * 100;
        return (
          <span
            key={k}
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${pos}%`, background: MODEL_COLORS[k] }}
            title={`${lbl}: ${Math.round(conf * 100)}% avg. confidence`}
          />
        );
      })}
    </div>
  );
}

/** One game's card: team logos each side (winner gets a colored ring + bold
 * score), a probability bar split by the selected primary model, a pick
 * badge, and the shared ModelDotStrip below. Modeled on Matchup Previews'
 * WeekPreviewTab.tsx card, minus its "view full matchup" overlay/win-type
 * badge (out of scope here). */
function GameCard({
  g,
  bundle,
  primary,
  primaryLabel,
  teamMeta,
}: {
  g: Row;
  bundle: ProbBundle;
  primary: MetricKey;
  primaryLabel: string;
  teamMeta: Map<string, TeamMeta>;
}) {
  const away = String(g.away_team);
  const home = String(g.home_team);
  const [pL, pR] = bundle[primary];
  const leadSide = pickWinner(bundle[primary]);
  const lead = leadSide === "away" ? away : leadSide === "home" ? home : null;
  const conf01 = pL != null && pR != null ? Math.max(0, Math.min(1, 2 * Math.max(pL, pR) - 1)) : 0;
  const actual = resultWinner(g);
  const isCorrect = leadSide != null && actual === leadSide;
  const borderCol = lead === away ? teamMeta.get(away)?.color : lead === home ? teamMeta.get(home)?.color : "#ddd";
  const dateStr = g.gameday
    ? new Date(`${g.gameday}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" })
    : "";
  const played = g.home_score != null && g.away_score != null;

  const logoBlock = (team: string, prob: number | null, score: unknown, isWinner: boolean) => {
    const logo = teamMeta.get(team)?.logo;
    const ringColor = teamMeta.get(team)?.color ?? "#16a34a";
    return (
      <div className="flex-1 text-center">
        <span className="inline-block rounded-full" style={isWinner ? { boxShadow: `0 0 0 3px ${ringColor}, 0 0 0 5px white` } : undefined}>
          {logo ? (
            <TeamLogoLink to={`/game_analysis/team_comparison?team1=${away}&team2=${home}`} logo={logo} alt={team} imgClassName="mx-auto h-11" title={`Compare ${away} vs ${home}`} />
          ) : (
            <div className="font-bold">{team}</div>
          )}
        </span>
        <div className={`mt-1 tabular-nums ${isWinner ? "font-black text-slate-900" : "font-medium text-slate-500"}`}>
          {played ? String(score) : prob != null ? `${Math.round(prob * 100)}%` : "—"}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-sm" style={{ border: `2px solid ${borderCol ?? "#ddd"}` }}>
      <div className="mb-1.5">
        <div className="text-sm font-bold">{dateStr}</div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {away} @ {home}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {logoBlock(away, pL, g.away_score, played && actual === "away")}
        <div className="flex h-4 flex-[2] overflow-hidden rounded-full border border-slate-100">
          <div style={{ width: `${pL != null ? Math.round(100 * pL) : 0}%`, background: teamMeta.get(away)?.color ?? "#888" }} />
          <div style={{ width: `${pR != null ? Math.round(100 * pR) : 0}%`, background: teamMeta.get(home)?.color ?? "#888" }} />
        </div>
        {logoBlock(home, pR, g.home_score, played && actual === "home")}
      </div>
      <div className="relative mt-2 inline-block pr-3">
        <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold text-slate-900" style={{ background: lead ? pickBgColor(conf01) : "#eee" }}>
          Pick: {lead ?? "—"} ({primaryLabel})
        </span>
        {isCorrect && (
          <span className="absolute -right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-[#2CA25F] text-[10px] font-black text-white" title="Correct pick">
            ✓
          </span>
        )}
      </div>
      <div className="pb-3">
        <ModelDotStrip bundle={bundle} away={away} home={home} actual={actual} />
      </div>
    </div>
  );
}

export default function ThisWeekView() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [predGames, setPredGames] = useState<Row[]>([]);
  const [predUpcoming, setPredUpcoming] = useState<Row[]>([]);
  const [upcomingMeta, setUpcomingMeta] = useState<PredictiveModelUpcomingMeta | null>(null);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]>>(new Map());
  const [teamMeta, setTeamMeta] = useState<Map<string, TeamMeta>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamWeekLoaded, setTeamWeekLoaded] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [primary, setPrimary] = useState<MetricKey>("consensus");
  const [sortMode, setSortMode] = useState<"time" | "confidence" | "disagree">("time");

  useEffect(() => {
    setLoadError(null);
    Promise.all([getSchedule(), getGrades(), getPredictiveModelGames(), getPredictiveModelUpcoming(), getPredictiveModelUpcomingMeta()])
      .then(([sch, gr, pg, pu, meta]) => {
        setSchedule(sch);
        setGrades(gr);
        setPredGames(pg);
        setPredUpcoming(pu);
        setUpcomingMeta(meta);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    getTeamMetaMap().then(setTeamMeta);
  }, [retryTick]);

  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => a - b), [reg]);

  // team_week is one file per season — fetch every season once the season
  // list is known. loader.ts caches by path, so this is cheap on re-runs.
  useEffect(() => {
    if (!seasons.length) return;
    setTeamWeekLoaded(false);
    Promise.all(seasons.map((s) => getTeamWeek(s).then((rows) => [s, rows] as const)))
      .then((pairs) => {
        setTeamWeekBySeason(new Map(pairs));
        setTeamWeekLoaded(true);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons.join(",")]);

  const weekOptions = useMemo(() => [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b), [reg]);

  useEffect(() => {
    if (selectedWeek || !weekOptions.length) return;
    if (upcomingMeta?.week != null && upcomingMeta.n_games > 0 && weekOptions.includes(upcomingMeta.week)) {
      setSelectedWeek(String(upcomingMeta.week));
    } else {
      setSelectedWeek(String(weekOptions[0]));
    }
  }, [selectedWeek, weekOptions, upcomingMeta]);

  const selectedWeekNum = Number(selectedWeek);
  const weekSchedRows = useMemo(() => reg.filter((r) => Number(r.week) === selectedWeekNum), [reg, selectedWeekNum]);
  const seasonsCoveredThisWeek = useMemo(() => new Set(weekSchedRows.map((r) => r.season)).size, [weekSchedRows]);

  // ---------- shared prediction engine indices (reused from Matchup Previews) ----------
  const hist = useMemo(() => buildHist(reg), [reg]);
  const gradesIdx = useMemo(() => buildGradesIndex(grades), [grades]);
  const twIdx = useMemo(() => buildTeamWeekIndex(teamWeekBySeason), [teamWeekBySeason]);
  const eloIdx = useMemo(() => buildScheduleEloIndex(reg), [reg]);
  const predIdx = useMemo(() => buildPredictiveIndex([...predGames, ...predUpcoming]), [predGames, predUpcoming]);

  // ---------- Section 1: spread distribution across the years ----------
  const spreads = useMemo(
    () => weekSchedRows.map((r) => (r.spread_line == null ? null : Number(r.spread_line))).filter((v): v is number => v != null && Number.isFinite(v)),
    [weekSchedRows],
  );
  const absSpreads = useMemo(() => spreads.map(Math.abs), [spreads]);
  const spreadStats = useMemo(() => {
    if (!absSpreads.length) return null;
    const mean = absSpreads.reduce((a, b) => a + b, 0) / absSpreads.length;
    const std = sampleStd(absSpreads);
    const q1 = percentile(absSpreads, 25);
    const med = percentile(absSpreads, 50);
    const q3 = percentile(absSpreads, 75);
    return { n: absSpreads.length, mean, std, med, iqr: q3 - q1, min: Math.min(...absSpreads), max: Math.max(...absSpreads) };
  }, [absSpreads]);

  const spreadHistOption = useMemo<EChartsOption | null>(() => {
    if (spreads.length < 2) return null;
    const bins = buildHistogramBins(spreads, sturgesBinCount(spreads.length));
    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const med = percentile(spreads, 50);
    return {
      grid: { left: 44, right: 10, top: 30, bottom: 44, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "value", min: bins.lo, max: bins.hi, name: "Spread (home perspective)", nameLocation: "middle", nameGap: 26, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      yAxis: { type: "value", name: "Games", nameLocation: "middle", nameGap: 30, nameRotate: 90, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      series: [
        prettyHistogramSeries(bins, "Games"),
        {
          name: "Mean",
          type: "line",
          data: [],
          markLine: { symbol: "none", lineStyle: { type: "solid", color: "#002f6c", width: 2 }, label: { formatter: "Mean", color: "#002f6c", fontWeight: "bold" }, data: [{ xAxis: mean }] },
        },
        {
          name: "Median",
          type: "line",
          data: [],
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#E87722", width: 2 }, label: { formatter: "Median", color: "#E87722", fontWeight: "bold" }, data: [{ xAxis: med }] },
        },
      ],
    } as EChartsOption;
  }, [spreads]);

  const spreadBoxOption = useMemo<EChartsOption | null>(() => {
    const bySeason = new Map<number, number[]>();
    for (const r of weekSchedRows) {
      if (r.spread_line == null) continue;
      const s = Number(r.season);
      if (!bySeason.has(s)) bySeason.set(s, []);
      bySeason.get(s)!.push(Math.abs(Number(r.spread_line)));
    }
    const seasonsSorted = [...bySeason.keys()].sort((a, b) => a - b);
    if (!seasonsSorted.length) return null;
    const data = seasonsSorted.map((s) => {
      const v = [...bySeason.get(s)!].sort((a, b) => a - b);
      return [Math.min(...v), percentile(v, 25), percentile(v, 50), percentile(v, 75), Math.max(...v)];
    });
    return {
      grid: { left: 44, right: 10, top: 20, bottom: 44, containLabel: true },
      xAxis: { type: "category", data: seasonsSorted.map(String), name: "Season", nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", name: "|Spread|", nameLocation: "middle", nameGap: 30, nameRotate: 90, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      tooltip: {
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const v = (param as { data: number[] }).data;
          return `Season ${(param as { name: string }).name}<br/>Min: ${v[0].toFixed(1)}<br/>Q1: ${v[1].toFixed(1)}<br/>Median: ${v[2].toFixed(1)}<br/>Q3: ${v[3].toFixed(1)}<br/>Max: ${v[4].toFixed(1)}`;
        },
      },
      series: [{ type: "boxplot", data, itemStyle: { color: "rgba(36,89,167,0.35)", borderColor: "#2459A7", borderWidth: 1.5 } }],
    } as EChartsOption;
  }, [weekSchedRows]);

  const spreadHistRef = useECharts(spreadHistOption);
  const spreadBoxRef = useECharts(spreadBoxOption);

  // ---------- Section 2: all models' behavior for this week's games ----------
  const gameModelRows = useMemo<GameModelRow[]>(() => {
    return weekSchedRows.map((g) => {
      const season = Number(g.season);
      const week = Number(g.week);
      // Always fed a real schedule.json row (has game_id/moneylines/spread) —
      // this is also what makes the live/upcoming week's card show correct
      // Elo and ML-Fair values instead of "—" (previously this view sourced
      // the live week's rows from predictive_model/upcoming.json, which
      // lacks game_id and moneylines entirely).
      const bundle = probBundle(g, season, week, hist, gradesIdx, twIdx, eloIdx, predIdx);
      const nModels = MODEL_KEYS.filter(([k]) => k !== "consensus" && bundle[k][1] != null).length;
      const winner = resultWinner(g);
      const marketHome = bundle.blend[1];
      const underdogWon = winner == null || marketHome == null ? null : marketHome < 0.5 ? winner === "away" : winner === "home";
      return {
        g,
        season,
        home: String(g.home_team),
        away: String(g.away_team),
        bundle,
        nModels,
        disagreement: disagreementOf(bundle),
        winner,
        underdogWon,
      };
    });
  }, [weekSchedRows, hist, gradesIdx, twIdx, eloIdx, predIdx]);

  const section2Kpis = useMemo(() => {
    const withModels = gameModelRows.filter((g) => g.nModels >= 2);
    const nExcluded = gameModelRows.length - withModels.length;
    const avgDisagreement = withModels.length ? withModels.reduce((s, g) => s + g.disagreement, 0) / withModels.length : null;
    const allAgree = withModels.filter((g) => {
      const vals = MODEL_KEYS.filter(([k]) => k !== "consensus")
        .map(([k]) => g.bundle[k][1])
        .filter((p): p is number => p != null);
      return vals.every((p) => p > 0.5) || vals.every((p) => p < 0.5);
    }).length;
    const underdogGames = gameModelRows.filter((g) => g.underdogWon != null);
    const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
    return { n: gameModelRows.length, nExcluded, avgDisagreement, allAgreeRate: withModels.length ? allAgree / withModels.length : null, underdogWinRate };
  }, [gameModelRows]);

  const avgConfidenceByModel = useMemo(() => {
    const out: Partial<Record<MetricKey, number>> = {};
    for (const [key] of MODEL_KEYS) {
      const vals: number[] = [];
      for (const g of gameModelRows) {
        const p = g.bundle[key][1];
        if (p != null) vals.push(Math.max(p, 1 - p));
      }
      if (vals.length) out[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  }, [gameModelRows]);

  // Per-model accuracy across every historical game this week (all seasons) —
  // doubles as the primary-model picker for the card grid below, same pattern
  // as Matchup Previews' WeekPreviewTab.
  const modelAcc = useMemo(() => {
    return MODEL_KEYS.map(([k, lbl]) => {
      let c = 0;
      let n = 0;
      for (const r of gameModelRows) {
        if (r.winner == null) continue;
        const p = r.bundle[k][1];
        if (p == null) continue;
        n++;
        if ((p > 0.5 ? "home" : "away") === r.winner) c++;
      }
      return { key: k, label: lbl, correct: c, total: n };
    });
  }, [gameModelRows]);
  const anyCompleted = modelAcc.some((m) => m.total > 0);
  const primaryLabel = MODEL_KEYS.find(([k]) => k === primary)?.[1] ?? "";

  const disagreementBuckets = useMemo(() => {
    return DISAGREEMENT_BUCKETS.map((label) => {
      const rows = gameModelRows.filter((g) => g.nModels >= 2 && bucketOfDisagreement(g.disagreement) === label);
      const underdogGames = rows.filter((g) => g.underdogWon != null);
      const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
      const acc: Partial<Record<MetricKey, number>> = {};
      for (const [key] of MODEL_KEYS) {
        const withPredAndResult = rows.filter((g) => g.bundle[key][1] != null && g.winner != null);
        if (!withPredAndResult.length) continue;
        const correct = withPredAndResult.filter((g) => (g.bundle[key][1]! > 0.5 ? "home" : "away") === g.winner).length;
        acc[key] = correct / withPredAndResult.length;
      }
      return { label, n: rows.length, underdogWinRate, modelAcc: acc };
    });
  }, [gameModelRows]);

  // Season pager for the card grid — newest season first ("starting with
  // last season"), independent of the week-number filter above.
  const seasonsForWeek = useMemo(() => [...new Set(weekSchedRows.map((r) => Number(r.season)))].sort((a, b) => b - a), [weekSchedRows]);
  useEffect(() => {
    if (selectedSeason && seasonsForWeek.includes(Number(selectedSeason))) return;
    if (seasonsForWeek.length) setSelectedSeason(String(seasonsForWeek[0]));
  }, [seasonsForWeek, selectedSeason]);
  const seasonIdx = seasonsForWeek.indexOf(Number(selectedSeason));
  const stepSeason = (dir: -1 | 1) => {
    // seasonsForWeek is sorted newest-first, so "older" moves the index forward.
    const next = seasonsForWeek[seasonIdx + dir];
    if (next != null) setSelectedSeason(String(next));
  };

  const cardsForSeason = useMemo(() => {
    const rows = gameModelRows
      .filter((r) => r.season === Number(selectedSeason))
      .map((r) => {
        const [pL, pR] = r.bundle[primary];
        const conf = pL != null && pR != null ? Math.max(pL, pR) : -1;
        return { ...r, conf };
      });
    const byTime = (a: (typeof rows)[number], b: (typeof rows)[number]) => kickoffMs(a.g) - kickoffMs(b.g) || String(a.g.game_id).localeCompare(String(b.g.game_id));
    if (sortMode === "confidence") rows.sort((a, b) => b.conf - a.conf || byTime(a, b));
    else if (sortMode === "disagree") rows.sort((a, b) => b.disagreement - a.disagreement || byTime(a, b));
    else rows.sort(byTime);
    return rows;
  }, [gameModelRows, selectedSeason, primary, sortMode]);

  // ---------- Section 3: correlation vs every prior week ----------
  const pairsForWeeks = useMemo(() => {
    return (w: number, target: number): { xs: number[]; ys: number[] } => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const season of seasons) {
        const rows = teamWeekBySeason.get(season) ?? [];
        const wRows = rows.filter((r) => Number(r.week) === w);
        const targetByTeam = new Map(rows.filter((r) => Number(r.week) === target).map((r) => [String(r.team), r]));
        for (const wr of wRows) {
          const tr = targetByTeam.get(String(wr.team));
          if (wr.win == null || !tr || tr.win == null) continue;
          xs.push(Number(wr.win));
          ys.push(Number(tr.win));
        }
      }
      return { xs, ys };
    };
  }, [seasons, teamWeekBySeason]);

  const priorWeekCorr = useMemo(() => {
    if (!teamWeekLoaded || selectedWeekNum <= 1) return [];
    const out: { week: number; lag: number; r: number | null; n: number }[] = [];
    for (let w = selectedWeekNum - 1; w >= 1; w--) {
      const { xs, ys } = pairsForWeeks(w, selectedWeekNum);
      out.push({ week: w, lag: selectedWeekNum - w, r: pearsonCorrelation(xs, ys), n: xs.length });
    }
    return out.reverse(); // chronological, week 1 first
  }, [teamWeekLoaded, selectedWeekNum, pairsForWeeks]);

  const strongestPrior = useMemo(() => {
    const withR = priorWeekCorr.filter((p) => p.r != null);
    if (!withR.length) return null;
    return withR.reduce((best, cur) => (Math.abs(cur.r!) > Math.abs(best.r!) ? cur : best));
  }, [priorWeekCorr]);

  const lastPriorBreakdown = useMemo(() => {
    if (selectedWeekNum <= 1) return null;
    const { xs, ys } = pairsForWeeks(selectedWeekNum - 1, selectedWeekNum);
    if (!xs.length) return null;
    const afterWin = ys.filter((_, i) => xs[i] === 1);
    const afterLoss = ys.filter((_, i) => xs[i] === 0);
    const rate = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return {
      priorWeek: selectedWeekNum - 1,
      n: xs.length,
      baseline: rate(ys),
      afterWin: rate(afterWin),
      afterLoss: rate(afterLoss),
      nAfterWin: afterWin.length,
      nAfterLoss: afterLoss.length,
    };
  }, [selectedWeekNum, pairsForWeeks]);

  // Per-team momentum: does THIS team's result the prior week swing its
  // result this week, more or less than the pooled breakdown above?
  const momentumByTeam = useMemo(() => {
    if (selectedWeekNum <= 1) return [];
    const w = selectedWeekNum - 1;
    const byTeam = new Map<string, { afterWin: number[]; afterLoss: number[] }>();
    for (const season of seasons) {
      const rows = teamWeekBySeason.get(season) ?? [];
      const wRows = rows.filter((r) => Number(r.week) === w);
      const targetByTeam = new Map(rows.filter((r) => Number(r.week) === selectedWeekNum).map((r) => [String(r.team), r]));
      for (const wr of wRows) {
        const team = String(wr.team);
        const tr = targetByTeam.get(team);
        if (wr.win == null || !tr || tr.win == null) continue;
        if (!byTeam.has(team)) byTeam.set(team, { afterWin: [], afterLoss: [] });
        const rec = byTeam.get(team)!;
        (Number(wr.win) === 1 ? rec.afterWin : rec.afterLoss).push(Number(tr.win));
      }
    }
    const rate = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return [...byTeam.entries()]
      .map(([team, rec]) => {
        const afterWinRate = rate(rec.afterWin);
        const afterLossRate = rate(rec.afterLoss);
        const swing = afterWinRate != null && afterLossRate != null ? afterWinRate - afterLossRate : null;
        return { team, afterWinRate, afterLossRate, swing, nWin: rec.afterWin.length, nLoss: rec.afterLoss.length };
      })
      .sort((a, b) => Math.abs(b.swing ?? -1) - Math.abs(a.swing ?? -1));
  }, [selectedWeekNum, seasons, teamWeekBySeason]);

  const corrChartOption = useMemo<EChartsOption | null>(() => {
    if (!priorWeekCorr.length) return null;
    const posGrad = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "#2459A7" },
      { offset: 1, color: "#8fabdc" },
    ]);
    const negGrad = new echarts.graphic.LinearGradient(0, 1, 0, 0, [
      { offset: 0, color: "#C8102E" },
      { offset: 1, color: "#e79aa6" },
    ]);
    return {
      grid: { left: 48, right: 16, top: 20, bottom: 44, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const idx = (param as { dataIndex: number }).dataIndex;
          const row = priorWeekCorr[idx];
          return `Week ${row.week} (${row.lag} back)<br/>r = ${row.r != null ? row.r.toFixed(2) : "—"}<br/>n = ${row.n}`;
        },
      },
      xAxis: { type: "category", data: priorWeekCorr.map((p) => `Wk ${p.week}`), name: "Prior week", nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", min: -1, max: 1, name: "r", nameLocation: "middle", nameGap: 30, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      series: [
        {
          type: "bar",
          barMaxWidth: 40,
          data: priorWeekCorr.map((p) => (p.r == null ? null : +p.r.toFixed(3))),
          itemStyle: { color: (params: { value: number }) => (params.value >= 0 ? posGrad : negGrad), borderRadius: [4, 4, 4, 4] },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [priorWeekCorr]);
  const corrChartRef = useECharts(corrChartOption);

  if (loadError) return <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!reg.length) return <Loading label="Loading schedule…" />;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Week" value={selectedWeek} onChange={setSelectedWeek} options={weekOptions.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <p className="max-w-md text-xs text-slate-500">
            Aggregates every REG-season Week {selectedWeek || "…"} across all {seasonsCoveredThisWeek || 0} seasons of data — not a specific
            season, a look at how this week number has historically played out.
          </p>
        </div>
      </Card>

      {!weekSchedRows.length ? (
        <Empty label="No games for this week yet." />
      ) : (
        <>
          {/* Section 1 */}
          <Card title="Spread distribution over the years" subtitle={`Week ${selectedWeek} across ${seasonsCoveredThisWeek} seasons`}>
            <div className="space-y-4">
              {spreadStats && (
                <div className="flex flex-wrap gap-3">
                  <Kpi label="Games" value={spreadStats.n} sub={`${seasonsCoveredThisWeek} seasons`} />
                  <Kpi label="Avg |Spread|" value={spreadStats.mean.toFixed(1)} />
                  <Kpi label="Median |Spread|" value={spreadStats.med.toFixed(1)} />
                  <Kpi label="Std Dev" value={spreadStats.std.toFixed(1)} />
                  <Kpi label="IQR" value={spreadStats.iqr.toFixed(1)} />
                  <Kpi label="Min / Max" value={`${spreadStats.min.toFixed(1)} / ${spreadStats.max.toFixed(1)}`} />
                </div>
              )}
              {seasonsCoveredThisWeek < 5 && (
                <p className="text-xs text-amber-600">Only {seasonsCoveredThisWeek} season(s) of data for this week — read with caution.</p>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Histogram</h3>
                  <div ref={spreadHistRef} className="h-[340px]" />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Spread by season (box plot)</h3>
                  <div ref={spreadBoxRef} className="h-[340px]" />
                </div>
              </div>
            </div>
          </Card>

          {/* Section 2 */}
          <Card title="Model behavior for this week's games" subtitle="All models the app computes — production regression, market/ML fair, market-calibrated blend, Elo, Pythagorean, Trend Edge, and their consensus average.">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex flex-wrap gap-3">
                  <Kpi label="Games analyzed" value={section2Kpis.n} sub={section2Kpis.nExcluded ? `${section2Kpis.nExcluded} with <2 models` : undefined} />
                  <Kpi label="Avg. disagreement" value={section2Kpis.avgDisagreement != null ? `${(section2Kpis.avgDisagreement * 100).toFixed(1)}pp` : "—"} />
                  <Kpi label="All-models-agree rate" value={section2Kpis.allAgreeRate != null ? `${Math.round(section2Kpis.allAgreeRate * 100)}%` : "—"} />
                  <Kpi label="Underdog win rate" value={section2Kpis.underdogWinRate != null ? `${Math.round(section2Kpis.underdogWinRate * 100)}%` : "—"} sub="vs. market-calibrated favorite" />
                </div>
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Avg. confidence by model</span>
                  <AvgConfidenceStrip avg={avgConfidenceByModel} />
                </div>
              </div>

              {anyCompleted && (
                <div className="flex flex-wrap gap-2">
                  {modelAcc.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setPrimary(m.key)}
                      className={`min-w-28 rounded-2xl border px-2.5 py-1.5 text-left shadow-sm transition-all ${primary === m.key ? "scale-[1.03] ring-2 ring-offset-1" : "opacity-60 hover:opacity-90"}`}
                      style={{
                        borderColor: `${MODEL_COLORS[m.key]}66`,
                        borderTop: `3px solid ${MODEL_COLORS[m.key]}`,
                        background: `${MODEL_COLORS[m.key]}14`,
                        ...(primary === m.key ? { ["--tw-ring-color" as string]: MODEL_COLORS[m.key] } : {}),
                      }}
                      title={`${m.label}: ${m.total ? `${m.correct}/${m.total} correct` : "no results yet"} — click to make it the card's primary model`}
                    >
                      <div className="truncate text-[10px] font-semibold" style={{ color: MODEL_COLORS[m.key] }}>
                        {m.label}
                      </div>
                      <div className="text-base font-bold leading-none tabular-nums text-slate-800">{m.total ? `${m.correct}/${m.total}` : "—"}</div>
                      <div className="text-[10px] text-slate-500">{m.total > 0 ? `${Math.round((100 * m.correct) / m.total)}%` : "no results yet"}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Card order</span>
                  <div className="flex gap-2">
                    {([["time", "Time"], ["confidence", "Highest prob"], ["disagree", "Disagreement"]] as const).map(([m, lbl]) => (
                      <button
                        key={m}
                        onClick={() => setSortMode(m)}
                        className={`rounded-full px-3 py-1.5 text-sm ${sortMode === m ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={stepBtnCls} onClick={() => stepSeason(1)} disabled={seasonIdx < 0 || seasonIdx >= seasonsForWeek.length - 1} title="Older season">
                    ‹
                  </button>
                  <Select label="Season" value={selectedSeason} onChange={setSelectedSeason} options={seasonsForWeek.map((s) => ({ value: String(s), label: String(s) }))} />
                  <button className={stepBtnCls} onClick={() => stepSeason(-1)} disabled={seasonIdx <= 0} title="Newer season">
                    ›
                  </button>
                  <span className="text-xs text-slate-400">
                    {cardsForSeason.length} game{cardsForSeason.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                {cardsForSeason.map((r) => (
                  <GameCard key={String(r.g.game_id)} g={r.g} bundle={r.bundle} primary={primary} primaryLabel={primaryLabel} teamMeta={teamMeta} />
                ))}
                {!cardsForSeason.length && <div className="py-8 text-center text-sm text-slate-400">No games found for this season.</div>}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Does model disagreement predict upsets?</h3>
                <div className={tableWrapCls}>
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead className={theadCls}>
                      <tr>
                        <th className={`px-3 py-2 ${stickyColHeadCls}`}>Disagreement</th>
                        <th className="px-3 py-2 text-right">Games</th>
                        <th className="px-3 py-2 text-right">Underdog win rate</th>
                        {MODEL_KEYS.map(([key, label]) => (
                          <th key={key} className="px-3 py-2 text-right">
                            {label} acc.
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {disagreementBuckets.map((b) => (
                        <tr key={b.label} className={trCls}>
                          <td className={`px-3 py-1.5 font-semibold ${stickyColCls}`}>{b.label}</td>
                          <td className="px-3 py-1.5 text-right">{b.n}</td>
                          <td className="px-3 py-1.5 text-right">{b.underdogWinRate != null ? `${Math.round(b.underdogWinRate * 100)}%` : "—"}</td>
                          {MODEL_KEYS.map(([key]) => (
                            <td key={key} className="px-3 py-1.5 text-right">
                              {b.modelAcc[key] != null ? `${Math.round(b.modelAcc[key]! * 100)}%` : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className={scrollHintCls} />
                  <ScrollHint />
                </div>
              </div>
            </div>
          </Card>

          {/* Section 3 */}
          <Card title="Does a prior week predict this week?" subtitle="Per-team win/loss correlation between the selected week and every prior week, across seasons.">
            {selectedWeekNum <= 1 ? (
              <Empty label="Week 1 has no prior weeks to correlate against." />
            ) : (
              <div className="space-y-4">
                {strongestPrior && (
                  <div className="flex flex-wrap gap-3">
                    <Kpi
                      label="Strongest prior week"
                      value={`Wk ${strongestPrior.week}`}
                      sub={`r = ${strongestPrior.r!.toFixed(2)} · ${correlationRead(strongestPrior.r)} · n=${strongestPrior.n}`}
                    />
                  </div>
                )}
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Correlation by prior week (win/loss)</h3>
                  <div ref={corrChartRef} className="h-[300px]" />
                </div>
                {lastPriorBreakdown && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">
                      Week {lastPriorBreakdown.priorWeek} result vs. Week {selectedWeek} result (n={lastPriorBreakdown.n} team-seasons)
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      <Kpi
                        label={`Win rate in Wk ${selectedWeek} after Wk ${lastPriorBreakdown.priorWeek} win`}
                        value={lastPriorBreakdown.afterWin != null ? `${Math.round(lastPriorBreakdown.afterWin * 100)}%` : "—"}
                        sub={`n=${lastPriorBreakdown.nAfterWin}`}
                      />
                      <Kpi
                        label={`Win rate in Wk ${selectedWeek} after Wk ${lastPriorBreakdown.priorWeek} loss`}
                        value={lastPriorBreakdown.afterLoss != null ? `${Math.round(lastPriorBreakdown.afterLoss * 100)}%` : "—"}
                        sub={`n=${lastPriorBreakdown.nAfterLoss}`}
                      />
                      <Kpi
                        label={`Baseline win rate in Wk ${selectedWeek}`}
                        value={lastPriorBreakdown.baseline != null ? `${Math.round(lastPriorBreakdown.baseline * 100)}%` : "—"}
                      />
                    </div>
                  </div>
                )}
                {momentumByTeam.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">Which teams carry momentum from Week {lastPriorBreakdown?.priorWeek}?</h3>
                    <p className="mb-2 text-xs text-slate-500">Sorted by swing — the gap between a team's Week {selectedWeek} win rate after a Week {lastPriorBreakdown?.priorWeek} win vs. after a loss.</p>
                    <div className={tableWrapCls}>
                      <table className="w-full border-separate border-spacing-0 text-xs">
                        <thead className={theadCls}>
                          <tr>
                            <th className={`px-3 py-2 ${stickyColHeadCls}`}>Team</th>
                            <th className="px-3 py-2 text-right">After win</th>
                            <th className="px-3 py-2 text-right">After loss</th>
                            <th className="px-3 py-2 text-right">Swing</th>
                            <th className="px-3 py-2 text-right">n (W / L)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {momentumByTeam.map((t) => {
                            const logo = teamMeta.get(t.team)?.logo;
                            return (
                              <tr key={t.team} className={trCls}>
                                <td className={`flex items-center gap-2 px-3 py-1.5 font-semibold ${stickyColCls}`}>
                                  {logo && <img src={logo} alt="" className="h-5 w-5 object-contain" />}
                                  {t.team}
                                </td>
                                <td className="px-3 py-1.5 text-right">{t.afterWinRate != null ? `${Math.round(t.afterWinRate * 100)}%` : "—"}</td>
                                <td className="px-3 py-1.5 text-right">{t.afterLossRate != null ? `${Math.round(t.afterLossRate * 100)}%` : "—"}</td>
                                <td className="px-3 py-1.5 text-right font-semibold" style={t.swing != null ? { color: t.swing >= 0 ? "#166534" : "#991b1b" } : undefined}>
                                  {t.swing != null ? `${t.swing >= 0 ? "+" : ""}${Math.round(t.swing * 100)}pp` : "—"}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-400">
                                  {t.nWin} / {t.nLoss}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className={scrollHintCls} />
                      <ScrollHint />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
