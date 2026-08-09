// By Season — is profitability improving, worsening, or flat over time.
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { MODEL_COLORS, type MetricKey } from "../game-analysis/previews/engine";
import { type GameBacktestRow, summarizeBySeason } from "../../lib/logic/backtest";
import { pct, money, roiPct, profitColor } from "./shared";

export default function BySeasonTab({
  rows,
  modelKeys,
  primary,
  onPrimaryChange,
}: {
  rows: GameBacktestRow[];
  modelKeys: readonly [MetricKey, string][];
  primary: MetricKey;
  onPrimaryChange: (k: MetricKey) => void;
}) {
  const bySeason = useMemo(() => summarizeBySeason(rows, primary), [rows, primary]);
  const label = modelKeys.find(([k]) => k === primary)?.[1] ?? primary;

  const option = useMemo<EChartsOption | null>(() => {
    if (!bySeason.length) return null;
    return {
      grid: { left: 10, right: 40, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          if (!arr.length) return "";
          const { season, summary } = bySeason[arr[0].dataIndex];
          return `Season ${season}<br/>ROI: ${roiPct(summary.roi)} (${money(summary.totalProfit)})<br/>Accuracy: ${pct(summary.accuracy)}`;
        },
      },
      xAxis: { type: "category", data: bySeason.map((s) => String(s.season)), name: "Season", nameLocation: "middle", nameGap: 28 },
      yAxis: [
        { type: "value", name: "ROI %", position: "left", axisLabel: { formatter: (v: number) => `${v}%` } },
        { type: "value", name: "Total profit ($)", position: "right" },
      ],
      series: [
        {
          name: "ROI %",
          type: "bar",
          yAxisIndex: 0,
          data: bySeason.map((s) => (s.summary.roi == null ? null : +(s.summary.roi * 100).toFixed(2))),
          itemStyle: { color: MODEL_COLORS[primary] },
        },
        {
          name: "Cumulative profit",
          type: "line",
          yAxisIndex: 1,
          data: bySeason.map((s) => (s.summary.totalProfit == null ? null : +s.summary.totalProfit.toFixed(2))),
          itemStyle: { color: "#164a9c" },
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [bySeason, primary]);

  const ref = useECharts(option);

  return (
    <div className="space-y-4">
      <FilterGroup label="Model">
        <div className="flex flex-wrap gap-2">
          {modelKeys.map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => onPrimaryChange(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${primary === k ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </FilterGroup>

      <Card title={`${label} — season by season`} subtitle="Bars: ROI % that season. Line: profit that season (not cumulative across seasons).">
        {option ? <div ref={ref} className="h-[360px]" /> : <div className="grid h-[360px] place-items-center text-sm text-slate-400">No graded seasons yet.</div>}
      </Card>

      <div className={tableWrapCls}>
        <table className="w-full border-collapse text-xs">
          <thead className={theadCls}>
            <tr>
              <th className="px-3 py-2 text-left">Season</th>
              <th className="px-3 py-2 text-right">Graded bets</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {[...bySeason].reverse().map(({ season, summary }) => (
              <tr key={season} className={trCls}>
                <td className="px-3 py-2 font-bold">{season}</td>
                <td className="px-3 py-2 text-right tabular-nums">{summary.nGraded.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(summary.accuracy)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(summary.totalProfit) }}>
                  {money(summary.totalProfit)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(summary.roi) }}>
                  {roiPct(summary.roi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
