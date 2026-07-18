// Matchup Previews page (3 tabs: Week Preview, Matchup, Model Overview).
// Loads all seasons' team_week data once so the shared engine can compute
// trend features and grades for any game.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, getGrades, getTeamWeek, getTeamWeekRanks, getMeta, type Row } from "../../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../../lib/team/meta";
import { buildHist, buildGradesIndex, buildTeamWeekIndex, buildScheduleEloIndex } from "./engine";
import { Loading } from "../../../components/Loading";
import WeekPreviewTab from "./WeekPreviewTab";
import MatchupTab from "./MatchupTab";
import ModelOverviewTab from "./ModelOverviewTab";

const TABS = [
  ["Week Preview", "🗓️", "This week's slate — all models per game"],
  ["Matchup", "⚔️", "One game, all the evidence"],
  ["Model Overview", "🎯", "Historical accuracy of every model"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function MatchupPreviews() {
  const [tab, setTab] = useState<Tab>("Week Preview");
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]> | null>(null);
  const [ranksBySeason, setRanksBySeason] = useState<Map<number, Row[]>>(new Map());

  useEffect(() => {
    (async () => {
      const [s, g, m, mt] = await Promise.all([getSchedule(), getGrades(), getTeamMetaMap(), getMeta()]);
      setSchedule(s);
      setGrades(g);
      setMeta(m);
      const twEntries = await Promise.all(
        mt.seasons.map(async (season) => {
          const tw = await getTeamWeek(season);
          return [season, tw.filter((r) => r.game_type === "REG" || r.game_type == null)] as [number, Row[]];
        }),
      );
      setTeamWeekBySeason(new Map(twEntries));
      const rkEntries = await Promise.all(
        mt.seasons.map(async (season) => [season, await getTeamWeekRanks(season)] as [number, Row[]]),
      );
      setRanksBySeason(new Map(rkEntries));
    })();
  }, []);

  const hist = useMemo(() => (schedule.length ? buildHist(schedule) : null), [schedule]);
  const gradesIdx = useMemo(() => (grades.length ? buildGradesIndex(grades) : null), [grades]);
  const twIdx = useMemo(() => (teamWeekBySeason ? buildTeamWeekIndex(teamWeekBySeason) : null), [teamWeekBySeason]);
  const eloIdx = useMemo(() => (schedule.length ? buildScheduleEloIndex(schedule) : null), [schedule]);

  const loading = !schedule.length || !meta || !hist || !gradesIdx || !twIdx || !eloIdx;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Matchup Previews</h1>
        <a href="#/game_analysis/models_guide" className="rounded-full border border-[#002f6c]/25 px-3 py-1.5 text-xs font-semibold text-[#002f6c] transition-colors hover:bg-[#002f6c]/5">
          📖 How the models work →
        </a>
      </div>

      {/* Prominent section tabs — cards, not a lost pill bar */}
      <div className="grid gap-2 sm:grid-cols-3">
        {TABS.map(([t, icon, desc]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-2xl border px-4 py-2.5 text-left shadow-sm transition-all ${
              tab === t ? "border-[#002f6c] bg-[#002f6c] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[#002f6c]/40"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>{icon}</span>
              {t}
            </div>
            <div className={`mt-0.5 text-[11px] ${tab === t ? "text-white/75" : "text-slate-400"}`}>{desc}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <Loading label="Loading all seasons…" />
      ) : (
        <>
          {tab === "Week Preview" && <WeekPreviewTab schedule={schedule} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} eloIdx={eloIdx} />}
          {tab === "Matchup" && <MatchupTab schedule={schedule} ranks={ranksBySeason} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} eloIdx={eloIdx} />}
          {tab === "Model Overview" && <ModelOverviewTab schedule={schedule} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} eloIdx={eloIdx} />}
        </>
      )}
    </div>
  );
}
