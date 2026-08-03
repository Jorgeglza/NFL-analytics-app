// Matchup Previews page (3 tabs: Week Preview, Matchup, Model Overview).
// Loads all seasons' team_week data once so the shared engine can compute
// trend features and grades for any game.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { getSchedule, getGrades, getTeamWeek, getTeamWeekRanks, getMeta, getPredictiveModelGames, getPredictiveModelMeta, type Row } from "../../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../../lib/team/meta";
import { buildHist, buildGradesIndex, buildTeamWeekIndex, buildScheduleEloIndex, buildPredictiveIndex, type PredictiveIndex } from "./engine";
import { Loading, ErrorRetry } from "../../../components/Loading";
import { useIsMobileViewport } from "../../../lib/useIsMobileViewport";
import { TabBar } from "../../../components/TabBar";
import { usePageTitle } from "../../../lib/hooks/usePageTitle";
import WeekPreviewTab from "./WeekPreviewTab";
import MatchupTab from "./MatchupTab";
import ModelOverviewTab from "./ModelOverviewTab";
import ModelPickerTab from "./ModelPickerTab";
import { InfoDot } from "../../../components/InfoDot";

const TABS = [
  ["Week Preview", "🗓️", "This week's slate — all models per game"],
  ["Matchup", "⚔️", "One game, all the evidence"],
  ["Model Overview", "🎯", "Historical accuracy of every model"],
  ["Model Picker", "🧭", "Which model is best, and in which scenario"],
] as const;
type Tab = (typeof TABS)[number][0];
const TAB_SLUGS: Record<string, Tab> = { matchup: "Matchup", week: "Week Preview", overview: "Model Overview", picker: "Model Picker" };
const TAB_TO_SLUG: Record<Tab, string> = { Matchup: "matchup", "Week Preview": "week", "Model Overview": "overview", "Model Picker": "picker" };

