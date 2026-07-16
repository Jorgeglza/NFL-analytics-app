import { NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import GamePicks from "./pages/game-analysis/GamePicks";

const NAV = [
  {
    label: "Game Analysis",
    items: [
      { label: "Game Picks", path: "/game_analysis/game_picks" },
      { label: "Win Types", path: "/game_analysis/win_types" },
      { label: "Team Comparison", path: "/game_analysis/team_comparison" },
      { label: "Scorecards Teams", path: "/game_analysis/scorecards_teams" },
      { label: "Spread Win Percentage", path: "/game_analysis/spread_win_percentage" },
      { label: "Matchup Previews", path: "/game_analysis/matchup_previews" },
    ],
  },
  {
    label: "Player Analysis",
    items: [
      { label: "Prop Bets Players", path: "/player_analysis/prop_bets_players" },
      { label: "Build Parlay", path: "/player_analysis/build_parlay" },
      { label: "Player Team Stats", path: "/player_analysis/player_team_stats" },
      { label: "Matchup Bets", path: "/player_analysis/matchup_bets" },
      { label: "Value Bets", path: "/player_analysis/value_bets" },
    ],
  },
  {
    label: "Data",
    items: [{ label: "Grading Model", path: "/data/grading_model" }],
  },
];

function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-10 text-center text-slate-500">
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="mt-2 text-sm">Not implemented yet — see docs/IMPLEMENTATION_LOG.md (M3).</p>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-[#002f6c] text-white shadow">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="text-lg font-bold tracking-tight">
            NFL Analytics
          </NavLink>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.flatMap((g) => g.items).map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `rounded px-2 py-1 hover:bg-white/10 ${isActive ? "bg-white/15 font-semibold" : "text-white/80"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/game_analysis/game_picks" element={<GamePicks />} />
          <Route path="/game_analysis/win_types" element={<Placeholder name="Win Types" />} />
          <Route path="/game_analysis/team_comparison" element={<Placeholder name="Team Comparison" />} />
          <Route path="/game_analysis/scorecards_teams" element={<Placeholder name="Scorecards Teams" />} />
          <Route path="/game_analysis/spread_win_percentage" element={<Placeholder name="Spread Win Percentage" />} />
          <Route path="/game_analysis/matchup_previews" element={<Placeholder name="Matchup Previews" />} />
          <Route path="/player_analysis/prop_bets_players" element={<Placeholder name="Prop Bets Players" />} />
          <Route path="/player_analysis/build_parlay" element={<Placeholder name="Build Parlay" />} />
          <Route path="/player_analysis/player_team_stats" element={<Placeholder name="Player Team Stats" />} />
          <Route path="/player_analysis/matchup_bets" element={<Placeholder name="Matchup Bets" />} />
          <Route path="/player_analysis/value_bets" element={<Placeholder name="Value Bets" />} />
          <Route path="/data/grading_model" element={<Placeholder name="Grading Model" />} />
        </Routes>
      </main>
    </div>
  );
}
