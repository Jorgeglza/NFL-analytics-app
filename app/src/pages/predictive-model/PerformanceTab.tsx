// Explore predicted-vs-actual margin per game, filterable by season/team —
// margin regression's main advantage over a plain classifier is that it
// produces a continuous "how wrong," not just "right/wrong" (see
// docs/predictive-model-decision.md).
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup, Kpi, tableWrapCls, theadCls, trCls } from "../../components/ui";
import {
  ALL_SEASONS,
  ALL_TEAMS,
  accuracyByConfidence,
  accuracyByWeek,
  accuracyOf,
  atsAccuracyOf,
  filterGames,
  missComparison,
  pct,
  seasonOptions,
  teamOptions,
} from "./shared";

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

export default function PerformanceTab({ games }: { games: Row[] }) {
  const [season, setSeason] = useState(ALL_SEASONS);
  const [team, setTeam] = useState(ALL_TEAMS);

  const seasons = useMemo(() => seasonOptions(games), [games]);
  const teams = useMemo(() => teamOptions(games), [games]);
  const filtered = useMemo(() => filterGames(games, season, team), [games, season, team]);

  const acc = accuracyOf(filtered);
  const ats = atsAccuracyOf(filtered);

  const scatterOption = useMemo<EChartsOption | null>(() => {
    if (!filtered.length) return null;
    const points = filtered.map((g) => ({
      value: [Number(g.predicted_margin), Number(g.actual_margin)],
      name: `${g.season} wk${g.week} ${g.away_team}@${g.home_team}`,
      correct: (Number(g.predicted_margin) > 0 ? 1 : 0) === Number(g.home_win),
    }));
    const maxAbs = Math.max(30, ...points.map((p) => Math.max(Math.abs(p.value[0]), Math.abs(p.value[1]))));
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const pt = p as { data: { name: string; value: [number, number] } };
          return `${pt.data.name}<br/>predicted ${pt.data.value[0].toFixed(1)} vs actual ${pt.data.value[1].toFixed(1)}`;
        },
      },
      xAxis: { type: "value", name: "Predicted margin (home - away)", min: -maxAbs, max: maxAbs },
      yAxis: { type: "value", name: "Actual margin", min: -maxAbs, max: maxAbs },
      series: [
        {
          type: "line",
          data: [
            [-maxAbs, -maxAbs],
            [maxAbs, maxAbs],
          ],
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          z: 1,
        },
        {
          type: "scatter",
          symbolSize: 6,
          data: points.map((p) => ({ ...p, itemStyle: { color: p.correct ? "#2563eb" : "#dc2626", opacity: 0.55 } })),
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [filtered]);

  const scatterRef = useECharts(scatterOption);

  const bySeasonTable = useMemo(() => {
    const seasonsAsc = Array.from(new Set(filtered.map((g) => Number(g.season)))).sort((a, b) => a - b);
    return seasonsAsc.map((s) => {
      const rows = filtered.filter((g) => Number(g.season) === s);
      return { season: s, n: rows.length, acc: accuracyOf(rows), ats: atsAccuracyOf(rows) };
    });
  }, [filtered]);

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

  const confidence = useMemo(() => accuracyByConfidence(filtered), [filtered]);
  const confidenceOption = useMemo<EChartsOption | null>(() => {
    if (!confidence.length) return null;
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const r = confidence[arr[0].dataIndex];
          return `|predicted margin| ${r.bucket} pts<br/>${pct(r.acc)} (n=${r.n})`;
        },
      },
      xAxis: { type: "category", data: confidence.map((r) => `${r.bucket} pts`), name: "Model's confidence (|predicted margin|)" },
      yAxis: { type: "value", name: "Accuracy", min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        {
          type: "bar",
          data: confidence.map((r) => r.acc),
          itemStyle: { color: "#dc2626" },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, label: { formatter: "50%" }, data: [{ yAxis: 0.5 }] },
        },
      ],
    } as EChartsOption;
  }, [confidence]);
  const confidenceRef = useECharts(confidenceOption);

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
      </FilterGroup>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Games in view" value={filtered.length} />
        <Kpi label="Straight-up accuracy" value={pct(acc)} />
        <Kpi label="ATS accuracy" value={pct(ats.acc)} sub={`n=${ats.n}`} accent="#dc2626" />
      </div>

      <Card
        title={
          <span className="inline-flex items-center">
            Predicted vs. actual margin
            <InfoDot text="Predicted margin: the model's estimate of home score minus away score, made before kickoff. Actual margin: the real final-score differential. A point on the dashed diagonal is a perfect prediction; the further above/below it, the further off the model's margin was — even on games it still picked correctly." />
          </span>
        }
        subtitle="Each dot is one game. On the dashed line = perfect prediction. Blue = correct winner call, red = wrong."
      >
        <div ref={scatterRef} className="h-[480px]" />
      </Card>

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

      <Card title="Accuracy by week" subtitle="How the model performs at each point in the season, pooled across the current filter">
        <div ref={weeklyRef} className="h-[320px]" />
      </Card>

      <Card
        title="What's different about the misses?"
        subtitle="Accuracy broken out by how confident the model was (|predicted margin|) — a model with real signal should be more reliable on lopsided calls than close ones"
      >
        <div ref={confidenceRef} className="h-[320px]" />
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
    </div>
  );
}