export default function MatchupPreviews() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(TAB_SLUGS[searchParams.get("tab") ?? ""] ?? "Week Preview");

  // Keep ?tab= in sync so the URL always reflects what's on screen — lets
  // "How the models work" (and browser back/forward) return to the exact tab.
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
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]> | null>(null);
  const [ranksBySeason, setRanksBySeason] = useState<Map<number, Row[]>>(new Map());
  const [matchupSelection, setMatchupSelection] = useState<{ season: string; week: string; game: string } | null>(null);
  // Predictive model (7th input to the consensus) — historical-only, precomputed lookup.
  // Loaded separately from the rest so a missing/malformed export never blocks the other
  // 6 models: predictiveUnavailable becomes true only on load failure, not on a plain
  // "no prediction for this game" miss (that's handled silently inside probBundle).
  const [predIdx, setPredIdx] = useState<PredictiveIndex | null>(null);
  const [predictiveUnavailable, setPredictiveUnavailable] = useState(false);
  const [predictiveCoverage, setPredictiveCoverage] = useState<{ min: number; max: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const isMobile = useIsMobileViewport();

  const openMatchup = (season: string, week: string, game: string) => {
    setMatchupSelection({ season, week, game });
    setTab("Matchup");
  };

  // MatchupTab sets its own (game-specific) title while active — skip here to
  // avoid a parent/child effect-ordering race clobbering it.
  usePageTitle(tab === "Matchup" ? undefined : `Matchup Previews — ${tab}`);

  useEffect(() => {
    let cancelled = false;
    // Fetches team_week + team_week_ranks for the given seasons and merges
    // them into the existing per-season maps (not a replace — this may run
    // twice, once for the priority season(s) and once for the rest).
    const loadSeasons = async (seasons: number[]) => {
      const [twEntries, rkEntries] = await Promise.all([
        Promise.all(
          seasons.map(async (season) => {
            const tw = await getTeamWeek(season);
            return [season, tw.filter((r) => r.game_type === "REG" || r.game_type == null)] as [number, Row[]];
          }),
        ),
        Promise.all(seasons.map(async (season) => [season, await getTeamWeekRanks(season)] as [number, Row[]])),
      ]);
      if (cancelled) return;
      setTeamWeekBySeason((prev) => new Map([...(prev ?? []), ...twEntries]));
      setRanksBySeason((prev) => new Map([...prev, ...rkEntries]));
    };

    (async () => {
      try {
        setLoadError(null);
        const [s, g, m, mt] = await Promise.all([getSchedule(), getGrades(), getTeamMetaMap(), getMeta()]);
        if (cancelled) return;
        setSchedule(s);
        setGrades(g);
        setMeta(m);

        // On mobile, fetch only the current season's team_week/ranks eagerly
        // (~1.3 MB instead of ~14 MB across all seasons) so the page becomes
        // usable quickly on a slow connection, then fill in the remaining
        // seasons in the background — the Week Preview tab (the default
        // landing tab) only needs the current season; older seasons resolve
        // in place once loaded (buildTeamWeekIndex already treats a
        // not-yet-loaded season as "no rows", the same as it would for any
        // season with genuinely no data, so nothing crashes in the meantime).
        // Desktop is untouched: `prioritySeasons` is every season, exactly
        // the single eager Promise.all this page has always done.
        const prioritySeasons = isMobile ? [mt.current_season] : mt.seasons;
        const deferredSeasons = isMobile ? mt.seasons.filter((yr) => yr !== mt.current_season) : [];

        await loadSeasons(prioritySeasons);
        if (deferredSeasons.length) {
          // Best-effort background fill — intentionally not awaited and not
          // wired into loadError, so a dropped connection on an older season
          // doesn't block or fail the page the user is already looking at.
          loadSeasons(deferredSeasons).catch(() => {});
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    Promise.all([getPredictiveModelGames(), getPredictiveModelMeta()])
      .then(([rows, m]) => {
        if (cancelled) return;
        setPredIdx(buildPredictiveIndex(rows));
        setPredictiveCoverage(m.test_seasons.length ? { min: Math.min(...m.test_seasons), max: Math.max(...m.test_seasons) } : null);
      })
      .catch(() => {
        if (!cancelled) setPredictiveUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isMobile is read once per attempt, not a live dependency
  }, [retryTick]);

  const hist = useMemo(() => (schedule.length ? buildHist(schedule) : null), [schedule]);
  const gradesIdx = useMemo(() => (grades.length ? buildGradesIndex(grades) : null), [grades]);
  const twIdx = useMemo(() => (teamWeekBySeason ? buildTeamWeekIndex(teamWeekBySeason) : null), [teamWeekBySeason]);
  const eloIdx = useMemo(() => (schedule.length ? buildScheduleEloIndex(schedule) : null), [schedule]);

  const loading = !schedule.length || !meta || !hist || !gradesIdx || !twIdx || !eloIdx;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
          <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
          Matchup Previews
          <InfoDot text="Zoom out to see how every team stacks up all season on Power Rankings." />
        </h1>
        <a
          href={`#/game_analysis/models_guide?back=${encodeURIComponent(location.pathname + location.search)}`}
          className="rounded-full border border-[#002f6c]/25 px-3 py-1.5 text-xs font-semibold text-[#002f6c] transition-colors hover:bg-[#002f6c]/5"
        >
          📖 How the models work →
        </a>
      </div>

      {/* Prominent section tabs — cards, not a lost pill bar */}
      <TabBar tabs={TABS} active={tab} onChange={setTab} gridClassName="sm:grid-cols-2 lg:grid-cols-4" />

      {loadError ? (
        <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />
      ) : loading ? (
        <Loading label="Loading all seasons…" />
      ) : (
        <>
          {tab === "Week Preview" && (
            <WeekPreviewTab
              schedule={schedule}
              meta={meta}
              hist={hist}
              gradesIdx={gradesIdx}
              twIdx={twIdx}
              eloIdx={eloIdx}
              predIdx={predIdx ?? undefined}
              predictiveUnavailable={predictiveUnavailable}
              predictiveCoverage={predictiveCoverage}
              onOpenMatchup={openMatchup}
            />
          )}
          {tab === "Matchup" && (
            <MatchupTab
              schedule={schedule}
              ranks={ranksBySeason}
              meta={meta}
              hist={hist}
              gradesIdx={gradesIdx}
              twIdx={twIdx}
              eloIdx={eloIdx}
              predIdx={predIdx ?? undefined}
              predictiveUnavailable={predictiveUnavailable}
              predictiveCoverage={predictiveCoverage}
              initialSelection={matchupSelection}
            />
          )}
          {tab === "Model Overview" && (
            <ModelOverviewTab
              schedule={schedule}
              meta={meta}
              hist={hist}
              gradesIdx={gradesIdx}
              twIdx={twIdx}
              eloIdx={eloIdx}
              predIdx={predIdx ?? undefined}
              predictiveUnavailable={predictiveUnavailable}
              predictiveCoverage={predictiveCoverage}
            />
          )}
          {tab === "Model Picker" && (
            <ModelPickerTab
              schedule={schedule}
              hist={hist}
              gradesIdx={gradesIdx}
              twIdx={twIdx}
              eloIdx={eloIdx}
              predIdx={predIdx ?? undefined}
              predictiveUnavailable={predictiveUnavailable}
              predictiveCoverage={predictiveCoverage}
            />
          )}
        </>
      )}
    </div>
  );
}
