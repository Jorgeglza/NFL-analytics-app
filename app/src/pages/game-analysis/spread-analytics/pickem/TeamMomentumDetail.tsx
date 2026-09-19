// Detail popup for one team's row in the "This Week" momentum table
// (ThisWeekView.tsx) — opened by clicking a team. Two blocks: (1) the exact
// per-season Week(W-1)->Week(W) result pairs that were pooled into that row's
// After-win/After-loss/Swing numbers, so a user can see precisely which
// seasons produced the stat instead of just trusting a pooled percentage, and
// (2) a fuller game-by-game log for the most recent season with data through
// the selected week, for added context (record, opponents, scores, win
// type). No against-the-spread/cover metric — this app doesn't compute one
// anywhere (see WeeklyBreakdownTab.tsx header comment).
import { Modal } from "../../../../components/Modal";
import { Kpi, theadCls, trCls } from "../../../../components/ui";
import { winType, WIN_TYPE_COLORS } from "../../../../lib/logic/winType";
import type { Row } from "../../../../lib/data/loader";
import type { TeamMeta } from "../../../../lib/team/meta";

export interface MomentumTeamRow {
  team: string;
  afterWinRate: number | null;
  afterLossRate: number | null;
  swing: number | null;
  nWin: number;
  nLoss: number;
}

export default function TeamMomentumDetail({
  row,
  meta,
  priorWeek,
  targetWeek,
  teamWeekBySeason,
  reg,
  onClose,
}: {
  row: MomentumTeamRow;
  meta?: TeamMeta;
  priorWeek: number;
  targetWeek: number;
  teamWeekBySeason: Map<number, Row[]>;
  reg: Row[];
  onClose: () => void;
}) {
  const team = row.team;

  const seasonPairs = [...teamWeekBySeason.entries()]
    .map(([season, rows]) => {
      const wRow = rows.find((r) => String(r.team) === team && Number(r.week) === priorWeek);
      const tRow = rows.find((r) => String(r.team) === team && Number(r.week) === targetWeek);
      if (!wRow || !tRow || wRow.win == null || tRow.win == null) return null;
      return { season, priorWin: Number(wRow.win) === 1, targetWin: Number(tRow.win) === 1 };
    })
    .filter((x): x is { season: number; priorWin: boolean; targetWin: boolean } => x != null)
    .sort((a, b) => a.season - b.season);

  const latestSeason = seasonPairs.length ? Math.max(...seasonPairs.map((p) => p.season)) : null;

  const seasonGames = (latestSeason == null
    ? []
    : reg.filter((r) => Number(r.season) === latestSeason && Number(r.week) <= targetWeek && (r.home_team === team || r.away_team === team))
  )
    .map((r) => {
      const isHome = r.home_team === team;
      const opponent = isHome ? String(r.away_team) : String(r.home_team);
      const hs = r.home_score == null ? null : Number(r.home_score);
      const as_ = r.away_score == null ? null : Number(r.away_score);
      const played = hs != null && as_ != null;
      const teamScore = played ? (isHome ? hs : as_) : null;
      const oppScore = played ? (isHome ? as_ : hs) : null;
      const tie = played && hs === as_;
      const win = played ? !tie && ((isHome && hs! > as_!) || (!isHome && as_! > hs!)) : null;
      const spreadLine = r.spread_line == null ? null : Number(r.spread_line);
      return { week: Number(r.week), isHome, opponent, teamScore, oppScore, played, tie, win, winType: winType(hs, as_, spreadLine) };
    })
    .sort((a, b) => a.week - b.week);

  const latestRecord = seasonGames.reduce(
    (acc, g) => {
      if (!g.played) return acc;
      if (g.tie) acc.ties++;
      else if (g.win) acc.wins++;
      else acc.losses++;
      return acc;
    },
    { wins: 0, losses: 0, ties: 0 },
  );

  return (
    <Modal
      onClose={onClose}
      wide
      title={
        <div className="flex items-center gap-2">
          {meta?.logo && <img src={meta.logo} alt="" className="h-6 w-6 object-contain" loading="lazy" decoding="async" />}
          {meta?.name ?? team}
        </div>
      }
      subtitle={`Week ${priorWeek} → Week ${targetWeek} results, pooled across ${teamWeekBySeason.size} season${teamWeekBySeason.size === 1 ? "" : "s"}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">
          <Kpi
            label={`Win% in Wk ${targetWeek} after a Wk ${priorWeek} win`}
            value={row.afterWinRate != null ? `${Math.round(row.afterWinRate * 100)}%` : "—"}
            sub={`n=${row.nWin}`}
            accent="#3C9A5F"
          />
          <Kpi
            label={`Win% in Wk ${targetWeek} after a Wk ${priorWeek} loss`}
            value={row.afterLossRate != null ? `${Math.round(row.afterLossRate * 100)}%` : "—"}
            sub={`n=${row.nLoss}`}
            accent="#C8102E"
          />
          <Kpi
            label="Swing"
            value={row.swing != null ? `${row.swing >= 0 ? "+" : ""}${Math.round(row.swing * 100)}pp` : "—"}
            accent="#2459A7"
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Season by season: Week {priorWeek} result → Week {targetWeek} result
          </h3>
          <p className="mb-2 text-xs text-slate-500">
            These are the exact instances behind the KPIs above — one row per season where {meta?.name ?? team} played in both weeks.
          </p>
          {seasonPairs.length ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className={theadCls}>
                  <tr>
                    <th className="px-3 py-2">Season</th>
                    <th className="px-3 py-2">Week {priorWeek}</th>
                    <th className="px-3 py-2">Week {targetWeek}</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonPairs.map((p) => (
                    <tr key={p.season} className={trCls}>
                      <td className="px-3 py-1.5 font-medium">{p.season}</td>
                      <td className="px-3 py-1.5">
                        <span className={`font-bold ${p.priorWin ? "text-[#3C9A5F]" : "text-[#C8102E]"}`}>{p.priorWin ? "W" : "L"}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`font-bold ${p.targetWin ? "text-[#3C9A5F]" : "text-[#C8102E]"}`}>{p.targetWin ? "W" : "L"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-400">No seasons with results in both weeks.</div>
          )}
        </div>

        {latestSeason != null && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {latestSeason} game log through Week {targetWeek}
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Record: {latestRecord.wins}-{latestRecord.losses}
              {latestRecord.ties ? `-${latestRecord.ties}` : ""} — most recent season on file, for added context beyond the pooled stat above.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className={theadCls}>
                  <tr>
                    <th className="px-3 py-2">Week</th>
                    <th className="px-3 py-2">Opponent</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Win type</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonGames.map((g) => (
                    <tr key={g.week} className={trCls}>
                      <td className="px-3 py-1.5 font-medium">{g.week}</td>
                      <td className="px-3 py-1.5">
                        {g.isHome ? "vs" : "@"} {g.opponent}
                      </td>
                      <td className="px-3 py-1.5">
                        {g.teamScore == null || g.oppScore == null ? <span className="text-slate-400">—</span> : `${g.teamScore}-${g.oppScore}`}
                      </td>
                      <td className="px-3 py-1.5">
                        {g.win == null ? (
                          <span className="text-slate-400">—</span>
                        ) : g.tie ? (
                          <span className="font-bold text-slate-500">T</span>
                        ) : g.win ? (
                          <span className="font-bold text-[#3C9A5F]">W</span>
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
        )}
      </div>
    </Modal>
  );
}
