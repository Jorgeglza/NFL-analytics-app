// Power Rankings tab — composite team strength (Elo, season-to-date Overall
// Grade, and Pythagorean win%; see lib/logic/powerRankings.ts) for the
// season/week selected up top in Season Outlook, with movement vs. last
// week. Clicking a team opens a breakdown popup with the rank-evolution
// chart at the bottom.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { computePowerRankings, computeTeamBreakdown, computeTeamRankTrend, type PowerRankingRow } from "../../../lib/logic/powerRankings";
import { tableWrapCls, theadCls, trCls } from "../../../components/ui";
import DetailModal from "../power-rankings/DetailModal";

function MovementBadge({ movement }: { movement: number | null }) {
  if (movement == null) return <span className="text-xs text-slate-400">—</span>;
  if (movement === 0) return <span className="text-xs text-slate-400">–</span>;
  const up = movement > 0;
  return (
    <span className={`text-xs font-bold ${up ? "text-[#3C9A5F]" : "text-[#C8102E]"}`}>
      {up ? "▲" : "▼"} {Math.abs(movement)}
    </span>
  );
}

export default function PowerRankingsTab({
  schedule,
  grades,
  season,
  week,
  weeks,
  meta,
}: {
  schedule: Row[];
  grades: Row[];
  season: string;
  week: string;
  weeks: number[];
  meta: Map<string, TeamMeta>;
}) {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  const rankings = useMemo<PowerRankingRow[]>(() => {
    if (!schedule.length || !grades.length || !season || !week) return [];
    return computePowerRankings(schedule, grades, Number(season), Number(week));
  }, [schedule, grades, season, week]);

  const breakdown = useMemo(() => {
    if (!selectedTeam || !schedule.length || !grades.length || !season || !week) return null;
    return computeTeamBreakdown(schedule, grades, Number(season), Number(week), selectedTeam);
  }, [selectedTeam, schedule, grades, season, week]);

  const trend = useMemo(() => {
    if (!selectedTeam || !schedule.length || !grades.length || !season) return [];
    return computeTeamRankTrend(schedule, grades, Number(season), selectedTeam, weeks);
  }, [selectedTeam, schedule, grades, season, weeks]);

  return (
    <div className="space-y-6">
      <div className={tableWrapCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              {["Rank", "Move", "Team", "Composite", "Elo", "Grade", "Pyth %", ""].map((h) => (
                <th key={h} className="px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rankings.map((r) => {
              const tm = meta.get(r.team);
              return (
                <tr key={r.team} className={`${trCls} cursor-pointer`} onClick={() => setSelectedTeam(r.team)}>
                  <td className="px-3 py-2 font-bold text-slate-800">{r.rank}</td>
                  <td className="px-3 py-2"><MovementBadge movement={r.movement} /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      {tm?.logo && <img src={tm.logo} alt="" className="h-5 w-5 object-contain" />}
                      {tm?.name ?? r.team}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700">{(r.composite * 100).toFixed(1)}</td>
                  <td className="px-3 py-2 text-slate-600">{Math.round(r.elo)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.grade == null ? "—" : r.grade.toFixed(1)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.pythPct == null ? "—" : `${(r.pythPct * 100).toFixed(1)}%`}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/game_analysis/team_trends?team1=${r.team}`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-[#002f6c]/50 hover:text-[#002f6c]"
                      title={`Compare ${tm?.name ?? r.team}'s trend against other teams`}
                    >
                      Compare
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {breakdown && (
        <DetailModal breakdown={breakdown} trend={trend} meta={meta.get(breakdown.team)} onClose={() => setSelectedTeam(null)} />
      )}
    </div>
  );
}
