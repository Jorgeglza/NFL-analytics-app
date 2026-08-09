// Per-team drill-down for the By Team tab — KPIs, profit movement over time,
// and how often this team comes up as the market favorite vs. underdog when
// the model bets it (the two swing the model's real-world risk profile even
// when overall accuracy looks similar).
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Modal } from "../../components/Modal";
import { Card, Kpi, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { useECharts } from "../../components/charts/useECharts";
import { MODEL_COLORS, type MetricKey } from "../game-analysis/previews/engine";
import {
  type GameBacktestRow,
  canonicalPickedTeamOf,
  summarize,
  summarizeBySeasonWithFavorite,
  summarizeByFavoriteStatus,
  cumulativeProfitSeries,
} from "../../lib/logic/backtest";
import { pct, money, roiPct, profitColor } from "./shared";

export default function TeamDetailModal({
  team,
  keyMetric,
  label,
  rows,
  onClose,
}: {
  team: string;
  keyMetric: MetricKey;
  label: string;
  /** Rows for this model only (already filtered to `key === keyMetric`); filtered to `team` here. */
  rows: GameBacktestRow[];
  onClose: () => void;
}) {
  // Relocated franchises (STL->LA, SD->LAC, OAK->LV) are merged onto their current code — `team`
  // here is always the canonical/current code, matching By Team's list.
  const teamRows = useMemo(() => rows.filter((r) => canonicalPickedTeamOf(r) === team), [rows, team]);
  const summary = useMemo(() => summarize(teamRows), [teamRows]);
  const favSplit = useMemo(() => summarizeByFavoriteStatus(teamRows), [teamRows]);
  const bySeason = useMemo(() => summarizeBySeasonWithFavorite(teamRows, keyMetric), [teamRows, keyMetric]);
  const series = useMemo(() => cumulativeProfitSeries(teamRows, keyMetric), [teamRows, keyMetric]);

  const favN = favSplit.favorite.n;
  const dogN = favSplit.underdog.n;
  const unkN = favSplit.unknown.n;
  const totalN = favN + dogN + unkN;
  const favShare = totalN ? favN / totalN : null;
  const dogShare = totalN ? dogN / totalN : null;

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
      yAxis: { type: "value", name: "Cumulative profit ($)", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: [
        {
          type: "line",
          data: series.map((p) => +p.cumProfit.toFixed(2)),
          showSymbol: false,
          lineStyle: { width: 2, color: MODEL_COLORS[keyMetric] },
          areaStyle: { color: `${MODEL_COLORS[keyMetric]}22` },
        },
        { type: "line", data: series.map(() => 0), silent: true, symbol: "none", lineStyle: { color: "#94a3b8", type: "dashed", width: 1 } },
      ],
    };
  }, [series, keyMetric, team]);

  const ref = useECharts(option);

  return (
    <Modal title={`${team} — ${label}`} subtitle="Only bets where the model picked this team, home or away." onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Kpi label="Picks" value={summary.n.toLocaleString()} sub={`${summary.nGraded.toLocaleString()} graded`} />
          <Kpi label="Accuracy" value={pct(summary.accuracy)} sub={`${summary.wins}-${summary.losses}`} />
          <Kpi label="Profit" value={money(summary.totalProfit)} accent={profitColor(summary.totalProfit)} sub="flat $100 stake per bet" />
          <Kpi label="ROI" value={roiPct(summary.roi)} accent={profitColor(summary.roi)} />
        </div>

        <Card
          title="Favorite vs. underdog"
          subtitle="How often the model backs this team as the market's pre-game spread favorite vs. as the underdog, and how each does."
        >
          <div className="flex flex-wrap gap-3">
            <Kpi label="As favorite" value={favShare == null ? "--" : `${favN.toLocaleString()} (${pct(favShare, 0)})`} sub={`${pct(favSplit.favorite.accuracy)} accuracy · ${roiPct(favSplit.favorite.roi)} ROI`} accent={profitColor(favSplit.favorite.roi)} />
            <Kpi label="As underdog" value={dogShare == null ? "--" : `${dogN.toLocaleString()} (${pct(dogShare, 0)})`} sub={`${pct(favSplit.underdog.accuracy)} accuracy · ${roiPct(favSplit.underdog.roi)} ROI`} accent={profitColor(favSplit.underdog.roi)} />
            {unkN > 0 && <Kpi label="No spread on record" value={unkN.toLocaleString()} accent="#94a3b8" />}
          </div>
        </Card>

        <Card title="Profit over time" subtitle={`Running total for ${team}'s bets, one point per graded bet in chronological order.`}>
          {option ? <div ref={ref} className="h-[280px]" /> : <div className="grid h-[280px] place-items-center text-sm text-slate-400">No graded bets yet.</div>}
        </Card>

        <div className={tableWrapCls}>
          <table className="w-full border-collapse text-xs">
            <thead className={theadCls}>
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left align-bottom">Season</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Picks</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Accuracy</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">Profit</th>
                <th rowSpan={2} className="px-3 py-2 text-right align-bottom">ROI</th>
                <th colSpan={2} className="border-l border-slate-200 px-3 py-1 text-center normal-case tracking-normal text-slate-500">
                  As favorite
                </th>
              </tr>
              <tr>
                <th className="border-l border-slate-200 px-3 py-1.5 text-right">Times</th>
                <th className="px-3 py-1.5 text-right">Win %</th>
              </tr>
            </thead>
            <tbody>
              {[...bySeason].reverse().map(({ season, summary: s, favorite: f }) => (
                <tr key={season} className={trCls}>
                  <td className="px-3 py-2 font-bold">{season}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.n.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(s.accuracy)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(s.totalProfit) }}>
                    {money(s.totalProfit)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(s.roi) }}>
                    {roiPct(s.roi)}
                  </td>
                  <td className="border-l border-slate-100 px-3 py-2 text-right tabular-nums text-slate-500">{f.n || "--"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(f.accuracy)}</td>
                </tr>
              ))}
              {!bySeason.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No picks on this team yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
