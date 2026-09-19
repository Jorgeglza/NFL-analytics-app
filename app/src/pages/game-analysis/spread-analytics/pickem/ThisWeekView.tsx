// Pick'em Recommendations — "This Week" sub-view. Single filter: a REG-season
// week NUMBER, aggregated across every season in the dataset (not a
// season+week pair like the other pickem views). Three sections: how the
// spread has behaved for this week number over the years, how the app's full
// model set has behaved on this week's games (and whether disagreement among
// them signals upsets), and whether the selected week's actual results
// correlate with each prior week's (expected to fade the further back you go).
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
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
import { Card, Kpi, tableWrapCls, theadCls, trCls, scrollHintCls, ScrollHint } from "../../../../components/ui";
import { Select } from "../../../../components/filters/Select";
import { Loading, ErrorRetry, Empty } from "../../../../components/Loading";
import { useECharts } from "../../../../components/charts/useECharts";
import { buildHistogramBins, histogramBarSeries, sturgesBinCount } from "../../../../components/charts/histogram";
import { percentile, sampleStd } from "../../../../lib/logic/contributions";
import { pearsonCorrelation, correlationRead } from "../../../../lib/logic/weekHistory";
import {
  buildHist,
  buildGradesIndex,
  buildTeamWeekIndex,
  buildScheduleEloIndex,
  buildPredictiveIndex,
  probBundle,
  resultWinner,
  MODEL_KEYS,
  MODEL_COLORS,
  type MetricKey,
} from "../../previews/engine";

const DISAGREEMENT_LOW = 0.1; // pp gap below this = "low" (models mostly agree)
const DISAGREEMENT_HIGH = 0.25; // pp gap above this = "high" (models split hard)

function bucketOfDisagreement(spread: number): "Low (<10pp)" | "Medium (10–25pp)" | "High (>25pp)" {
  if (spread < DISAGREEMENT_LOW) return "Low (<10pp)";
  if (spread <= DISAGREEMENT_HIGH) return "Medium (10–25pp)";
  return "High (>25pp)";
}
const DISAGREEMENT_BUCKETS = ["Low (<10pp)", "Medium (10–25pp)", "High (>25pp)"] as const;

interface GameModelRow {
  gameId: string;
  season: number;
  week: number;
  home: string;
  away: string;
  homeProbs: Partial<Record<MetricKey, number>>; // P(home wins), whichever models applied
  disagreement: number | null; // max - min across available models, null if <2 available
  winner: "home" | "away" | null;
  underdogWon: boolean | null;
}

