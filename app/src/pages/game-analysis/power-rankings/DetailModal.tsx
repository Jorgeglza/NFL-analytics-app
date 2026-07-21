import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { TeamCompositeBreakdown, WeeklyGradeDetail, WeeklyCompositeDetail } from "../../../lib/logic/powerRankings";
import type { TeamMeta } from "../../../lib/team/meta";
import { Modal } from "../../../components/Modal";
import { useECharts } from "../../../components/charts/useECharts";
import { Card } from "../../../components/ui";

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function gradeTooltip(g: WeeklyGradeDetail): string {
  const vs = g.opponent ? `${g.home ? "vs" : "@"} ${g.opponent}` : "";
  const score = g.teamScore != null ? ` — ${g.teamScore}–${g.opponentScore}` : "";
  return `Week ${g.week} ${vs}${score}<br/>Overall Grade: <b>${g.grade.toFixed(1)}</b>`;
}

/** Points-for-vs-against split bar, sized by the resulting Pythagorean win share — the raw score behind the number. */
function PythSplitBar({ pf, pa, pythPct, color }: { pf: number; pa: number; pythPct: number | null; color: string }) {
  const forPct = pythPct == null ? 50 : pythPct * 100;
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-full ring-1 ring-inset ring-black/5">
        <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${forPct}%`, background: color }} title={`Points for: ${pf}`}>
          {pf}
        </div>
        <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${100 - forPct}%`, background: "#94a3b8" }} title={`Points against: ${pa}`}>
          {pa}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-400">
        <span>Points for</span>
        <span>Points against</span>
      </div>
    </div>
  );
}

