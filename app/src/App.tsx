import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import GamePicks from "./pages/game-analysis/GamePicks";
import { NAV_GROUPS } from "./nav";

const IMPLEMENTED: Record<string, () => JSX.Element> = {
  "/game_analysis/game_picks": GamePicks,
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
