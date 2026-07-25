// Explore predicted-vs-actual performance per game, filterable by season/team.
// Two modes, toggled by the "Points" / "%" control: Points explores the raw
// margin regression's continuous "how wrong" (its main advantage over a
// plain classifier — see docs/predictive-model-decision.md); % explores the
// derived win-probability surface and whether it's actually well-calibrated
// (does a 70% prediction happen ~70% of the time?), which is a different
// question from "did it pick the right team."
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup, Kpi, Segmented, tableWrapCls, theadCls, trCls } from "../../components/ui";
import {
  ALL_SEASONS,
  ALL_TEAMS,
  accuracyByWeek,
  accuracyOf,
  atsAccuracyOf,
  buildMarginHeatmap,
  buildProbabilityHeatmap,
  calibrationByWeek,
  calibrationBySeason,
  filterGames,
  isCellCorrect,
  isCorrect,
  missComparison,
  pct,
  seasonOptions,
  teamOptions,
  type Heatmap,
} from "./shared";

type Mode = "Points" | "%";

/** Small hover-only info marker — matches the app's existing convention of a
 * native `title` attribute for "nothing obvious until hovered" hints. */
function InfoDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 align-middle"
    >
      i
    </span>
  );
}

/** Shared heatmap chart-option builder for both the margin and probability
 * grids — same visual grammar (N-labeled cells, blue/red correctness
 * outline with ties going red, dashed diagonal/threshold reference). */
function heatmapOptionOf(heatmap: Heatmap, opts: { xName: string; yName: string; xGap: number; yGap: number; diagonal: boolean }): EChartsOption | null {
  if (!heatmap.cells.length) return null;
  const maxCellN = Math.max(1, ...heatmap.cells.map((c) => c.n));
  const series: EChartsOption["series"] = [
    {
      type: "heatmap",
      data: heatmap.cells.map((c) => ({
        value: [c.xi, c.yi, c.n],
        xi: c.xi,
        yi: c.yi,
        n: c.n,
        correctShare: c.correctShare,
        itemStyle: {
          borderColor: isCellCorrect(c.correctShare) ? "#2563eb" : "#dc2626",
          borderWidth: 2,
        },
        label: { show: true, formatter: () => String(c.n), fontSize: 9, fontWeight: "bold" as const },
      })),
      label: { show: true },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
      z: 2,
    },
  ];
  if (opts.diagonal) {
    const n = Math.min(heatmap.xLabels.length, heatmap.yLabels.length);
    series.push({
      type: "line",
      data: Array.from({ length: n }, (_, i) => [i, i]),
      lineStyle: { color: "#0f172a", type: "dashed", width: 2 },
      symbol: "none",
      silent: true,
      tooltip: { show: false },
      z: 3,
    });
  }
  return {
    grid: { left: 90, right: 20, top: 30, bottom: 70, containLabel: false },
    tooltip: {
      formatter: (p: unknown) => {
        const pt = p as { data: { xi: number; yi: number; n: number; correctShare: number | null } };
        const { xi, yi, n, correctShare } = pt.data;
        return `${opts.xName}: ${heatmap.xLabels[xi]}<br/>${opts.yName}: ${heatmap.yLabels[yi]}<br/>n=${n} — ${pct(correctShare)} correct`;
      },
    },
    xAxis: {
      type: "category",
      data: heatmap.xLabels,
      name: opts.xName,
      nameLocation: "middle",
      nameGap: opts.xGap,
      axisLabel: { rotate: 45, fontSize: 9 },
    },
    yAxis: {
      type: "category",
      data: heatmap.yLabels,
      name: opts.yName,
      nameLocation: "middle",
      nameGap: opts.yGap,
      nameRotate: 90,
      axisLabel: { fontSize: 9 },
    },
    visualMap: {
      min: 0,
      max: maxCellN,
      right: 0,
      top: "center",
      calculable: false,
      text: ["N", ""],
      inRange: { color: ["#eff6ff", "#bfdbfe", "#60a5fa", "#1d4ed8"] },
    },
    series,
  } as EChartsOption;
}

