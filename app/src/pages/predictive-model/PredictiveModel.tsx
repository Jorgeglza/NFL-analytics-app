// Predictive Model page (P2) — exploration/explanation surface for the
// margin-regression model chosen in docs/predictive-model-decision.md.
// Historical-only (no live/upcoming-week picks — see docs/predictive-model.md
// for why). 4 tabs, mirrors the grading-model page's file layout.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getPredictiveModelGames,
  getPredictiveModelGameFeatures,
  getPredictiveModelSeasonSummary,
  getPredictiveModelImportance,
  getPredictiveModelCalibration,
  getPredictiveModelMeta,
  type Row,
  type PredictiveModelCalibration,
  type PredictiveModelMeta,
} from "../../lib/data/loader";
import { Loading } from "../../components/Loading";
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

  usePageTitle(`Predictive Model — ${tab}`);

  useEffect(() => {
    Promise.all([
      getPredictiveModelGames(),
      getPredictiveModelGameFeatures(),
      getPredictiveModelSeasonSummary(),
      getPredictiveModelImportance(),
      getPredictiveModelCalibration(),
      getPredictiveModelMeta(),
    ]).then(([g, gf, ss, imp, cal, m]) => {
      setGames(g);
      setGameFeatures(gf);
      setSeasonSummary(ss);
      setImportance(imp);
      setCalibration(cal);
      setMeta(m);
    });
  }, []);

  const loading = !games.length || !gameFeatures.length || !seasonSummary.length || !calibration || !meta;

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

      {loading ? (
        <Loading label="Loading predictive model data…" />
      ) : (
        <>
          {tab === "Overview" && <OverviewTab seasonSummary={seasonSummary} testSeasons={meta!.test_seasons} />}
          {tab === "Performance" && <PerformanceTab games={games} />}
          {tab === "Explanation" && (
            <ExplanationTab importance={importance} games={games} gameFeatures={gameFeatures} featureCols={meta!.feature_cols} />
          )}
          {tab === "Confidence" && <ConfidenceTab calibration={calibration!} />}
        </>
      )}
    </div>
  );
}