export default function DetailModal({
  breakdown,
  trend,
  meta,
  onClose,
}: {
  breakdown: TeamCompositeBreakdown;
  trend: { week: number; rank: number }[];
  meta: TeamMeta | undefined;
  onClose: () => void;
}) {
  const { eloGame, weeklyGrades, weeklyComposite } = breakdown;
  const accent = meta?.color ?? "#002f6c";

  const gradeOption = useMemo<EChartsOption | null>(() => {
    if (!weeklyGrades.length) return null;
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: weeklyGrades.map((g) => `Wk${g.week}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10 } },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => gradeTooltip(weeklyGrades[(p as { dataIndex: number }).dataIndex]),
      },
      series: [
        {
          type: "bar",
          data: weeklyGrades.map((g) => ({ value: g.grade, itemStyle: { color: "#E87722" } })),
          barMaxWidth: 18,
        },
      ],
    } as EChartsOption;
  }, [weeklyGrades]);
  const gradeRef = useECharts(gradeOption);

  const compositeOption = useMemo<EChartsOption | null>(() => {
    if (!weeklyComposite.length) return null;
    return {
      grid: { left: 10, right: 10, top: 24, bottom: 10, containLabel: true },
      legend: { top: 0, textStyle: { fontSize: 10 } },
      xAxis: { type: "category", data: weeklyComposite.map((c) => `Wk${c.week}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { fontSize: 10 } },
      tooltip: {
        trigger: "axis",
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const d: WeeklyCompositeDetail = weeklyComposite[arr[0].dataIndex];
          return `Week ${d.week}<br/>${meta?.name ?? breakdown.team}: <b>${(d.composite * 100).toFixed(1)}</b><br/>League avg: ${(d.leagueAvg * 100).toFixed(1)}`;
        },
      },
      series: [
        {
          name: meta?.name ?? breakdown.team,
          type: "line",
          data: weeklyComposite.map((c) => c.composite * 100),
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { color: accent, width: 2.5 },
          itemStyle: { color: accent },
        },
        {
          name: "League avg",
          type: "line",
          data: weeklyComposite.map((c) => c.leagueAvg * 100),
          symbol: "none",
          lineStyle: { color: "#94a3b8", width: 1.5, type: "dashed" },
        },
      ],
    } as EChartsOption;
  }, [weeklyComposite, accent, meta, breakdown.team]);
  const compositeRef = useECharts(compositeOption);

  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!trend.length) return null;
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: trend.map((p) => `Wk ${p.week}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "Rank", inverse: true, min: 1, axisLabel: { fontSize: 10 } },
      tooltip: { trigger: "axis" },
      series: [
        {
          type: "line",
          data: trend.map((p) => p.rank),
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
        },
      ],
    } as EChartsOption;
  }, [trend, accent]);
  const trendRef = useECharts(trendOption);

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          {meta?.logo && <img src={meta.logo} alt="" className="h-6 w-6 object-contain" />}
          {meta?.name ?? breakdown.team} — Rank #{breakdown.rank}
        </div>
      }
      subtitle={`Week ${breakdown.week}, ${breakdown.season} — composite ${(breakdown.composite * 100).toFixed(1)}`}
    >
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Elo rating" subtitle="Chess-style power rating updated after every game" accent="#7c3aed">
            {eloGame.played ? (
              <>
                <MetricRow label={`This week's game`} value={`${eloGame.home ? "vs" : "@"} ${eloGame.opponent} — ${eloGame.teamScore}–${eloGame.opponentScore}`} />
                <MetricRow label="Pre-game rating (this team)" value={Math.round(eloGame.preGameElo)} />
                <MetricRow label="Pre-game rating (opponent)" value={Math.round(eloGame.opponentPreGameElo)} />
                <MetricRow label="Home-field advantage" value={`+${eloGame.hfa}`} />
                <MetricRow label="K-factor" value={eloGame.k} />
                <MetricRow label="Margin-of-victory multiplier" value={eloGame.movMultiplier!.toFixed(3)} />
                <MetricRow label="Rating change" value={`${eloGame.delta! >= 0 ? "+" : ""}${eloGame.delta!.toFixed(1)}`} />
                <MetricRow label="Post-game rating" value={Math.round(eloGame.postGameElo)} />
              </>
            ) : (
              <>
                <MetricRow label="This week" value={eloGame.opponent ? `${eloGame.home ? "vs" : "@"} ${eloGame.opponent} — not yet played` : "Bye week"} />
                <MetricRow label="Current rating" value={Math.round(eloGame.postGameElo)} />
              </>
            )}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <MetricRow label={`League range this week [${Math.round(breakdown.eloRange[0])} – ${Math.round(breakdown.eloRange[1])}]`} value={pct(breakdown.eloNorm)} />
            </div>
          </Card>

          <Card title="Season-to-date Overall Grade" subtitle="Weekly Overall Grade — hover a bar for that week's opponent/score" accent="#E87722">
            {gradeOption ? <div ref={gradeRef} className="h-40" /> : <div className="py-6 text-center text-xs text-slate-400">No grades yet.</div>}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <MetricRow label={`Average of ${weeklyGrades.length} week(s)`} value={breakdown.gradeAvg == null ? "—" : breakdown.gradeAvg.toFixed(1)} />
              <MetricRow
                label={breakdown.gradeRange ? `League range this week [${breakdown.gradeRange[0].toFixed(1)} – ${breakdown.gradeRange[1].toFixed(1)}]` : "League range"}
                value={pct(breakdown.gradeNorm)}
              />
            </div>
          </Card>

          <Card title="Pythagorean win%" subtitle={`Score to date (${breakdown.weeklyPoints.length} games) and the win share it implies`} accent="#3C9A5F">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <PythSplitBar pf={breakdown.pointsForTotal} pa={breakdown.pointsAgainstTotal} pythPct={breakdown.pythPct} color="#3C9A5F" />
              </div>
              <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-center" title="Pythagorean expected win share">
                <div className="text-lg font-extrabold text-slate-800">{pct(breakdown.pythPct)}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">win share</div>
              </div>
            </div>
            {weeklyGrades.length > 0 && (
              <div className="mt-3 max-h-28 space-y-0.5 overflow-y-auto pr-1">
                {weeklyGrades.map((g) => {
                  const won = g.teamScore != null && g.opponentScore != null ? g.teamScore > g.opponentScore : null;
                  return (
                    <div key={g.week} className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Wk{g.week} {g.home ? "vs" : "@"} {g.opponent ?? "—"}
                      </span>
                      <span className={won == null ? "text-slate-400" : won ? "text-[#3C9A5F] font-semibold" : "text-[#C8102E] font-semibold"}>
                        {g.teamScore != null ? `${won ? "W" : "L"} ${g.teamScore}–${g.opponentScore}` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <MetricRow
                label={breakdown.pythRange ? `League range this week [${(breakdown.pythRange[0] * 100).toFixed(1)}% – ${(breakdown.pythRange[1] * 100).toFixed(1)}%]` : "League range"}
                value={pct(breakdown.pythNorm)}
              />
            </div>
          </Card>

          <Card title="Composite score" subtitle="This team vs. the league average, week by week" accent={accent}>
            {compositeOption ? <div ref={compositeRef} className="h-40" /> : <div className="py-6 text-center text-xs text-slate-400">No data yet.</div>}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <MetricRow label="Elo (normalized)" value={pct(breakdown.eloNorm)} />
              <MetricRow label="Grade (normalized)" value={pct(breakdown.gradeNorm)} />
              <MetricRow label="Pythagorean (normalized)" value={pct(breakdown.pythNorm)} />
              <MetricRow label="Composite" value={(breakdown.composite * 100).toFixed(1)} />
            </div>
          </Card>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Rank evolution — {breakdown.season}</h3>
          {trendOption ? <div ref={trendRef} className="h-64" /> : <div className="py-8 text-center text-sm text-slate-400">No trend data yet.</div>}
        </div>
      </div>
    </Modal>
  );
}
