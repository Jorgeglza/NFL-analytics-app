import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { TeamCompositeBreakdown } from "../../../lib/logic/powerRankings";
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
  const { eloGame, weeklyGrades, weeklyPoints } = breakdown;

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
          lineStyle: { color: meta?.color ?? "#002f6c", width: 2 },
          itemStyle: { color: meta?.color ?? "#002f6c" },
        },
      ],
    } as EChartsOption;
  }, [trend, meta]);
  const trendRef = useECharts(trendOption);

  return (
    <Modal
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

        <Card title="Season-to-date Overall Grade" subtitle="Average of the Random Forest grading model's weekly Overall Grade" accent="#E87722">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {weeklyGrades.map((g) => (
              <span key={g.week} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600" title={`Week ${g.week}`}>
                Wk{g.week}: {g.grade.toFixed(1)}
              </span>
            ))}
            {!weeklyGrades.length && <span className="text-xs text-slate-400">No grades yet.</span>}
          </div>
          <MetricRow label={`Average of ${weeklyGrades.length} week(s)`} value={breakdown.gradeAvg == null ? "—" : breakdown.gradeAvg.toFixed(1)} />
          <div className="mt-2 border-t border-slate-100 pt-2">
            <MetricRow
              label={breakdown.gradeRange ? `League range this week [${breakdown.gradeRange[0].toFixed(1)} – ${breakdown.gradeRange[1].toFixed(1)}]` : "League range"}
              value={pct(breakdown.gradeNorm)}
            />
          </div>
        </Card>

        <Card title="Pythagorean win%" subtitle="Expected win share from cumulative points for/against (exponent 2.37)" accent="#3C9A5F">
          <MetricRow label={`Points for (${weeklyPoints.length} games)`} value={breakdown.pointsForTotal} />
          <MetricRow label="Points against" value={breakdown.pointsAgainstTotal} />
          <MetricRow label="Pythagorean win%" value={pct(breakdown.pythPct)} />
          <div className="mt-2 border-t border-slate-100 pt-2">
            <MetricRow
              label={breakdown.pythRange ? `League range this week [${(breakdown.pythRange[0] * 100).toFixed(1)}% – ${(breakdown.pythRange[1] * 100).toFixed(1)}%]` : "League range"}
              value={pct(breakdown.pythNorm)}
            />
          </div>
        </Card>

        <Card title="Composite score" subtitle="Mean of the three normalized (0–1) signals above — nulls skipped, not zeroed" accent="#002f6c">
          <MetricRow label="Elo (normalized)" value={pct(breakdown.eloNorm)} />
          <MetricRow label="Grade (normalized)" value={pct(breakdown.gradeNorm)} />
          <MetricRow label="Pythagorean (normalized)" value={pct(breakdown.pythNorm)} />
          <div className="mt-2 border-t border-slate-100 pt-2">
            <MetricRow label="Composite" value={(breakdown.composite * 100).toFixed(1)} />
          </div>
        </Card>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Rank evolution — {breakdown.season}</h3>
          {trendOption ? <div ref={trendRef} className="h-64" /> : <div className="py-8 text-center text-sm text-slate-400">No trend data yet.</div>}
        </div>
      </div>
    </Modal>
  );
}
