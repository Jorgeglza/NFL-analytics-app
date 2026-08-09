// Overview — the page's core question, answered first: is the model
// profitable betting straight-up against real moneyline payout odds?
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../../components/charts/useECharts";
import { Card, Kpi, FilterGroup } from "../../components/ui";
import { MODEL_KEYS, MODEL_COLORS, type MetricKey } from "../game-analysis/previews/engine";
import { type GameBacktestRow, summarize, cumulativeProfitSeries, DEFAULT_STAKE } from "../../lib/logic/backtest";
import { pct, money, roiPct, profitColor } from "./shared";

export default function OverviewTab({
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
  const modelRows = useMemo(() => rows.filter((r) => r.key === primary), [rows, primary]);
  const summary = useMemo(() => summarize(modelRows), [modelRows]);
  const series = useMemo(() => cumulativeProfitSeries(rows, primary), [rows, primary]);
  const label = MODEL_KEYS.find(([k]) => k === primary)?.[1] ?? primary;

  const option = useMemo<EChartsOption | null>(() => {
    if (!series.length) return null;
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          if (!arr.length) return "";
          const pt = series[arr[0].dataIndex];
          return `Season ${pt.season} Wk ${pt.week}<br/>Cumulative: ${money(pt.cumProfit)} over ${pt.cumBets} bets`;
        },
      },
      xAxis: { type: "category", data: series.map((_, i) => i), axisLabel: { show: false }, name: "Bet #", nameLocation: "middle", nameGap: 24 },
      yAxis: { type: "value", name: `Cumulative profit ($${DEFAULT_STAKE}/bet)`, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: [
        {
          type: "line",
          data: series.map((p) => +p.cumProfit.toFixed(2)),
          showSymbol: false,
          lineStyle: { width: 2, color: MODEL_COLORS[primary] },
          areaStyle: { color: `${MODEL_COLORS[primary]}22` },
        },
        {
          type: "line",
          data: series.map(() => 0),
          silent: true,
          symbol: "none",
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
        },
      ],
    };
  }, [series, primary]);

  const ref = useECharts(option);

  const verdict = summary.roi == null ? null : summary.roi > 0;

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

      <Card accent={verdict == null ? "#94a3b8" : verdict ? "#2CA25F" : "#C8102E"}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-2xl">{verdict == null ? "❓" : verdict ? "✅" : "❌"}</div>
          <div>
            <div className="text-lg font-extrabold text-slate-800">
              {verdict == null
                ? `Not enough graded bets yet for ${label}`
                : verdict
                  ? `${label} is profitable betting straight-up`
                  : `${label} is not profitable betting straight-up`}
            </div>
            <div className="text-sm text-slate-500">
              {summary.nGraded.toLocaleString()} graded bets at ${DEFAULT_STAKE}/bet · {money(summary.totalProfit)} total · {roiPct(summary.roi)} ROI
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Total profit" value={money(summary.totalProfit)} accent={profitColor(summary.totalProfit)} sub={`flat $${DEFAULT_STAKE} stake per bet`} />
        <Kpi label="ROI" value={roiPct(summary.roi)} accent={profitColor(summary.roi)} sub="profit ÷ total wagered" />
        <Kpi label="Straight-up accuracy" value={pct(summary.accuracy)} sub={`${summary.wins}-${summary.losses}`} />
        <Kpi label="Graded bets" value={summary.nGraded.toLocaleString()} sub={`of ${summary.n.toLocaleString()} picks made`} />
      </div>

      <Card title="Cumulative profit over time" subtitle={`Running total for ${label}, one point per graded bet in chronological order.`}>
        {option ? <div ref={ref} className="h-[360px]" /> : <div className="grid h-[360px] place-items-center text-sm text-slate-400">No graded bets for this model yet.</div>}
      </Card>

      <p className="text-[11px] text-slate-400">
        Betting straight-up against real moneyline odds is a harder bar than straight-up accuracy — a model can win most of its picks and
        still lose money if it's mostly picking short-priced favorites. See the Methodology tab for exactly how profit is computed.
      </p>
    </div>
  );
}
