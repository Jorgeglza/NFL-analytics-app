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

// Compact one-row strip plot: every game with a spread plotted as a dot on a
// single -max…0…+max axis, colored by its win-type category (same palette as
// the bar chart and section headers below) — dot color already encodes the
// winner (favorite vs underdog, home vs away), so this one glance answers
// "how were spreads distributed, and who tended to cover them". Dots that
// would collide horizontally stack into extra rows (greedy, ascending by
// spread) rather than overlap into an unreadable blob.
const STRIP_W = 600;
const STRIP_ROW_H = 11;
const STRIP_MAX_ROWS = 3;
const STRIP_DOT_R = 4;
const STRIP_AXIS_Y_FROM_BOTTOM = 16;

function SpreadStrip({ games }: { games: Game[] }) {
  const pts = games.filter((g) => g.spread != null).sort((a, b) => a.spread! - b.spread!);
  if (!pts.length) return null;

  const maxAbs = Math.max(3, Math.ceil(Math.max(...pts.map((g) => Math.abs(g.spread!)))));
  const padX = 22;
  const xScale = (spread: number) => padX + ((spread + maxAbs) / (2 * maxAbs)) * (STRIP_W - 2 * padX);

  // Greedy row-packing so close spreads don't render as one overlapping dot.
  const minGap = STRIP_DOT_R * 2 + 2;
  const rowLastX: number[] = [];
  const rows = pts.map((g) => {
    const gx = xScale(g.spread!);
    let row = rowLastX.findIndex((lastX) => gx - lastX >= minGap);
    if (row === -1) {
      if (rowLastX.length < STRIP_MAX_ROWS) {
        row = rowLastX.length;
        rowLastX.push(gx);
      } else {
        row = rowLastX.indexOf(Math.min(...rowLastX));
        rowLastX[row] = gx;
      }
    } else {
      rowLastX[row] = gx;
    }
    return row;
  });

  const height = STRIP_AXIS_Y_FROM_BOTTOM + STRIP_MAX_ROWS * STRIP_ROW_H + 14;
  const axisY = height - STRIP_AXIS_Y_FROM_BOTTOM;
  const zeroX = xScale(0);

  const present = CATEGORY_ORDER.filter((c) => pts.some((g) => g.category === c));

  return (
    <div>
      <svg viewBox={`0 0 ${STRIP_W} ${height}`} className="h-auto w-full" preserveAspectRatio="none">
        {/* zero reference (pick'em line) */}
        <line x1={zeroX} y1={4} x2={zeroX} y2={axisY} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2,2" />
        <line x1={padX} y1={axisY} x2={STRIP_W - padX} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
        {[-maxAbs, 0, maxAbs].map((t) => (
          <g key={t}>
            <line x1={xScale(t)} y1={axisY} x2={xScale(t)} y2={axisY + 3} stroke="#cbd5e1" strokeWidth={1} />
            <text x={xScale(t)} y={axisY + 12} fontSize={9} fill="#94a3b8" textAnchor="middle">
              {t > 0 ? `+${t}` : t}
            </text>
          </g>
        ))}
        {pts.map((g, i) => (
          <circle
            key={g.gameId}
            cx={xScale(g.spread!)}
            cy={axisY - 5 - rows[i] * STRIP_ROW_H}
            r={STRIP_DOT_R}
            fill={CATEGORY_COLORS[g.category]}
            opacity={g.played ? 0.9 : 0.35}
            stroke="#fff"
            strokeWidth={1}
          >
            <title>
              {g.awayTeam} @ {g.homeTeam} · spread {g.spread! > 0 ? `+${g.spread}` : g.spread}
              {g.played ? ` · ${g.awayScore}–${g.homeScore} · ${g.category}` : " · not played"}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {present.map((cat) => (
          <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
            {CATEGORY_CODES[cat]}
          </span>
        ))}
      </div>
    </div>
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

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" style={{ borderTop: "3px solid #94a3b8" }}>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Spread distribution</div>
          <div className="mt-2">
            <SpreadStrip games={games} />
          </div>
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
