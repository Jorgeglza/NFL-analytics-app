import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import { Loading } from "./components/Loading";
import Home from "./pages/Home";
import { NAV_GROUPS } from "./nav";
import { usePageTitle } from "./lib/hooks/usePageTitle";

// Default tab title per route (page-specific overrides live inside the page
// components themselves, e.g. Team Comparison reflects the selected teams).
const TITLE_OVERRIDES: Record<string, string> = {
  "/": "NFL Analytics",
  "/glossary": "Glossary",
  "/game_analysis/models_guide": "Models Guide",
};
const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.pages).map((p) => [p.path, p.label]),
);

function RouteTitle() {
  const { pathname } = useLocation();
  usePageTitle(TITLE_OVERRIDES[pathname] ?? PAGE_TITLES[pathname] ?? "NFL Analytics");
  return null;
}

// Pages are lazy-loaded so ECharts-heavy routes don't bloat the initial bundle (M4).
const IMPLEMENTED: Record<string, LazyExoticComponent<ComponentType>> = {
  "/glossary": lazy(() => import("./pages/GlossaryPage")),
  "/game_analysis/game_picks": lazy(() => import("./pages/game-analysis/GamePicks")),
  "/game_analysis/win_types": lazy(() => import("./pages/game-analysis/WinTypes")),
  "/game_analysis/spread_win_percentage": lazy(() => import("./pages/game-analysis/SpreadWinPct")),
  "/game_analysis/team_comparison": lazy(() => import("./pages/game-analysis/TeamComparison")),
  "/game_analysis/scorecards_teams": lazy(() => import("./pages/game-analysis/Scorecards")),
  "/game_analysis/matchup_previews": lazy(() => import("./pages/game-analysis/previews/MatchupPreviews")),
  "/game_analysis/models_guide": lazy(() => import("./pages/game-analysis/previews/ModelsGuide")),
  "/player_analysis/prop_bets_players": lazy(() => import("./pages/player-analysis/PropBets")),
  "/player_analysis/build_parlay": lazy(() => import("./pages/player-analysis/ParlayBuilder")),
  "/player_analysis/player_team_stats": lazy(() => import("./pages/player-analysis/PlayerTeamStats")),
  "/player_analysis/matchup_bets": lazy(() => import("./pages/player-analysis/MatchupBets")),
  "/player_analysis/value_bets": lazy(() => import("./pages/player-analysis/ValueBets")),
  "/data/grading_model": lazy(() => import("./pages/grading-model/GradingModel")),
};

function Placeholder({ name, description }: { name: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#002f6c]/8 text-2xl">🚧</div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">{name}</h1>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      <p className="mt-4 text-xs text-slate-400">
        This page is being ported from the original app — see docs/IMPLEMENTATION_LOG.md (M3).
      </p>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <RouteTitle />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            {/* Not in the navbar — reached from Home's footer link */}
            {(() => {
              const GlossaryPage = IMPLEMENTED["/glossary"];
              return <Route path="/glossary" element={<GlossaryPage />} />;
            })()}
            {/* Not in the navbar — reached from the Matchup Previews header link */}
            {(() => {
              const Guide = IMPLEMENTED["/game_analysis/models_guide"];
              return <Route path="/game_analysis/models_guide" element={<Guide />} />;
            })()}
            {/* Not in the navbar — reached by "zoom in" from Value Bets (audit §11/§12: two-step journey) */}
            {(() => {
              const Matchup = IMPLEMENTED["/player_analysis/matchup_bets"];
              return <Route path="/player_analysis/matchup_bets" element={<Matchup />} />;
            })()}
            {NAV_GROUPS.flatMap((g) => g.pages).map((page) => {
              const Impl = IMPLEMENTED[page.path];
              return (
                <Route
                  key={page.path}
                  path={page.path}
                  element={Impl ? <Impl /> : <Placeholder name={page.label} description={page.description} />}
                />
              );
            })}
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
