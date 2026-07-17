import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import GamePicks from "./pages/game-analysis/GamePicks";
import WinTypes from "./pages/game-analysis/WinTypes";
import SpreadWinPct from "./pages/game-analysis/SpreadWinPct";
import GradingModel from "./pages/grading-model/GradingModel";
import TeamComparison from "./pages/game-analysis/TeamComparison";
import Scorecards from "./pages/game-analysis/Scorecards";
import { NAV_GROUPS } from "./nav";

const IMPLEMENTED: Record<string, () => JSX.Element> = {
  "/game_analysis/game_picks": GamePicks,
  "/game_analysis/win_types": WinTypes,
  "/game_analysis/spread_win_percentage": SpreadWinPct,
  "/data/grading_model": GradingModel,
  "/game_analysis/team_comparison": TeamComparison,
  "/game_analysis/scorecards_teams": Scorecards,
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
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
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
      </main>
    </div>
  );
}
