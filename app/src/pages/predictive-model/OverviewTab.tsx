// Overview: KPIs, accuracy-by-season table, and a trend chart up front —
// the full research story (why this model, the complexity/accuracy
// comparison) is collapsed by default so the tab reads as a dashboard, not
// a research memo. Click "Why this model?" to expand it.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, Kpi, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { pct } from "./shared";

// Static — a settled research conclusion (docs/predictive-model.md's "Final
// results" table, Round 8), not something re-derived from live data.
const COMPLEXITY_ROWS: { config: string; features: string; complexity: number; acc: string }[] = [
  { config: "Market moneyline (reference)", features: "0", complexity: 0, acc: "66.38%" },
  { config: "AdaBoost (round4 features)", features: "41", complexity: 3, acc: "64.40%" },
  { config: "Margin regression, LogReg-style (this page's model)", features: "41", complexity: 5, acc: "64.40%" },
  { config: "LogReg (round3 features)", features: "33", complexity: 2, acc: "63.98%" },
  { config: "L1-selected HGB (round4)", features: "~20-25", complexity: 4, acc: "63.92%" },
  { config: "Random Forest (round3)", features: "33", complexity: 3, acc: "63.66%" },
  { config: "Naive Bayes (round4)", features: "41", complexity: 2, acc: "63.17%" },
  { config: "Original baseline (HGB, round1 features)", features: "17", complexity: 4, acc: "62.69%" },
];

export default function OverviewTab({ seasonSummary, testSeasons }: { seasonSummary: Row[]; testSeasons: number[] }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pooled = seasonSummary.find((r) => r.season === "pooled");
  const bySeasonAsc = seasonSummary.filter((r) => r.season !== "pooled").sort((a, b) => Number(a.season) - Number(b.season));

  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!bySeasonAsc.length) return null;
    const seasons = bySeasonAsc.map((r) => String(r.season));
    return {
      grid: { left: 10, right: 20, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%` },
      xAxis: { type: "category", data: seasons, name: "Season" },
      yAxis: { type: "value", name: "Straight-up accuracy", axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        { name: "Model", type: "line", data: bySeasonAsc.map((r) => r.model_accuracy), lineStyle: { color: "#002f6c", width: 3 }, symbolSize: 8 },
        { name: "Market", type: "line", data: bySeasonAsc.map((r) => r.market_accuracy), lineStyle: { color: "#94a3b8", type: "dashed" }, symbolSize: 6 },
        { name: "Elo", type: "line", data: bySeasonAsc.map((r) => r.elo_accuracy), lineStyle: { color: "#dc2626", type: "dashed" }, symbolSize: 6 },
      ],
    } as EChartsOption;
  }, [bySeasonAsc]);
  const trendRef = useECharts(trendOption);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Kpi label="Pooled straight-up accuracy" value={pct(Number(pooled?.model_accuracy))} sub={`n=${pooled?.n ?? "--"}`} />
        <Kpi label="Market moneyline accuracy" value={pct(Number(pooled?.market_accuracy))} accent="#94a3b8" />
        <Kpi label="Elo baseline accuracy" value={pct(Number(pooled?.elo_accuracy))} accent="#94a3b8" />
        <Kpi label="Pooled ATS accuracy" value={pct(Number(pooled?.model_ats_accuracy))} sub={`n=${pooled?.ats_n ?? "--"} — breakeven 52.38%`} accent="#dc2626" />
        <Kpi label="Backtest window" value={`${testSeasons[0] ?? "--"}–${testSeasons[testSeasons.length - 1] ?? "--"}`} accent="#94a3b8" />
      </div>

      <Card title="Accuracy by season" subtitle="Model straight-up accuracy vs the market and Elo, one season at a time">
        <div className={`overflow-x-auto ${tableWrapCls}`}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-3 py-2">Season</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Model</th>
                <th className="px-3 py-2 text-right">Market</th>
                <th className="px-3 py-2 text-right">Elo</th>
                <th className="px-3 py-2 text-right">Model ATS</th>
              </tr>
            </thead>
            <tbody>
              {bySeasonAsc.map((r) => (
                <tr key={String(r.season)} className={trCls}>
                  <td className="px-3 py-1.5 font-medium">{r.season}</td>
                  <td className="px-3 py-1.5 text-right">{r.n}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{pct(Number(r.model_accuracy))}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{pct(Number(r.market_accuracy))}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{pct(Number(r.elo_accuracy))}</td>
                  <td className="px-3 py-1.5 text-right text-rose-600">{pct(Number(r.model_ats_accuracy))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Model vs. market vs. Elo, by season">
        <div ref={trendRef} className="h-[360px]" />
      </Card>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-800">Why this model? What was tried, and how we landed here</span>
          <span className="text-xs font-medium text-[#002f6c]">{detailsOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {detailsOpen && (
          <div className="space-y-4 border-t border-slate-100 p-4">
            <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
              An 8-round research spike (<code>docs/predictive-model.md</code>) tested a walk-forward-trained model —
              margin regression, LogReg-style: one linear regression fit on point margin, using 41 leakage-safe
              features (Elo, rolling EPA/success rate, season-to-date grades, injuries, weather, rest, nonlinear
              transforms) — against the market's own closing line. <b className="text-slate-700">The honest conclusion:
              straight-up accuracy trails the market by ~2 points, and no configuration tested shows a confirmed
              against-the-spread (ATS) edge.</b> This page exists to explore <i>how</i> the model performs and explain
              <i> why</i> it makes the calls it does — not to suggest it beats the closing line.
            </p>

            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-700">Why this model, and why not a more complex one</h3>
              <p className="mb-2 text-xs text-slate-500">
                8-season pooled straight-up accuracy across every configuration tried this session — docs/predictive-model.md, Round 8
              </p>
              <div className={`overflow-x-auto ${tableWrapCls}`}>
                <table className="w-full text-sm">
                  <thead className={theadCls}>
                    <tr>
                      <th className="px-3 py-2">Configuration</th>
                      <th className="px-3 py-2 text-right">Features</th>
                      <th className="px-3 py-2 text-right">Complexity (1-5)</th>
                      <th className="px-3 py-2 text-right">Pooled accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPLEXITY_ROWS.map((r) => (
                      <tr key={r.config} className={`${trCls} ${r.config.includes("this page") ? "bg-[#002f6c]/[0.04]" : ""}`}>
                        <td className="px-3 py-1.5 font-medium">{r.config}</td>
                        <td className="px-3 py-1.5 text-right">{r.features}</td>
                        <td className="px-3 py-1.5 text-right">{r.complexity || "--"}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{r.acc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Margin regression ties AdaBoost for best accuracy but has the lowest season-to-season variance of
                anything tested, and — unlike a classifier — produces a predicted point margin and a fitted
                confidence distribution, which is why it was chosen for this exploration page. See{" "}
                <code>docs/predictive-model-decision.md</code>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
