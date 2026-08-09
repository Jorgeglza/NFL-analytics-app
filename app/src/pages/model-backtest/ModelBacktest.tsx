// Model Backtest page — is any prediction sub-model profitable betting
// straight-up (moneyline) against real sportsbook payout odds? New page, not
// a Dash port: builds on the existing Matchup Previews engine (probBundle/
// pickWinner, already proven at full-history scale by ModelOverviewTab/
// ModelPickerTab) plus new payout/ROI math in lib/logic/backtest.ts. See
// docs/FUTURE_DEVELOPMENT.md for the original scoping and
// docs/logic-reference.md for the payout/ROI formulas.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getSchedule,
  getGrades,
  getTeamWeek,
  getMeta,
  getPredictiveModelGames,
  getPredictiveModelMeta,
  getPredictiveModelUpcoming,
  getPredictiveModelUpcomingMeta,
  type Row,
} from "../../lib/data/loader";
import {
  buildHist,
  buildGradesIndex,
  buildTeamWeekIndex,
  buildScheduleEloIndex,
  buildPredictiveIndex,
  MODEL_KEYS,
  type MetricKey,
  type PredictiveIndex,
  type PredictiveCoverage,
} from "../game-analysis/previews/engine";
import { buildGameBacktestRows, DEFAULT_STAKE } from "../../lib/logic/backtest";
import { Loading, ErrorRetry } from "../../components/Loading";
import { TabBar } from "../../components/TabBar";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import OverviewTab from "./OverviewTab";
import ByModelTab from "./ByModelTab";
import BySeasonTab from "./BySeasonTab";
import ByTeamTab from "./ByTeamTab";
import CalibrationTab from "./CalibrationTab";
import MethodologyTab from "./MethodologyTab";

const TABS = [
  ["Overview", "💰", "Is it profitable? Headline ROI and cumulative profit"],
  ["By Model", "⚖️", "ROI and accuracy compared across every sub-model"],
  ["By Season", "📅", "Profit trend season by season"],
  ["By Team", "🏈", "Which teams the model profits — or loses — on"],
  ["Calibration", "📐", "Predicted win probability vs. actual win rate"],
  ["Methodology", "📖", "Unit-stake convention, payout math, and caveats"],
] as const;
type Tab = (typeof TABS)[number][0];
const TAB_SLUGS: Record<string, Tab> = {
  overview: "Overview",
  "by-model": "By Model",
  "by-season": "By Season",
  "by-team": "By Team",
  calibration: "Calibration",
  methodology: "Methodology",
};
const TAB_TO_SLUG: Record<Tab, string> = {
  Overview: "overview",
  "By Model": "by-model",
  "By Season": "by-season",
  "By Team": "by-team",
  Calibration: "calibration",
  Methodology: "methodology",
};

export default function ModelBacktest() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(TAB_SLUGS[searchParams.get("tab") ?? ""] ?? "Overview");
  const [primary, setPrimary] = useState<MetricKey>("consensus");

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
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]> | null>(null);
  const [predIdx, setPredIdx] = useState<PredictiveIndex | null>(null);
  const [predictiveUnavailable, setPredictiveUnavailable] = useState(false);
  const [predictiveCoverage, setPredictiveCoverage] = useState<PredictiveCoverage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  usePageTitle(`Model Backtest — ${tab}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const [s, g, m] = await Promise.all([getSchedule(), getGrades(), getMeta()]);
        if (cancelled) return;
        setSchedule(s);
        setGrades(g);
        // Same REG-only filter Matchup Previews applies before indexing team_week —
        // keeps trend/pyth features consistent with the engine's other consumers.
        const twEntries = await Promise.all(
          m.seasons.map(async (season) => {
            const tw = await getTeamWeek(season);
            return [season, tw.filter((r) => r.game_type === "REG" || r.game_type == null)] as [number, Row[]];
          }),
        );
        if (cancelled) return;
        setTeamWeekBySeason(new Map(twEntries));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    Promise.all([getPredictiveModelGames(), getPredictiveModelMeta(), getPredictiveModelUpcoming(), getPredictiveModelUpcomingMeta()])
      .then(([rows, m, upcomingRows, um]) => {
        if (cancelled) return;
        setPredIdx(buildPredictiveIndex([...rows, ...upcomingRows]));
        setPredictiveCoverage(
          m.test_seasons.length
            ? {
                min: Math.min(...m.test_seasons),
                max: Math.max(...m.test_seasons),
                upcoming: um.season != null && um.week != null && um.n_games > 0 ? { season: um.season, week: um.week } : undefined,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setPredictiveUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  const hist = useMemo(() => (schedule.length ? buildHist(schedule) : null), [schedule]);
  const gradesIdx = useMemo(() => (grades.length ? buildGradesIndex(grades) : null), [grades]);
  const twIdx = useMemo(() => (teamWeekBySeason ? buildTeamWeekIndex(teamWeekBySeason) : null), [teamWeekBySeason]);
  const eloIdx = useMemo(() => (schedule.length ? buildScheduleEloIndex(schedule) : null), [schedule]);

  const modelKeys = useMemo(() => (predictiveUnavailable ? MODEL_KEYS.filter(([k]) => k !== "predictive") : MODEL_KEYS), [predictiveUnavailable]);

  // Computed once per data-load, not per tab switch — same underlying work
  // ModelOverviewTab/ModelPickerTab already do live over the full history, so
  // this has proven-fine performance at this scale (~2k games).
  const rows = useMemo(() => {
    if (!hist || !gradesIdx || !twIdx || !eloIdx) return null;
    return buildGameBacktestRows(schedule, hist, gradesIdx, twIdx, eloIdx, predIdx ?? undefined, DEFAULT_STAKE, modelKeys);
  }, [schedule, hist, gradesIdx, twIdx, eloIdx, predIdx, modelKeys]);

  useEffect(() => {
    if (!modelKeys.some(([k]) => k === primary)) setPrimary(modelKeys[0]?.[0] ?? "consensus");
  }, [modelKeys, primary]);

  const loading = !schedule.length || !hist || !gradesIdx || !twIdx || !eloIdx || !rows;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
          <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
          Model Backtest
        </h1>
        <p className="mt-1 pl-4 text-sm text-slate-500">
          Every prediction model, replayed straight-up against real moneyline payout odds — is it actually profitable?
        </p>
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} gridClassName="sm:grid-cols-3" />

      {loadError ? (
        <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />
      ) : loading ? (
        <Loading label="Loading historical picks & odds…" />
      ) : (
        <>
          {tab === "Overview" && <OverviewTab rows={rows!} modelKeys={modelKeys} primary={primary} onPrimaryChange={setPrimary} />}
          {tab === "By Model" && <ByModelTab rows={rows!} modelKeys={modelKeys} />}
          {tab === "By Season" && <BySeasonTab rows={rows!} modelKeys={modelKeys} primary={primary} onPrimaryChange={setPrimary} />}
          {tab === "By Team" && <ByTeamTab rows={rows!} modelKeys={modelKeys} primary={primary} onPrimaryChange={setPrimary} />}
          {tab === "Calibration" && <CalibrationTab rows={rows!} modelKeys={modelKeys} primary={primary} onPrimaryChange={setPrimary} />}
          {tab === "Methodology" && <MethodologyTab predictiveUnavailable={predictiveUnavailable} predictiveCoverage={predictiveCoverage} />}
        </>
      )}
    </div>
  );
}