export default function ThisWeekView() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [predGames, setPredGames] = useState<Row[]>([]);
  const [predUpcoming, setPredUpcoming] = useState<Row[]>([]);
  const [upcomingMeta, setUpcomingMeta] = useState<PredictiveModelUpcomingMeta | null>(null);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamWeekLoaded, setTeamWeekLoaded] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState("");

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

  const isCurrentWeek =
    upcomingMeta?.week != null && upcomingMeta.n_games > 0 && String(upcomingMeta.week) === selectedWeek;

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
      xAxis: { type: "value", min: bins.lo, max: bins.hi, name: "Spread (home perspective)", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: "Games", nameLocation: "middle", nameGap: 30, nameRotate: 90 },
      series: [
        histogramBarSeries(bins, "#636EFA", "Games"),
        { name: "Mean", type: "line", data: [], markLine: { symbol: "none", lineStyle: { type: "dashed" }, label: { formatter: "Mean" }, data: [{ xAxis: mean }] } },
        { name: "Median", type: "line", data: [], markLine: { symbol: "none", lineStyle: { type: "dotted" }, label: { formatter: "Median" }, data: [{ xAxis: med }] } },
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
      yAxis: { type: "value", name: "|Spread|", nameLocation: "middle", nameGap: 30, nameRotate: 90 },
      tooltip: {
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const v = (param as { data: number[] }).data;
          return `Season ${(param as { name: string }).name}<br/>Min: ${v[0].toFixed(1)}<br/>Q1: ${v[1].toFixed(1)}<br/>Median: ${v[2].toFixed(1)}<br/>Q3: ${v[3].toFixed(1)}<br/>Max: ${v[4].toFixed(1)}`;
        },
      },
      series: [{ type: "boxplot", data, itemStyle: { color: "rgba(99,110,250,0.4)", borderColor: "#636EFA" } }],
    } as EChartsOption;
  }, [weekSchedRows]);

  const spreadHistRef = useECharts(spreadHistOption);
  const spreadBoxRef = useECharts(spreadBoxOption);

  // ---------- Section 2: all models' behavior for this week's games ----------
  const gameModelRows = useMemo<GameModelRow[]>(() => {
    return weekSchedRows
      .map((g) => {
        const season = Number(g.season);
        const week = Number(g.week);
        const bundle = probBundle(g, season, week, hist, gradesIdx, twIdx, eloIdx, predIdx);
        const homeProbs: Partial<Record<MetricKey, number>> = {};
        for (const [key] of MODEL_KEYS) {
          const p = bundle[key][1];
          if (p != null) homeProbs[key] = p;
        }
        const vals = Object.values(homeProbs) as number[];
        const disagreement = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
        const winner = resultWinner(g);
        const marketHome = bundle.blend[1];
        const underdogWon =
          winner == null || marketHome == null
            ? null
            : marketHome < 0.5
              ? winner === "away"
              : winner === "home";
        return {
          gameId: String(g.game_id),
          season,
          week,
          home: String(g.home_team),
          away: String(g.away_team),
          homeProbs,
          disagreement,
          winner,
          underdogWon,
        };
      })
      .sort((a, b) => (b.disagreement ?? -1) - (a.disagreement ?? -1));
  }, [weekSchedRows, hist, gradesIdx, twIdx, eloIdx, predIdx]);

  const modelChartOption = useMemo<EChartsOption | null>(() => {
    if (!gameModelRows.length) return null;
    // Chronological (season, home) for the x-axis, not the disagreement sort used by the table.
    const chrono = [...gameModelRows].sort((a, b) => a.season - b.season || a.home.localeCompare(b.home));
    const labels = chrono.map((g) => `${g.away}@${g.home} '${String(g.season).slice(2)}`);
    const series = MODEL_KEYS.map(([key, label]) => ({
      name: label,
      type: "line" as const,
      connectNulls: false,
      showSymbol: true,
      symbolSize: 6,
      lineStyle: { color: MODEL_COLORS[key] },
      itemStyle: { color: MODEL_COLORS[key] },
      data: chrono.map((g) => (g.homeProbs[key] != null ? +(g.homeProbs[key]! * 100).toFixed(1) : null)),
    }));
    const winnerSeries = {
      name: "Actual winner",
      type: "scatter" as const,
      yAxisIndex: 0,
      symbol: (_val: unknown, params: { dataIndex: number }) => (chrono[params.dataIndex].winner === "home" ? "triangle" : "arrow"),
      symbolSize: 8,
      itemStyle: { color: "#0f172a" },
      data: chrono.map((g) => (g.winner == null ? null : 104)),
    };
    return {
      grid: { left: 48, right: 16, top: 40, bottom: 90, containLabel: true },
      legend: { top: 0, type: "scroll" },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: "value", min: 0, max: 110, name: "P(home wins)", nameLocation: "middle", nameGap: 34, axisLabel: { formatter: (v: number) => (v <= 100 ? `${v}%` : "") } },
      series: [...series, winnerSeries],
    } as EChartsOption;
  }, [gameModelRows]);
  const modelChartRef = useECharts(modelChartOption);

  const section2Kpis = useMemo(() => {
    const withDisagreement = gameModelRows.filter((g) => g.disagreement != null);
    const nExcluded = gameModelRows.length - withDisagreement.length;
    const avgDisagreement = withDisagreement.length
      ? withDisagreement.reduce((s, g) => s + (g.disagreement ?? 0), 0) / withDisagreement.length
      : null;
    const allAgree = withDisagreement.filter((g) => {
      const vals = Object.values(g.homeProbs) as number[];
      return vals.every((p) => p > 0.5) || vals.every((p) => p < 0.5);
    }).length;
    const underdogGames = gameModelRows.filter((g) => g.underdogWon != null);
    const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
    return { n: gameModelRows.length, nExcluded, avgDisagreement, allAgreeRate: withDisagreement.length ? allAgree / withDisagreement.length : null, underdogWinRate };
  }, [gameModelRows]);

  const disagreementBuckets = useMemo(() => {
    return DISAGREEMENT_BUCKETS.map((label) => {
      const rows = gameModelRows.filter((g) => g.disagreement != null && bucketOfDisagreement(g.disagreement) === label);
      const underdogGames = rows.filter((g) => g.underdogWon != null);
      const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
      const modelAcc: Partial<Record<MetricKey, number>> = {};
      for (const [key] of MODEL_KEYS) {
        const withPredAndResult = rows.filter((g) => g.homeProbs[key] != null && g.winner != null);
        if (!withPredAndResult.length) continue;
        const correct = withPredAndResult.filter((g) => (g.homeProbs[key]! > 0.5 ? "home" : "away") === g.winner).length;
        modelAcc[key] = correct / withPredAndResult.length;
      }
      return { label, n: rows.length, underdogWinRate, modelAcc };
    });
  }, [gameModelRows]);

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

  const corrChartOption = useMemo<EChartsOption | null>(() => {
    if (!priorWeekCorr.length) return null;
    return {
      grid: { left: 48, right: 16, top: 20, bottom: 44, containLabel: true },
      tooltip: { trigger: "axis", formatter: (p: unknown) => {
        const param = Array.isArray(p) ? p[0] : p;
        const idx = (param as { dataIndex: number }).dataIndex;
        const row = priorWeekCorr[idx];
        return `Week ${row.week} (${row.lag} back)<br/>r = ${row.r != null ? row.r.toFixed(2) : "—"}<br/>n = ${row.n}`;
      } },
      xAxis: { type: "category", data: priorWeekCorr.map((p) => `Wk ${p.week}`), name: "Prior week", nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", min: -1, max: 1, name: "r", nameLocation: "middle", nameGap: 30 },
      series: [
        {
          type: "bar",
          data: priorWeekCorr.map((p) => (p.r == null ? null : +p.r.toFixed(3))),
          itemStyle: { color: (params: { value: number }) => (params.value >= 0 ? "#2459A7" : "#C8102E") },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [priorWeekCorr]);
  const corrChartRef = useECharts(corrChartOption);

  // ---------- upcoming-week cross-reference ----------
  const upcomingGameRows = useMemo<GameModelRow[]>(() => {
    if (!isCurrentWeek || !upcomingMeta) return [];
    return predUpcoming
      .filter((r) => String(r.season) === String(upcomingMeta.season) && String(r.week) === selectedWeek)
      .map((r) => {
        const season = Number(upcomingMeta.season);
        const week = Number(upcomingMeta.week);
        const bundle = probBundle(r, season, week, hist, gradesIdx, twIdx, eloIdx, predIdx);
        const homeProbs: Partial<Record<MetricKey, number>> = {};
        for (const [key] of MODEL_KEYS) {
          const p = bundle[key][1];
          if (p != null) homeProbs[key] = p;
        }
        const vals = Object.values(homeProbs) as number[];
        return {
          gameId: `${r.season}_${r.week}_${r.away_team}_${r.home_team}`,
          season,
          week,
          home: String(r.home_team),
          away: String(r.away_team),
          homeProbs,
          disagreement: vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null,
          winner: null,
          underdogWon: null,
        };
      })
      .sort((a, b) => (b.disagreement ?? -1) - (a.disagreement ?? -1));
  }, [isCurrentWeek, upcomingMeta, predUpcoming, selectedWeek, hist, gradesIdx, twIdx, eloIdx, predIdx]);

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
          {isCurrentWeek && upcomingGameRows.length > 0 && (
            <Card title={`This week's games — Week ${selectedWeek}, ${upcomingMeta?.season}`} subtitle="Live model probabilities for the upcoming slate, sorted by how much the models disagree.">
              <ModelTable rows={upcomingGameRows} showResult={false} />
            </Card>
          )}

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
              <div className="flex flex-wrap gap-3">
                <Kpi label="Games analyzed" value={section2Kpis.n} sub={section2Kpis.nExcluded ? `${section2Kpis.nExcluded} with <2 models` : undefined} />
                <Kpi label="Avg. disagreement" value={section2Kpis.avgDisagreement != null ? `${(section2Kpis.avgDisagreement * 100).toFixed(1)}pp` : "—"} />
                <Kpi label="All-models-agree rate" value={section2Kpis.allAgreeRate != null ? `${Math.round(section2Kpis.allAgreeRate * 100)}%` : "—"} />
                <Kpi label="Underdog win rate" value={section2Kpis.underdogWinRate != null ? `${Math.round(section2Kpis.underdogWinRate * 100)}%` : "—"} sub="vs. market-calibrated favorite" />
              </div>

              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Model probabilities across this week's games (home win %)</h3>
                <div ref={modelChartRef} className="h-[420px]" />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Does model disagreement predict upsets?</h3>
                <div className={tableWrapCls}>
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-3 py-2">Disagreement</th>
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
                          <td className="px-3 py-1.5 font-semibold">{b.label}</td>
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

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Every historical game this week, sorted by disagreement</h3>
                <ModelTable rows={gameModelRows} showResult />
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
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Shared per-game model table for both the historical Section 2 list and
 * the live upcoming-week banner (which omits the result columns). */
function ModelTable({ rows, showResult }: { rows: GameModelRow[]; showResult: boolean }) {
  if (!rows.length) return <Empty label="No games." />;
  return (
    <div className={tableWrapCls}>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className={theadCls}>
          <tr>
            <th className="px-3 py-2">Season</th>
            <th className="px-3 py-2">Matchup</th>
            {MODEL_KEYS.map(([key, label]) => (
              <th key={key} className="px-3 py-2 text-right">
                {label}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Disagree.</th>
            {showResult && <th className="px-3 py-2">Winner</th>}
            {showResult && <th className="px-3 py-2">Underdog?</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const vals = Object.entries(g.homeProbs) as [MetricKey, number][];
            const maxKey = vals.length ? vals.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
            const minKey = vals.length ? vals.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : null;
            return (
              <tr key={g.gameId} className={trCls}>
                <td className="px-3 py-1.5">{g.season}</td>
                <td className="px-3 py-1.5 font-semibold">
                  {g.away} @ {g.home}
                </td>
                {MODEL_KEYS.map(([key]) => {
                  const p = g.homeProbs[key];
                  const isMax = key === maxKey && vals.length >= 2;
                  const isMin = key === minKey && vals.length >= 2;
                  return (
                    <td
                      key={key}
                      className="px-3 py-1.5 text-right"
                      style={isMax ? { color: "#166534", fontWeight: 700 } : isMin ? { color: "#991b1b", fontWeight: 700 } : undefined}
                    >
                      {p != null ? `${Math.round(p * 100)}%` : "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right">{g.disagreement != null ? `${(g.disagreement * 100).toFixed(1)}pp` : "—"}</td>
                {showResult && <td className="px-3 py-1.5">{g.winner === "home" ? g.home : g.winner === "away" ? g.away : "—"}</td>}
                {showResult && <td className="px-3 py-1.5">{g.underdogWon == null ? "—" : g.underdogWon ? "Yes" : "No"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={scrollHintCls} />
      <ScrollHint />
    </div>
  );
}
