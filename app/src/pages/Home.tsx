import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMeta, type Meta } from "../lib/data/loader";

export default function Home() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    getMeta().then(setMeta).catch(() => setMeta(null));
  }, []);

  return (
    <div className="mx-auto max-w-3xl py-10 text-center">
      <h1 className="text-3xl font-bold text-[#002f6c]">NFL Analytics</h1>
      <p className="mt-3 text-slate-600">
        Game picks, matchup previews, player prop analysis, and Random Forest team grades —
        all precomputed weekly, served statically.
      </p>
      {meta && (
        <p className="mt-2 text-xs text-slate-400">
          Data: seasons {meta.seasons[0]}–{meta.seasons[meta.seasons.length - 1]} · updated{" "}
          {new Date(meta.generated_at).toLocaleDateString()}
        </p>
      )}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link to="/game_analysis/game_picks" className="rounded-xl border bg-white p-5 text-left shadow-sm hover:shadow">
          <div className="font-semibold">Game Picks</div>
          <div className="text-sm text-slate-500">Weekly results & win types</div>
        </Link>
        <Link to="/game_analysis/matchup_previews" className="rounded-xl border bg-white p-5 text-left shadow-sm hover:shadow">
          <div className="font-semibold">Matchup Previews</div>
          <div className="text-sm text-slate-500">Pick engine & trend edges</div>
        </Link>
        <Link to="/player_analysis/prop_bets_players" className="rounded-xl border bg-white p-5 text-left shadow-sm hover:shadow">
          <div className="font-semibold">Prop Bets</div>
          <div className="text-sm text-slate-500">Player lines & hit rates</div>
        </Link>
        <Link to="/data/grading_model" className="rounded-xl border bg-white p-5 text-left shadow-sm hover:shadow">
          <div className="font-semibold">Grading Model</div>
          <div className="text-sm text-slate-500">Team grades & feature importance</div>
        </Link>
      </div>
    </div>
  );
}
