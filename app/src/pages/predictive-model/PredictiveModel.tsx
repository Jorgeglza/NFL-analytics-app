// Predictive Model page (P2) — exploration/explanation surface for the
// margin-regression model chosen in docs/predictive-model-decision.md.
// Overview tab also surfaces the live next-upcoming-week prediction (P3,
// pipeline/predictive_model/export_upcoming.py) — the rest of the page stays
// historical-only, see docs/predictive-model.md.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getPredictiveModelGames,
  getPredictiveModelGameFeatures,
  getPredictiveModelSeasonSummary,
  getPredictiveModelImportance,
  getPredictiveModelCalibration,
  getPredictiveModelMeta,
  getPredictiveModelUpcoming,
  getPredictiveModelUpcomingMeta,
  type Row,
  type PredictiveModelCalibration,
  type PredictiveModelMeta,
  type PredictiveModelUpcomingMeta,
} from "../../lib/data/loader";
import { Loading, ErrorRetry } from "../../components/Loading";
import { TabBar } from "../../components/TabBar";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import OverviewTab from "./OverviewTab";
import PerformanceTab from "./PerformanceTab";
import ExplanationTab from "./ExplanationTab";
import ConfidenceTab from "./ConfidenceTab";

const TABS = [
  ["Overview", "🎯", "Does it beat the market? Why this model, not a more complex one"],
  ["Performance", "📈", "Predicted vs. actual margin, filterable by season and team"],
  ["Explanation", "🧬", "Which features the model actually relies on"],
  ["Confidence", "📐", "Calibration and the fitted residual (uncertainty) distribution"],
] as const;
type Tab = (typeof TABS)[number][0];
const TAB_SLUGS: Record<string, Tab> = { overview: "Overview", performance: "Performance", explanation: "Explanation", confidence: "Confidence" };
const TAB_TO_SLUG: Record<Tab, string> = { Overview: "overview", Performance: "performance", Explanation: "explanation", Confidence: "confidence" };

export default function PredictiveModel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(TAB_SLUGS[searchParams.get("tab") ?? ""] ?? "Overview");

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
  const [games, setGames] = useState<Row[]>([]);
  const [gameFeatures, setGameFeatures] = useState<Row[]>([]);
  const [seasonSummary, setSeasonSummary] = useState<Row[]>([]);
  const [importance, setImportance] = useState<Row[]>([]);
  const [calibration, setCalibration] = useState<PredictiveModelCalibration | null>(null);
  const [meta, setMeta] = useState<PredictiveModelMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [gameFeaturesError, setGameFeaturesError] = useState<string | null>(null);
  const [gameFeaturesRetryTick, setGameFeaturesRetryTick] = useState(0);
  // Live upcoming-week predictions — fetched separately so a missing/malformed
  // export never blocks the rest of the (historical) page, same isolation as
  // Matchup Previews' predIdx load.
  const [upcoming, setUpcoming] = useState<Row[]>([]);
  const [upcomingMeta, setUpcomingMeta] = useState<PredictiveModelUpcomingMeta | null>(null);

  usePageTitle(`Predictive Model — ${tab}`);

  useEffect(() => {
    setLoadError(null);
    Promise.all([
      getPredictiveModelGames(),
      getPredictiveModelSeasonSummary(),
      getPredictiveModelImportance(),
      getPredictiveModelCalibration(),
      getPredictiveModelMeta(),
    ])
      .then(([g, ss, imp, cal, m]) => {
        setGames(g);
        setSeasonSummary(ss);
        setImportance(imp);
        setCalibration(cal);
        setMeta(m);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    Promise.all([getPredictiveModelUpcoming(), getPredictiveModelUpcomingMeta()])
      .then(([rows, m]) => {
        setUpcoming(rows);
        setUpcomingMeta(m);
      })
      .catch(() => {
        // Best-effort: the Overview tab's "This week" card just stays hidden.
      });
  }, [retryTick]);

  // game_features.json (906 KB gz) is only needed by the Explanation tab —
  // deferred so the other 3 tabs don't wait on it up front (P7.3).
  useEffect(() => {
    if (tab === "Explanation" && !gameFeatures.length) {
      setGameFeaturesError(null);
      getPredictiveModelGameFeatures()
        .then(setGameFeatures)
        .catch((err) => setGameFeaturesError(err instanceof Error ? err.message : "Failed to load"));
    }
  }, [tab, gameFeatures.length, gameFeaturesRetryTick]);

  const loading = !games.length || !seasonSummary.length || !calibration || !meta;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
          <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
          Predictive Model
        </h1>
        <p className="mt-1 pl-4 text-sm text-slate-500">
          A walk-forward margin-regression model, explored and explained against the market — a research surface, not a picks tool.
        </p>
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} gridClassName="sm:grid-cols-4" />

      {loadError ? (
        <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />
      ) : loading ? (
        <Loading label="Loading predictive model data…" />
      ) : (
        <>
          {tab === "Overview" && (
            <OverviewTab seasonSummary={seasonSummary} testSeasons={meta!.test_seasons} upcoming={upcoming} upcomingMeta={upcomingMeta} />
          )}
          {tab === "Performance" && <PerformanceTab games={games} />}
          {tab === "Explanation" && (
            gameFeaturesError ? (
              <ErrorRetry onRetry={() => setGameFeaturesRetryTick((t) => t + 1)} />
            ) : gameFeatures.length ? (
              <ExplanationTab importance={importance} games={games} gameFeatures={gameFeatures} featureCols={meta!.feature_cols} />
            ) : (
              <Loading label="Loading game features…" />
            )
          )}
          {tab === "Confidence" && <ConfidenceTab calibration={calibration!} />}
        </>
      )}
    </div>
  );
}
