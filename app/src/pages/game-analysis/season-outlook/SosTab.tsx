import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { computeStrengthOfSchedule, computeOpponentHeatmap } from "./shared";
import HeatmapChart from "./HeatmapChart";
import { useECharts } from "../../../components/charts/useECharts";
import { tableWrapCls, theadCls, trCls } from "../../../components/ui";

export default function SosTab({ schedule, season, week, meta }: { schedule: Row[]; season: string; week: string; meta: Map<string, TeamMeta> }) {
  const rows = useMemo(
    () => (season && week ? computeStrengthOfSchedule(schedule, Number(season), Number(week)) : []),
    [schedule, season, week],
  );

  const heatmap = useMemo(() => (season ? computeOpponentHeatmap(schedule, Number(season)) : null), [schedule, season]);

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => (b.remainingAvg ?? -Infinity) - (a.remainingAvg ?? -Infinity));
    return {
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "value", name: "Avg opponent Elo (remaining)", nameLocation: "middle", nameGap: 28 },
      yAxis: {
        type: "category",
        inverse: true,
        data: sorted.map((r) => meta.get(r.team)?.name ?? r.team),
        axisLabel: { fontSize: 10 },
      },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          barMaxWidth: 12,
          data: sorted.map((r) => ({
            value: r.remainingAvg == null ? 0 : Math.round(r.remainingAvg),
            itemStyle: { color: meta.get(r.team)?.color ?? "#002f6c" },
          })),
        },
      ],
    } as EChartsOption;
  }, [rows, meta]);
  const chartRef = useECharts(chartOption);

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        Average pre-game Elo rating of a team's opponents (higher = harder), split into games at/before week {week} vs. games after it — pick a past
        week above to backtest what the remaining-schedule outlook looked like at that point in the season.
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Opponent difficulty by week — hardest schedule first</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          Each cell is that week's opponent — color and the small number are the opponent's pre-game Elo rating (redder = tougher).
        </p>
        {heatmap ? <HeatmapChart data={heatmap} meta={meta} /> : <div className="py-8 text-center text-sm text-slate-400">No schedule data yet.</div>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Remaining strength of schedule — hardest first</h2>
        {chartOption ? <div ref={chartRef} style={{ height: Math.max(240, 22 * rows.length + 40) }} /> : <div className="py-8 text-center text-sm text-slate-400">No data yet.</div>}
      </div>

      <div className={tableWrapCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              {["Team", "Played SOS", "Games played", "Remaining SOS", "Games remaining"].map((h) => (
                <th key={h} className="px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team} className={trCls}>
                <td className="px-3 py-2 font-semibold text-slate-800">
                  <div className="flex items-center gap-2">
                    {meta.get(r.team)?.logo && <img src={meta.get(r.team)!.logo} alt="" className="h-5 w-5 object-contain" />}
                    {meta.get(r.team)?.name ?? r.team}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.playedAvg == null ? "—" : Math.round(r.playedAvg)}</td>
                <td className="px-3 py-2 text-slate-500">{r.playedN}</td>
                <td className="px-3 py-2 font-mono text-slate-700">{r.remainingAvg == null ? "—" : Math.round(r.remainingAvg)}</td>
                <td className="px-3 py-2 text-slate-500">{r.remainingN}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
