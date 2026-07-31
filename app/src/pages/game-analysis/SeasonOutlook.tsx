// Season Outlook — new analytics (not a port). Where the league stands and
// what's ahead: composite power rankings, strength of the remaining
// schedule, and playoff probability from a Monte Carlo simulation. Week
// selector (defaults to the current week via the shared season/week
// context) lets all three tabs be backtested "as of" any past week. Each tab
// has its own sub-URL (/game_analysis/season_outlook/<tab>) so it's
// linkable/bookmarkable and Home/Navbar highlighting still works via prefix
// match.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSchedule, getGrades, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";
import { PageHeader } from "../../components/ui";
import { TabBar } from "../../components/TabBar";
import PowerRankingsTab from "./season-outlook/PowerRankingsTab";
import SosTab from "./season-outlook/SosTab";
import PlayoffTab from "./season-outlook/PlayoffTab";

const TABS = [
  ["Power Rankings", "power_rankings", "📊", "Composite team strength — Elo, grade and Pythagorean win%, with movement"],
  ["Strength of Schedule", "strength_of_schedule", "🗓️", "Opponent difficulty, played vs. remaining"],
  ["Playoff Probability", "playoff_probability", "🏈", "Monte Carlo odds of making — and winning — the postseason"],
] as const;
type Tab = (typeof TABS)[number][0];
const SLUG_TO_TAB = new Map<string, Tab>(TABS.map(([t, slug]) => [slug, t]));
const DEFAULT_TAB: Tab = TABS[0][0];

const stepBtnCls =
  "grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500";

export default function SeasonOutlook() {
  const { tab: tabSlug } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const tab: Tab = (tabSlug && SLUG_TO_TAB.get(tabSlug)) || DEFAULT_TAB;
  const setTab = (t: Tab) => {
    const slug = TABS.find(([label]) => label === t)![1];
    navigate(`/game_analysis/season_outlook/${slug}`);
  };
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const { season, week, setSeason, setWeek } = useSeasonWeek();

  usePageTitle(`Season Outlook — ${tab}`);

  // Redirect bare/unknown sub-paths (e.g. the old bare /season_outlook link) to the default tab.
  useEffect(() => {
    if (!tabSlug || !SLUG_TO_TAB.has(tabSlug)) navigate(`/game_analysis/season_outlook/${TABS[0][1]}`, { replace: true });
  }, [tabSlug, navigate]);

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

  const loading = !schedule.length || !grades.length || !meta || !season || !week;

  return (
    <div className="space-y-4">
      <PageHeader title="Season Outlook" subtitle="Where the league stands and what's ahead — power rankings, remaining schedule difficulty and postseason odds, as of any week (backtestable).">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <div className="flex items-end gap-1.5">
          <Select label="As of week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <button className={stepBtnCls} onClick={() => stepWeek(-1)} disabled={weeks.indexOf(Number(week)) <= 0} title="Previous week">‹</button>
          <button
            className={stepBtnCls}
            onClick={() => stepWeek(1)}
            disabled={weeks.indexOf(Number(week)) < 0 || weeks.indexOf(Number(week)) >= weeks.length - 1}
            title="Next week"
          >
            ›
          </button>
        </div>
      </PageHeader>

      <TabBar tabs={TABS.map(([t, , icon, desc]) => [t, icon, desc] as const)} active={tab} onChange={setTab} gridClassName="sm:grid-cols-3" />

      {loading ? (
        <Loading label="Loading season data…" />
      ) : (
        <>
          {tab === "Power Rankings" && <PowerRankingsTab schedule={schedule} grades={grades} season={season} week={week} weeks={weeks} meta={meta} />}
          {tab === "Strength of Schedule" && <SosTab schedule={schedule} season={season} week={week} meta={meta} />}
          {tab === "Playoff Probability" && <PlayoffTab schedule={schedule} season={season} week={week} meta={meta} />}
        </>
      )}
    </div>
  );
}
