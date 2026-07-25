// Predictive Model page (P2) — exploration/explanation surface for the
// margin-regression model chosen in docs/predictive-model-decision.md.
// Historical-only (no live/upcoming-week picks — see docs/predictive-model.md
// for why). 4 tabs, mirrors the grading-model page's file layout.
import { useEffect, useState } from "react";
import {
  getPredictiveModelGames,
  getPredictiveModelSeasonSummary,
  getPredictiveModelImportance,
  getPredictiveModelCalibration,
  getPredictiveModelMeta,
  type Row,
  type PredictiveModelCalibration,
  type PredictiveModelMeta,
} from "../../lib/data/loader";
import { Loading } from "../../components/Loading";
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

export default function PredictiveModel() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [games, setGames] = useState<Row[]>([]);
  const [seasonSummary, setSeasonSummary] = useState<Row[]>([]);
  const [importance, setImportance] = useState<Row[]>([]);
  const [calibration, setCalibration] = useState<PredictiveModelCalibration | null>(null);
  const [meta, setMeta] = useState<PredictiveModelMeta | null>(null);

  usePageTitle(`Predictive Model — ${tab}`);

  useEffect(() => {
    Promise.all([
      getPredictiveModelGames(),
      getPredictiveModelSeasonSummary(),
      getPredictiveModelImportance(),
      getPredictiveModelCalibration(),
      getPredictiveModelMeta(),
    ]).then(([g, ss, imp, cal, m]) => {
      setGames(g);
      setSeasonSummary(ss);
      setImportance(imp);
      setCalibration(cal);
      setMeta(m);
    });
  }, []);

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

      <div className="grid gap-2 sm:grid-cols-4">
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
        <Loading label="Loading predictive model data…" />
      ) : (
        <>
          {tab === "Overview" && <OverviewTab seasonSummary={seasonSummary} testSeasons={meta!.test_seasons} />}
          {tab === "Performance" && <PerformanceTab games={games} />}
          {tab === "Explanation" && <ExplanationTab importance={importance} />}
          {tab === "Confidence" && <ConfidenceTab calibration={calibration!} />}
        </>
      )}
    </div>
  );
}
