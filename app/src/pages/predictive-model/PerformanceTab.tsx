// Explore predicted-vs-actual margin per game, filterable by season/team —
// margin regression's main advantage over a plain classifier is that it
// produces a continuous "how wrong," not just "right/wrong" (see
// docs/predictive-model-decision.md).
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup, Kpi, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { ALL_SEASONS, ALL_TEAMS, accuracyOf, atsAccuracyOf, filterGames, pct, seasonOptions, teamOptions } from "./shared";

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
        title="Predicted vs. actual margin"
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
    </div>
  );
}
