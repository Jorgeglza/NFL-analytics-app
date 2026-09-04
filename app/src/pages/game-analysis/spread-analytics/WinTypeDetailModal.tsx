// Detail popup for one Win Types block's stacked bar — opened by clicking any
// segment of a season/week column. Shows every game for that x-value (across
// all categories, not just the clicked segment), grouped into sections whose
// header color matches the bar's own category color (CATEGORY_COLORS, the
// same source the chart uses), so the popup reads as a direct expansion of
// the bar the user clicked. Team logos + the actual final score make each
// row identifiable at a glance instead of just a game id.
import { useEffect, useState } from "react";
import { Modal } from "../../../components/Modal";
import { Kpi, theadCls, trCls } from "../../../components/ui";
import { CATEGORY_COLORS, CATEGORY_CODES } from "../../../lib/logic/winType";
import { getTeamMetaMap, type TeamMeta } from "../../../lib/team/meta";
import { CATEGORY_ORDER, kpis, splitKpis, pct, type Game } from "./WinTypesTab";

function TeamBadge({ abbr, meta }: { abbr: string; meta?: TeamMeta }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {meta?.logo && <img src={meta.logo} alt="" className="h-5 w-5 object-contain" loading="lazy" decoding="async" />}
      <span className="font-medium text-slate-700">{abbr}</span>
    </span>
  );
}

export default function WinTypeDetailModal({
  x,
  xLabel,
  games,
  onClose,
}: {
  x: number;
  xLabel: string;
  games: Game[];
  onClose: () => void;
}) {
  const [teamMeta, setTeamMeta] = useState<Map<string, TeamMeta> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTeamMetaMap().then((m) => {
      if (!cancelled) setTeamMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { favHomePct, favWinPct, homeWinPct } = kpis(games);
  const { homeFavWinPct, awayFavWinPct } = splitKpis(games);
  const played = games.filter((g) => g.played);
  const upsets = played.filter((g) => g.category === "Underdog home" || g.category === "Underdog away");
  const spreads = games.filter((g) => g.spread != null).map((g) => Math.abs(g.spread!));
  const avgSpread = spreads.length ? spreads.reduce((s, v) => s + v, 0) / spreads.length : null;
  const biggestUpset = upsets
    .filter((g) => g.spread != null)
    .sort((a, b) => Math.abs(b.spread!) - Math.abs(a.spread!))[0];

  const groups = CATEGORY_ORDER.map((cat) => ({ cat, list: games.filter((g) => g.category === cat) })).filter(
    (g) => g.list.length > 0,
  );

  return (
    <Modal
      onClose={onClose}
      wide
      title={`${xLabel} ${x} — win-type breakdown`}
      subtitle={`${games.length} game${games.length === 1 ? "" : "s"} across ${groups.length} win type${groups.length === 1 ? "" : "s"}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">
          <Kpi label="Favorite Win %" value={pct(favWinPct)} accent="#2459A7" />
          <Kpi label="Home Win %" value={pct(homeWinPct)} accent="#C8102E" />
          <Kpi label="Favorite is Home %" value={pct(favHomePct)} accent="#3C9A5F" />
          <Kpi label="Upsets" value={`${upsets.length} / ${played.length}`} accent="#E87722" sub="Underdog wins / played games" />
          <Kpi label="Avg |spread|" value={avgSpread == null ? "—" : avgSpread.toFixed(1)} accent="#002f6c" />
          <Kpi
            label="Home vs away favorites"
            value={`${pct(homeFavWinPct)} / ${pct(awayFavWinPct)}`}
            accent="#7c3aed"
            sub="Favorite win % by side"
          />
        </div>

        {biggestUpset && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Biggest upset:</span>{" "}
            <TeamBadge abbr={biggestUpset.winnerTeam ?? "?"} meta={teamMeta?.get(biggestUpset.winnerTeam ?? "")} /> won as a{" "}
            {Math.abs(biggestUpset.spread!)}-point underdog ({biggestUpset.awayTeam} {biggestUpset.awayScore}–{biggestUpset.homeScore}{" "}
            {biggestUpset.homeTeam}).
          </div>
        )}

        <div className="space-y-4">
          {groups.map(({ cat, list }) => (
            <div key={cat} className="overflow-hidden rounded-2xl border border-slate-200">
              <div
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white"
                style={{ background: CATEGORY_COLORS[cat] }}
              >
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">{CATEGORY_CODES[cat]}</span>
                <span>{cat}</span>
                <span className="ml-auto font-normal opacity-90">
                  {list.length} game{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={theadCls}>
                    <tr>
                      {["Matchup", "Score", "Spread", "Date"].map((h) => (
                        <th key={h} className="px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((g) => (
                      <tr key={g.gameId} className={trCls}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <TeamBadge abbr={g.awayTeam} meta={teamMeta?.get(g.awayTeam)} />
                            <span className="text-slate-400">@</span>
                            <TeamBadge abbr={g.homeTeam} meta={teamMeta?.get(g.homeTeam)} />
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          {g.played ? (
                            <span className={g.winnerTeam ? "font-semibold text-slate-800" : "text-slate-500"}>
                              {g.awayScore}–{g.homeScore}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{g.spread == null ? "—" : g.spread > 0 ? `+${g.spread}` : g.spread}</td>
                        <td className="px-3 py-1.5 text-slate-500">{g.gameday ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
