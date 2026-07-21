// Power Rankings — new analytics (not a port). State of the league for any
// selected week: a composite of Elo, season-to-date Overall Grade, and
// Pythagorean win% (lib/logic/powerRankings.ts), with movement vs. last week.
// Clicking a team opens a breakdown popup (lib/logic's computeTeamBreakdown)
// with the rank-evolution chart at the bottom.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getSchedule, getGrades, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { computePowerRankings, computeTeamBreakdown, computeTeamRankTrend, type PowerRankingRow } from "../../lib/logic/powerRankings";
import { Select } from "../../components/filters/Select";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";
import { PageHeader, tableWrapCls, theadCls, trCls } from "../../components/ui";
import DetailModal from "./power-rankings/DetailModal";

const stepBtnCls =
  "grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500";

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

export default function PowerRankings() {
  const { season, week, setSeason, setWeek } = useSeasonWeek();
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  usePageTitle(season && week ? `Power Rankings — Wk ${week}, ${season}` : "Power Rankings");

  useEffect(() => {
    Promise.all([getSchedule(), getGrades(), getTeamMetaMap()]).then(([s, g, m]) => {
      setSchedule(s);
      setGrades(g);
      setMeta(m);
    });
  }, []);

  const seasons = useMemo(() => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a), [schedule]);
  const weeks = useMemo(
    () =>
      [...new Set(schedule.filter((r) => String(r.season) === season && r.game_type === "REG").map((r) => Number(r.week)))].sort(
        (a, b) => a - b,
      ),
    [schedule, season],
  );

  const stepWeek = (dir: -1 | 1) => {
    const idx = weeks.indexOf(Number(week));
    const next = weeks[idx + dir];
    if (next != null) setWeek(String(next));
  };

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

  if (!schedule.length || !grades.length || !meta) return <Loading label="Loading rankings…" />;

  const weekIdx = weeks.indexOf(Number(week));

  return (
    <div className="space-y-6">
      <PageHeader title="Power Rankings" subtitle="Composite team strength — Elo, season-to-date grade, and Pythagorean win% blended for any week. Click a team for the full breakdown, or compare two for a tough call.">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <div className="flex items-end gap-1.5">
          <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <button className={stepBtnCls} onClick={() => stepWeek(-1)} disabled={weekIdx <= 0} title="Previous week">‹</button>
          <button className={stepBtnCls} onClick={() => stepWeek(1)} disabled={weekIdx < 0 || weekIdx >= weeks.length - 1} title="Next week">›</button>
        </div>
      </PageHeader>

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
