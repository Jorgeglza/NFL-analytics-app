// Calibration/reliability + residual distribution — the confidence story
// margin regression uniquely supports (a real fitted residual distribution,
// not just a single calibrated probability like a classifier). See
// docs/predictive-model.md Round 5 for why this is a more informative "no
// edge" result than the classifiers produced.
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { PredictiveModelCalibration, Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, Kpi } from "../../components/ui";

const N_HIST_BINS = 30;

export default function ConfidenceTab({ calibration }: { calibration: PredictiveModelCalibration }) {
  const table = useMemo(
    () => calibration.table.rows.map((row) => Object.fromEntries(calibration.table.cols.map((c, i) => [c, row[i]]))) as Row[],
    [calibration],
  );
  const diag = useMemo(
    () =>
      calibration.residual_diagnostics.rows.map((row) =>
        Object.fromEntries(calibration.residual_diagnostics.cols.map((c, i) => [c, row[i]])),
      ) as Row[],
    [calibration],
  );
  const avgSigma = diag.length ? diag.reduce((s, r) => s + Number(r.sigma), 0) / diag.length : null;

  const reliabilityOption = useMemo<EChartsOption | null>(() => {
    if (!table.length) return null;
    const points = table.map((r) => [Number(r.mean_predicted), Number(r.observed_rate), Number(r.n)]);
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const pt = p as { data: [number, number, number] };
          return `predicted ${(pt.data[0] * 100).toFixed(1)}% vs observed ${(pt.data[1] * 100).toFixed(1)}% (n=${pt.data[2]})`;
        },
      },
      xAxis: { type: "value", name: "Mean predicted probability", min: 0, max: 1 },
      yAxis: { type: "value", name: "Observed win rate", min: 0, max: 1 },
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
          itemStyle: { color: "#002f6c" },
          data: points,
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [table]);

  const histOption = useMemo<EChartsOption | null>(() => {
    const pool = calibration.residual_pool;
    if (!pool.length) return null;
    const min = Math.min(...pool);
    const max = Math.max(...pool);
    const width = (max - min) / N_HIST_BINS || 1;
    const counts = new Array(N_HIST_BINS).fill(0);
    pool.forEach((v) => {
      const idx = Math.min(N_HIST_BINS - 1, Math.max(0, Math.floor((v - min) / width)));
      counts[idx]++;
    });
    const labels = counts.map((_, i) => (min + i * width).toFixed(0));
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, name: "Residual (points)", axisLabel: { interval: 4 } },
      yAxis: { type: "value", name: "Count" },
      series: [{ type: "bar", data: counts, itemStyle: { color: "#164a9c" }, barCategoryGap: "0%" }],
    } as EChartsOption;
  }, [calibration]);

  const reliabilityRef = useECharts(reliabilityOption);
  const histRef = useECharts(histOption);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Kpi
          label="Straight-up calibration r"
          value={calibration.correlation !== null ? calibration.correlation.toFixed(4) : "n/a"}
          sub="Ruscio & Brady's bar for 'well calibrated' is r > .99"
        />
        <Kpi label="Residual σ (avg across folds)" value={avgSigma !== null ? `${avgSigma.toFixed(1)} pts` : "--"} sub="game-to-game unpredictability" accent="#94a3b8" />
      </div>

      <Card
        title="Reliability diagram"
        subtitle="Each point is a bin of predicted win probabilities. On the dashed line = perfectly calibrated (dot size = sample size)."
      >
        <div ref={reliabilityRef} className="h-[420px]" />
      </Card>

      <Card
        title="Residual distribution"
        subtitle="Out-of-fold training residuals, pooled across every walk-forward fold — the model's actual margin-prediction error, not assumed normal."
      >
        <div ref={histRef} className="h-[360px]" />
      </Card>

      <Card accent="#dc2626">
        <h2 className="text-sm font-bold uppercase tracking-wider text-rose-600">Why this doesn't mean an edge</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          The straight-up calibration above is genuinely good — predicted probabilities track observed outcomes
          closely. But the same isn't true for against-the-spread confidence: the model expresses a wide range of
          ATS confidence (not just clustered near 50%), yet that confidence doesn't reliably track which games it
          should be more or less right about. Read together, this is stronger evidence that the market has already
          priced in whatever signal these features carry — see <code>docs/predictive-model.md</code>'s Round 5.
        </p>
      </Card>
    </div>
  );
}
