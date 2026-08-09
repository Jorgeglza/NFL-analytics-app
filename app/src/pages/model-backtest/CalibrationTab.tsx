// Calibration — does the picked model's home-win probability track the
// observed home-win rate? Same reliability-diagram shape as the Predictive
// Model page's Confidence tab (pages/predictive-model/ConfidenceTab.tsx),
// generalized to any sub-model via lib/logic/backtest.ts's calibrationBuckets().
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup } from "../../components/ui";
import { MODEL_COLORS, type MetricKey } from "../game-analysis/previews/engine";
import { type GameBacktestRow, calibrationBuckets } from "../../lib/logic/backtest";

export default function CalibrationTab({
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
  const buckets = useMemo(() => calibrationBuckets(rows, primary), [rows, primary]);
  const label = modelKeys.find(([k]) => k === primary)?.[1] ?? primary;

  const option = useMemo<EChartsOption | null>(() => {
    if (!buckets.length) return null;
    const points = buckets.map((b) => [b.meanPredicted, b.observedRate, b.n]);
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const pt = p as { data: [number, number, number] };
          return `predicted ${(pt.data[0] * 100).toFixed(1)}% vs observed ${(pt.data[1] * 100).toFixed(1)}% (n=${pt.data[2]})`;
        },
      },
      xAxis: { type: "value", name: "Mean predicted home-win probability", min: 0, max: 1 },
      yAxis: { type: "value", name: "Observed home-win rate", min: 0, max: 1 },
      series: [
        {
          type: "line",
          data: [
            [0, 0],
            [1, 1],
          ],
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          z: 1,
        },
        {
          type: "scatter",
          symbolSize: (v: number[]) => Math.max(8, Math.min(30, Math.sqrt(v[2]) * 2)),
          itemStyle: { color: MODEL_COLORS[primary] },
          data: points,
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [buckets, primary]);

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

      <Card title={`Reliability diagram — ${label}`} subtitle="Each point is a bin of predicted home-win probability. On the dashed line = perfectly calibrated (dot size = sample size).">
        {option ? <div ref={ref} className="h-[420px]" /> : <div className="grid h-[420px] place-items-center text-sm text-slate-400">No graded games for this model.</div>}
      </Card>

      <p className="text-[11px] text-slate-400">
        Calibration is a different question from profitability — a model can be well-calibrated and still lose money to the vig (the market's
        own price is, by construction, close to well-calibrated too). Profitability needs the model's probability to beat the market's, not
        just match reality.
      </p>
    </div>
  );
}
