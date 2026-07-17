// Matchup Previews page (3 tabs: Week Preview, Matchup, Model Overview).
// Loads all seasons' team_week data once so the shared engine can compute
// trend features and grades for any game.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, getGrades, getTeamWeek, getTeamWeekRanks, getMeta, type Row } from "../../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../../lib/team/meta";
import { buildHist, buildGradesIndex, buildTeamWeekIndex } from "./engine";
import WeekPreviewTab from "./WeekPreviewTab";
import MatchupTab from "./MatchupTab";
import ModelOverviewTab from "./ModelOverviewTab";

const TABS = ["Week Preview", "Matchup", "Model Overview"] as const;
type Tab = (typeof TABS)[number];

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

  const loading = !schedule.length || !meta || !hist || !gradesIdx || !twIdx;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-2xl font-bold text-[#002f6c]">Matchup Previews</h1>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === t ? "bg-[#002f6c] text-white" : "text-slate-600 hover:bg-slate-200"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading all seasons…</div>
      ) : (
        <>
          {tab === "Week Preview" && <WeekPreviewTab schedule={schedule} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} />}
          {tab === "Matchup" && <MatchupTab schedule={schedule} ranks={ranksBySeason} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} />}
          {tab === "Model Overview" && <ModelOverviewTab schedule={schedule} meta={meta} hist={hist} gradesIdx={gradesIdx} twIdx={twIdx} />}
        </>
      )}
    </div>
  );
}