export default function PerformanceTab({ games }: { games: Row[] }) {
  const [season, setSeason] = useState(ALL_SEASONS);
  const [team, setTeam] = useState(ALL_TEAMS);
  const [mode, setMode] = useState<Mode>("Points");

  const seasons = useMemo(() => seasonOptions(games), [games]);
  const teams = useMemo(() => teamOptions(games), [games]);
  const filtered = useMemo(() => filterGames(games, season, team), [games, season, team]);

  const acc = accuracyOf(filtered);
  const ats = atsAccuracyOf(filtered);

  // --- Points mode: predicted vs. actual margin ---
  const scatterOption = useMemo<EChartsOption | null>(() => {
    if (!filtered.length) return null;
    const points = filtered.map((g) => ({
      value: [Number(g.predicted_margin), Number(g.actual_margin)] as [number, number],
      name: `${g.season} wk${g.week} ${g.away_team}@${g.home_team}`,
      correct: isCorrect(g),
    }));
    const maxAbs = Math.max(30, ...points.map((p) => Math.max(Math.abs(p.value[0]), Math.abs(p.value[1])))) * 1.05;
    const tooltipFormatter = (p: unknown) => {
      const pt = p as { data: { name: string; value: [number, number] } };
      return `${pt.data.name}<br/>predicted ${pt.data.value[0].toFixed(1)} vs actual ${pt.data.value[1].toFixed(1)}`;
    };
    return {
      // Generous, explicit padding (rather than relying only on containLabel)
      // so both axis titles have guaranteed room and never get clipped.
      grid: { left: 60, right: 30, top: 40, bottom: 60, containLabel: false },
      legend: { top: 0, data: ["Correct pick", "Wrong pick"] },
      tooltip: { formatter: tooltipFormatter },
      xAxis: {
        type: "value",
        name: "Predicted margin (home − away, pts)",
        nameLocation: "middle",
        nameGap: 32,
        min: -maxAbs,
        max: maxAbs,
      },
      yAxis: {
        type: "value",
        name: "Actual margin (home − away, pts)",
        nameLocation: "middle",
        nameGap: 42,
        nameRotate: 90,
        min: -maxAbs,
        max: maxAbs,
      },
      series: [
        {
          type: "line",
          data: [
            [-maxAbs, -maxAbs],
            [maxAbs, maxAbs],
          ],
          name: "Perfect prediction",
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          z: 1,
        },
        {
          name: "Correct pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#2563eb", opacity: 0.55 },
          data: points.filter((p) => p.correct),
          z: 2,
        },
        {
          name: "Wrong pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#dc2626", opacity: 0.55 },
          data: points.filter((p) => !p.correct),
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [filtered]);
  const scatterRef = useECharts(scatterOption);

  // --- % mode: predicted win probability vs. actual outcome ---
  const probScatterOption = useMemo<EChartsOption | null>(() => {
    const graded = filtered.filter((g) => g.home_win_prob !== null);
    if (!graded.length) return null;
    // Deterministic jitter (seeded by a hash of the game key) so the same
    // game always lands in the same spot on re-render, but points at the
    // same probability/outcome don't all stack exactly on top of each other.
    const jitterOf = (g: Row) => {
      const key = `${g.season}-${g.week}-${g.home_team}-${g.away_team}`;
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return ((h % 1000) / 1000 - 0.5) * 0.16;
    };
    const points = graded.map((g) => ({
      value: [Number(g.home_win_prob) * 100, Number(g.home_win) + jitterOf(g)] as [number, number],
      name: `${g.season} wk${g.week} ${g.away_team}@${g.home_team}`,
      correct: isCorrect(g),
    }));
    const tooltipFormatter = (p: unknown) => {
      const pt = p as { data: { name: string; value: [number, number] } };
      return `${pt.data.name}<br/>predicted home win prob ${pt.data.value[0].toFixed(0)}%<br/>actual: ${pt.data.value[1] > 0.5 ? "Home win" : "Away win"}`;
    };
    return {
      grid: { left: 90, right: 30, top: 40, bottom: 60, containLabel: false },
      legend: { top: 0, data: ["Correct pick", "Wrong pick"] },
      tooltip: { formatter: tooltipFormatter },
      xAxis: {
        type: "value",
        name: "Predicted home win probability (%)",
        nameLocation: "middle",
        nameGap: 32,
        min: 0,
        max: 100,
      },
      yAxis: {
        type: "value",
        name: "Actual outcome",
        nameLocation: "middle",
        nameGap: 70,
        nameRotate: 90,
        min: -0.3,
        max: 1.3,
        axisLabel: { formatter: (v: number) => (v <= 0 ? "Away win" : v >= 1 ? "Home win" : "") },
      },
      series: [
        {
          type: "line",
          data: [
            [50, -0.3],
            [50, 1.3],
          ],
          name: "50% decision line",
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          z: 1,
        },
        {
          name: "Correct pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#2563eb", opacity: 0.5 },
          data: points.filter((p) => p.correct),
          z: 2,
        },
        {
          name: "Wrong pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#dc2626", opacity: 0.5 },
          data: points.filter((p) => !p.correct),
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [filtered]);
  const probScatterRef = useECharts(probScatterOption);

  const bySeasonTable = useMemo(() => {
    const seasonsAsc = Array.from(new Set(filtered.map((g) => Number(g.season)))).sort((a, b) => a - b);
    return seasonsAsc.map((s) => {
      const rows = filtered.filter((g) => Number(g.season) === s);
      return { season: s, n: rows.length, acc: accuracyOf(rows), ats: atsAccuracyOf(rows) };
    });
  }, [filtered]);

  const calibSeasonTable = useMemo(() => calibrationBySeason(filtered), [filtered]);

  const weekly = useMemo(() => accuracyByWeek(filtered), [filtered]);
  const weeklyOption = useMemo<EChartsOption | null>(() => {
    if (!weekly.length) return null;
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const r = weekly[arr[0].dataIndex];
          return `Week ${r.week}<br/>${pct(r.acc)} (n=${r.n})`;
        },
      },
      xAxis: { type: "category", data: weekly.map((r) => `Wk${r.week}`), name: "Week" },
      yAxis: { type: "value", name: "Accuracy", min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        {
          type: "bar",
          data: weekly.map((r) => r.acc),
          itemStyle: { color: "#002f6c" },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, label: { formatter: "50%" }, data: [{ yAxis: 0.5 }] },
        },
      ],
    } as EChartsOption;
  }, [weekly]);
  const weeklyRef = useECharts(weeklyOption);

  const calibWeekly = useMemo(() => calibrationByWeek(filtered), [filtered]);
  const calibWeeklyOption = useMemo<EChartsOption | null>(() => {
    if (!calibWeekly.length) return null;
    return {
      grid: { left: 10, right: 20, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const r = calibWeekly[arr[0].dataIndex];
          return `Week ${r.week}<br/>Predicted ${pct(r.avgPredicted)}<br/>Observed ${pct(r.observedRate)} (n=${r.n})`;
        },
      },
      xAxis: { type: "category", data: calibWeekly.map((r) => `Wk${r.week}`), name: "Week" },
      yAxis: { type: "value", name: "Win probability", min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        { name: "Avg predicted", type: "line", data: calibWeekly.map((r) => r.avgPredicted), lineStyle: { color: "#002f6c", width: 3 }, symbolSize: 6 },
        { name: "Observed", type: "line", data: calibWeekly.map((r) => r.observedRate), lineStyle: { color: "#dc2626", type: "dashed" }, symbolSize: 6 },
      ],
    } as EChartsOption;
  }, [calibWeekly]);
  const calibWeeklyRef = useECharts(calibWeeklyOption);

  const heatmap = useMemo(() => buildMarginHeatmap(filtered, 5), [filtered]);
  const heatmapOption = useMemo(
    () => heatmapOptionOf(heatmap, { xName: "Predicted margin bucket (pts)", yName: "Actual margin bucket (pts)", xGap: 44, yGap: 65, diagonal: true }),
    [heatmap],
  );
  const heatmapRef = useECharts(heatmapOption);

  const probHeatmap = useMemo(() => buildProbabilityHeatmap(filtered, 10), [filtered]);
  const probHeatmapOption = useMemo(
    () => heatmapOptionOf(probHeatmap, { xName: "Predicted home win probability", yName: "Actual outcome", xGap: 44, yGap: 55, diagonal: false }),
    [probHeatmap],
  );
  const probHeatmapRef = useECharts(probHeatmapOption);

  const miss = useMemo(() => missComparison(filtered), [filtered]);
  const [correctStats, wrongStats] = miss;

  return (
    <div className="space-y-4">
      <FilterGroup label="Filter">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Season</span>
          <select value={season} onChange={(e) => setSeason(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15">
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15">
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <Segmented label="View" options={[{ value: "Points" as Mode, label: "Points" }, { value: "%" as Mode, label: "%" }]} value={mode} onChange={setMode} />
      </FilterGroup>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Games in view" value={filtered.length} />
        <Kpi label="Straight-up accuracy" value={pct(acc)} />
        <Kpi label="ATS accuracy" value={pct(ats.acc)} sub={`n=${ats.n}`} accent="#dc2626" />
      </div>

      {mode === "Points" ? (
        <Card
          title={
            <span className="inline-flex items-center">
              Predicted vs. actual margin
              <InfoDot text="Predicted margin: the model's estimate of home score minus away score, made before kickoff. Actual margin: the real final-score differential. A point on the dashed diagonal is a perfect prediction; the further above/below it, the further off the model's margin was — even on games it still picked correctly." />
            </span>
          }
          subtitle="Each dot is one game. On the dashed line = perfect prediction. Blue = correct winner call, red = wrong."
        >
          <div ref={scatterRef} className="h-[520px]" />
        </Card>
      ) : (
        <Card
          title={
            <span className="inline-flex items-center">
              Predicted win probability vs. actual outcome
              <InfoDot text="Predicted probability: the model's confidence the home team wins, made before kickoff (see the Confidence tab for how margin converts to this number). Points above the dashed 50% line were picked to win at home; below, to lose. A well-calibrated model should also be right in proportion to its stated confidence — see the tables below." />
            </span>
          }
          subtitle="Each dot is one game, jittered vertically so overlapping games stay visible. On the dashed line = the 50% pick threshold. Blue = correct winner call, red = wrong."
        >
          <div ref={probScatterRef} className="h-[520px]" />
        </Card>
      )}

      {mode === "Points" ? (
        <Card title="Accuracy by season (current filter)">
          <div className={`overflow-x-auto ${tableWrapCls}`}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-3 py-2">Season</th>
                  <th className="px-3 py-2 text-right">Games</th>
                  <th className="px-3 py-2 text-right">Straight-up</th>
                  <th className="px-3 py-2 text-right">ATS</th>
                </tr>
              </thead>
              <tbody>
                {bySeasonTable.map((r) => (
                  <tr key={r.season} className={trCls}>
                    <td className="px-3 py-1.5 font-medium">{r.season}</td>
                    <td className="px-3 py-1.5 text-right">{r.n}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{pct(r.acc)}</td>
                    <td className="px-3 py-1.5 text-right text-rose-600">{pct(r.ats.acc)}</td>
                  </tr>
                ))}
                {!bySeasonTable.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">No games match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Calibration by season (current filter)" subtitle="Avg predicted probability vs. the rate the home team actually won — the gap is over/under-confidence, not pick accuracy">
          <div className={`overflow-x-auto ${tableWrapCls}`}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-3 py-2">Season</th>
                  <th className="px-3 py-2 text-right">Games</th>
                  <th className="px-3 py-2 text-right">Avg predicted</th>
                  <th className="px-3 py-2 text-right">Observed</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {calibSeasonTable.map((r) => (
                  <tr key={String(r.season)} className={`${trCls} ${r.season === "pooled" ? "bg-slate-50/70 font-semibold" : ""}`}>
                    <td className="px-3 py-1.5 font-medium">{r.season}</td>
                    <td className="px-3 py-1.5 text-right">{r.n}</td>
                    <td className="px-3 py-1.5 text-right">{pct(r.avgPredicted)}</td>
                    <td className="px-3 py-1.5 text-right">{pct(r.observedRate)}</td>
                    <td className={`px-3 py-1.5 text-right ${Math.abs(r.avgPredicted - r.observedRate) > 0.08 ? "text-rose-600" : "text-slate-500"}`}>
                      {r.avgPredicted - r.observedRate >= 0 ? "+" : ""}{((r.avgPredicted - r.observedRate) * 100).toFixed(1)}pt
                    </td>
                  </tr>
                ))}
                {!calibSeasonTable.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">No games match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {mode === "Points" ? (
        <Card title="Accuracy by week" subtitle="How the model performs at each point in the season, pooled across the current filter">
          <div ref={weeklyRef} className="h-[320px]" />
        </Card>
      ) : (
        <Card title="Calibration by week" subtitle="Avg predicted probability vs. observed win rate, pooled across the current filter">
          <div ref={calibWeeklyRef} className="h-[320px]" />
        </Card>
      )}

      {mode === "Points" ? (
        <Card
          title="What's different about the misses?"
          subtitle="Predicted vs. actual margin, bucketed. Cell = N games in that bucket pair. Blue outline = majority correct, red outline = majority wrong. Dashed diagonal = predicted matched actual exactly."
        >
          <div ref={heatmapRef} className="h-[560px]" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-xs font-semibold text-slate-600">Correct picks (n={correctStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg |predicted margin|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsPredicted?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg margin error</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsError?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div className="text-xs font-semibold text-rose-700">Wrong picks (n={wrongStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg |predicted margin|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsPredicted?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg margin error</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsError?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            If the misses cluster in low-confidence buckets and low average spread lines, the model is failing exactly
            where you'd expect — close, hard-to-call games — rather than missing in ways that suggest a deeper problem.
          </p>
        </Card>
      ) : (
        <Card
          title="What's different about the misses?"
          subtitle="Predicted probability vs. actual outcome, bucketed. Cell = N games. Blue outline = majority correct, red outline = majority wrong (ties go red)."
        >
          <div ref={probHeatmapRef} className="h-[420px]" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-xs font-semibold text-slate-600">Correct picks (n={correctStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg confidence (|prob − 50%|)</dt><dd className="font-medium text-slate-700">{correctStats?.avgConfidencePct !== null && correctStats?.avgConfidencePct !== undefined ? pct(correctStats.avgConfidencePct) : "--"}</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div className="text-xs font-semibold text-rose-700">Wrong picks (n={wrongStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg confidence (|prob − 50%|)</dt><dd className="font-medium text-slate-700">{wrongStats?.avgConfidencePct !== null && wrongStats?.avgConfidencePct !== undefined ? pct(wrongStats.avgConfidencePct) : "--"}</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Lower average confidence on the wrong picks means the model at least "knew" those games were closer calls —
            it wasn't confidently wrong.
          </p>
        </Card>
      )}
    </div>
  );
}
