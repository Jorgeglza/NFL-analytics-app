// Detail popup for one team's history in one week number, across every
// season on file — opened by clicking a row on Weekly Breakdown's "Team
// performance" table. Order: headline record/KPIs first, then a chronological
// win timeline (oldest -> newest, left to right — a "history" reads forward
// in time, unlike the page's other tables which sort newest-first), then the
// full game-by-game detail (opponent, spread, score, result, win type, and
// that game's rank within its own week — ties the modal back into the page's
// rank/upset theme instead of being a disconnected stat).
import { Modal } from "../../../components/Modal";
import { Kpi, theadCls, trCls } from "../../../components/ui";
import { WIN_TYPE_COLORS, type WinType } from "../../../lib/logic/winType";
import type { TeamMeta } from "../../../lib/team/meta";

export interface TeamWeekGame {
  season: number;
  rank: number;
  opponent: string;
  isHome: boolean;
  spread: number; // team's own perspective — negative = this team favored
  teamScore: number;
  oppScore: number;
  win: boolean;
  tie: boolean;
  winType: WinType | null;
}

export default function TeamWeekModal({
  team,
  week,
  meta,
  games,
  onClose,
}: {
  team: string;
  week: string;
  meta?: TeamMeta;
  games: TeamWeekGame[];
  onClose: () => void;
}) {
  const wins = games.filter((g) => g.win).length;
  const losses = games.filter((g) => !g.win && !g.tie).length;
  const ties = games.filter((g) => g.tie).length;
  const decisive = wins + losses;
  const winPct = decisive ? wins / decisive : null;
  const avgSpread = games.length ? games.reduce((s, g) => s + g.spread, 0) / games.length : null;
  const homeGames = games.filter((g) => g.isHome).length;
  const accent = meta?.color ?? "#002f6c";
  const sorted = [...games].sort((a, b) => a.season - b.season);

  return (
    <Modal
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          {meta?.logo && <img src={meta.logo} alt="" className="h-6 w-6 object-contain" loading="lazy" decoding="async" />}
          {meta?.name ?? team} — Week {week} history
        </div>
      }
      subtitle={`${wins}-${losses}${ties ? `-${ties}` : ""}${winPct != null ? ` (${(100 * winPct).toFixed(0)}%)` : ""} across ${games.length} season${games.length === 1 ? "" : "s"}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Kpi label="Record" value={`${wins}-${losses}${ties ? `-${ties}` : ""}`} accent={accent} />
          <Kpi label="Win %" value={winPct == null ? "—" : `${(100 * winPct).toFixed(0)}%`} accent="#3C9A5F" />
          <Kpi
            label="Avg spread (own side)"
            value={avgSpread == null ? "—" : avgSpread > 0 ? `+${avgSpread.toFixed(1)}` : avgSpread.toFixed(1)}
            accent="#2459A7"
            sub="Negative = favored"
          />
          <Kpi label="Home / Away" value={`${homeGames} / ${games.length - homeGames}`} accent="#E87722" />
        </div>

        {/* Win timeline — chronological, oldest to newest */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Win timeline</h3>
          {sorted.length ? (
            <div className="flex flex-wrap gap-2">
              {sorted.map((g) => (
                <div
                  key={g.season}
                  title={`${g.season}: ${g.win ? "W" : g.tie ? "T" : "L"} ${g.teamScore}-${g.oppScore} ${g.isHome ? "vs" : "@"} ${g.opponent}`}
                  className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-white shadow-sm ${
                    g.win ? "bg-[#3C9A5F]" : g.tie ? "bg-slate-400" : "bg-[#C8102E]"
                  }`}
                >
                  <span className="text-sm font-bold leading-none">{g.win ? "W" : g.tie ? "T" : "L"}</span>
                  <span className="mt-0.5 text-[10px] font-medium leading-none opacity-90">{g.season}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-400">No games found.</div>
          )}
        </div>

        {/* Game-by-game detail */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className={theadCls}>
              <tr>
                {["Season", "Rank", "Opponent", "Spread", "Score", "Result", "Win Type"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => (
                <tr key={g.season} className={trCls}>
                  <td className="px-3 py-1.5 font-medium">{g.season}</td>
                  <td className="px-3 py-1.5">{g.rank}</td>
                  <td className="px-3 py-1.5">{g.isHome ? "vs" : "@"} {g.opponent}</td>
                  <td className="px-3 py-1.5">{g.spread > 0 ? `+${g.spread}` : g.spread}</td>
                  <td className="px-3 py-1.5">{g.teamScore}-{g.oppScore}</td>
                  <td className="px-3 py-1.5">
                    {g.win ? (
                      <span className="font-bold text-[#3C9A5F]">W</span>
                    ) : g.tie ? (
                      <span className="font-bold text-slate-500">T</span>
                    ) : (
                      <span className="font-bold text-[#C8102E]">L</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {g.winType ? (
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: WIN_TYPE_COLORS[g.winType] }}>
                        {g.winType}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
