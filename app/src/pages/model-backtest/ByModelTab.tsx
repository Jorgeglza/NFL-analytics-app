// By Model — head-to-head ROI/accuracy comparison across every sub-model.
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../../components/charts/useECharts";
import { Card, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { MODEL_COLORS, type MetricKey } from "../game-analysis/previews/engine";
import { type GameBacktestRow, type BacktestSummary, summarizeByModel } from "../../lib/logic/backtest";
import { pct, money, roiPct, profitColor, rankByRoi } from "./shared";

export default function ByModelTab({ rows, modelKeys }: { rows: GameBacktestRow[]; modelKeys: readonly [MetricKey, string][] }) {
  const summaries = useMemo(() => summarizeByModel(rows, modelKeys), [rows, modelKeys]);
  // summarizeByModel() creates an entry for every key in modelKeys, so the lookup below is never undefined.
  const ranked = useMemo(
    () => rankByRoi<MetricKey>(modelKeys.map(([k]) => [k, summaries.get(k) as BacktestSummary])),
    [modelKeys, summaries],
  );
  const labelOf = useMemo(() => new Map(modelKeys.map(([k, l]) => [k, l])), [modelKeys]);

  const option = useMemo<EChartsOption | null>(() => {
    if (!ranked.length) return null;
    return {
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const d = p as { dataIndex: number };
          const [key, s] = ranked[d.dataIndex];
          return `${labelOf.get(key)}<br/>ROI: ${roiPct(s.roi)} (${money(s.totalProfit)})<br/>Accuracy: ${pct(s.accuracy)} (${s.wins}-${s.losses})`;
        },
      },
      xAxis: { type: "value", name: "ROI %", axisLabel: { formatter: (v: number) => `${v}%` } },
      yAxis: { type: "category", data: ranked.map(([k]) => labelOf.get(k) ?? k), inverse: true, axisLabel: { fontSize: 11 } },
      series: [
        {
          type: "bar",
          data: ranked.map(([k, s]) => ({ value: s.roi == null ? 0 : +(s.roi * 100).toFixed(2), itemStyle: { color: MODEL_COLORS[k] } })),
          barMaxWidth: 28,
          label: {
            show: true,
            position: "right",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => `${Number(p.value).toFixed(1)}%`,
            fontSize: 10,
          },
        },
      ],
    };
  }, [ranked, labelOf]);

  const ref = useECharts(option);

  return (
    <div className="space-y-4">
      <Card title="ROI by model" subtitle="Every sub-model's return on investment, ranked best to worst. Zero is break-even; negative loses money to the vig.">
        {option ? <div ref={ref} style={{ height: Math.max(220, ranked.length * 44 + 60) }} /> : <div className="grid h-[220px] place-items-center text-sm text-slate-400">No graded bets yet.</div>}
      </Card>

      <div className={tableWrapCls}>
        <table className="w-full border-collapse text-xs">
          <thead className={theadCls}>
            <tr>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-right">Picks</th>
              <th className="px-3 py-2 text-right">Graded bets</th>
              <th className="px-3 py-2 text-right">Accuracy</th>
              <th className="px-3 py-2 text-right">Total profit</th>
              <th className="px-3 py-2 text-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(([key, s]) => (
              <tr key={key} className={trCls}>
                <td className="whitespace-nowrap px-3 py-2 font-bold" style={{ color: MODEL_COLORS[key] }}>
                  {labelOf.get(key)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.n.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.nGraded.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(s.accuracy)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(s.totalProfit) }}>
                  {money(s.totalProfit)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(s.roi) }}>
                  {roiPct(s.roi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
