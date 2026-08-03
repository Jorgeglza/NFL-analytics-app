// Port of the grading model page (4 tabs: Season, Teams, Weekly, Features).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getGrades, getFeatureImportance, getSchedule, getContribParams, type Row, type ContribParams } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Loading, ErrorRetry } from "../../components/Loading";
import { TabBar } from "../../components/TabBar";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";
import SeasonTab from "./SeasonTab";
import TeamsTab from "./TeamsTab";
import WeeklyTab from "./WeeklyTab";
import FeaturesTab from "./FeaturesTab";

const TABS = [
  ["Season", "🏆", "League-wide grade landscape for one season"],
  ["Teams", "🔍", "Why one team is graded what it is"],
  ["Weekly", "📊", "How one week's grades are distributed"],
  ["Features", "🧬", "What goes into every grade"],
] as const;
type Tab = (typeof TABS)[number][0];
const TAB_SLUGS: Record<string, Tab> = { season: "Season", teams: "Teams", weekly: "Weekly", features: "Features" };
const TAB_TO_SLUG: Record<Tab, string> = { Season: "season", Teams: "teams", Weekly: "weekly", Features: "features" };

export default function GradingModel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(TAB_SLUGS[searchParams.get("tab") ?? ""] ?? "Season");

  // Keep ?tab= in sync so the URL reflects what's on screen and the browser
  // back button undoes a tab change instead of leaving the page (P4.17).
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", TAB_TO_SLUG[tab]);
        return next;
      },
      { replace: true },
    );
  }, [tab, setSearchParams]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [importance, setImportance] = useState<Row[]>([]);
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [contribParams, setContribParams] = useState<ContribParams | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // Season is shared app-wide (audit §1); team is Teams-tab-specific but
  // still lifted so a click on a team in one tab (e.g. Weekly's ranking
  // table) can jump straight into the Teams tab already scoped to it.
  const { season: teamsSeason, setSeason: setTeamsSeason } = useSeasonWeek();
  const [teamsTeam, setTeamsTeam] = useState("DAL");
  const jumpToTeam = (team: string, season: string) => {
    setTeamsTeam(team);
    setTeamsSeason(season);
    setTab("Teams");
  };

  usePageTitle(tab === "Teams" ? `Grading Model — Teams: ${teamsTeam}` : `Grading Model — ${tab}`);

  useEffect(() => {
    setLoadError(null);
    Promise.all([getGrades(), getFeatureImportance(), getSchedule(), getTeamMetaMap(), getContribParams()])
      .then(([g, fi, s, m, cp]) => {
        setGrades(g);
        setImportance(fi);
        setSchedule(s);
        setMeta(m);
        setContribParams(cp);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }, [retryTick]);

  const loading = !grades.length || !meta || !contribParams;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Grading Model</h1>
        <p className="mt-1 pl-4 text-sm text-slate-500">What every team's grade means, why it landed there, and what feeds into it.</p>
      </div>

      {/* Prominent section tabs — cards, not a lost pill bar (matches Matchup Previews). */}
      <TabBar tabs={TABS} active={tab} onChange={setTab} gridClassName="sm:grid-cols-4" />

      {loadError ? (
        <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />
      ) : loading ? (
        <Loading label="Loading model data…" />
      ) : (
        <>
          {tab === "Season" && <SeasonTab grades={grades} schedule={schedule} meta={meta} />}
          {tab === "Teams" && (
            <TeamsTab
              grades={grades}
              meta={meta}
              contribParams={contribParams}
              season={teamsSeason}
              onSeasonChange={setTeamsSeason}
              team={teamsTeam}
              onTeamChange={setTeamsTeam}
            />
          )}
          {tab === "Weekly" && <WeeklyTab grades={grades} schedule={schedule} meta={meta} onSelectTeam={jumpToTeam} />}
          {tab === "Features" && <FeaturesTab importance={importance} />}
        </>
      )}
    </div>
  );
}
