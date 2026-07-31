// Team season scorecard — full Session-5 rework of the old donut/sparkline port
// (audit §5): unambiguous per-game/total labeling, league-average and league-rank
// context on every stat, disclosed playstyle metrics, grades with ranks, and a
// season-journey chart (weekly margin + grade evolution). Data unchanged:
// team_week + team_week_ranks + grades.json, regular season only.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getTeamWeek, getTeamWeekRanks, getGrades, getMeta, getSchedule, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { Card, tableWrapCls, theadCls, trCls, stickyColCls, stickyColHeadCls, ScrollHint } from "../../components/ui";
import { TeamLogoLink } from "../../components/team/TeamLogoLink";
import { opponentLabel } from "../grading-model/shared";
import { fairProbs } from "../../lib/logic/moneyline";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";
import { InfoDot } from "../../components/InfoDot";

const OFF_ACCENT = "#c0392b";
const DEF_ACCENT = "#2980b9";

// [label, column, decimals for per-game display]
const OFF_STATS: [string, string, number][] = [
  ["Points", "points", 1],
  ["Total Yards", "total_yards", 0],
  ["Passing Yards", "passing_yards", 0],
  ["Rushing Yards", "rushing_yards", 0],
  ["Passing TDs", "passing_tds", 1],
  ["Rushing TDs", "rushing_tds", 1],
  ["Turnovers", "turnovers", 1],
];

interface SeasonStat {
  total: number;
  perGame: number;
  games: number;
}

function statOf(rows: Row[], col: string): SeasonStat | null {
  const vals = rows.map((r) => (r[col] == null ? null : Number(r[col]))).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  return { total, perGame: total / vals.length, games: vals.length };
}

const fmt = (v: number, d: number) => (d === 0 ? String(Math.round(v)) : v.toFixed(d));

interface SparkPoint {
  week: number;
  opp: string;
  value: number | null;
  win: boolean;
}

/** Weekly sparkline with a dashed league-average line and green win dots. */
function StatSpark({ pts, lg, color }: { pts: SparkPoint[]; lg: number | null; color: string }) {
  const values = pts.map((p) => p.value);
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 2, right: 2, top: 4, bottom: 4 },
      xAxis: { type: "category", data: pts.map((p) => `W${p.week}`), show: false },
      yAxis: { type: "value", show: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const p = pts[i];
          return `W${p.week} vs ${p.opp}<br/>${p.value == null ? "—" : p.value.toFixed(1)}${lg != null ? ` (league avg ${lg.toFixed(1)})` : ""}`;
        },
      },
      series: [
        { type: "line", data: values, symbol: "none", lineStyle: { color, width: 2 }, connectNulls: true },
        ...(lg != null
          ? [{ type: "line" as const, data: values.map(() => lg), symbol: "none", lineStyle: { color: "#94a3b8", width: 1, type: "dashed" as const }, tooltip: { show: false }, silent: true }]
          : []),
        {
          type: "scatter",
          symbolSize: 5,
          data: values.map((v, i) => (pts[i].win ? v : null)),
          itemStyle: { color: "#3C9A5F" },
          tooltip: { show: false },
        },
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [values.map((v) => v ?? "").join(","), lg, color],
  );
  const ref = useECharts(option);
  return <div ref={ref} className="h-11 min-w-0 flex-1" />;
}

/** One stat line: label + rank chip · per-game · total · league avg · sparkline. */
function StatRow({
  label,
  s,
  lg,
  rank,
  nTeams,
  decimals,
  accent,
  pts,
}: {
  label: string;
  s: SeasonStat | null;
  lg: number | null;
  rank: number | null;
  nTeams: number;
  decimals: number;
  accent: string;
  pts: SparkPoint[];
}) {
  if (!s) return null;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 shrink-0">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {rank != null && (
          <span
            className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-bold text-white ${rank <= Math.ceil(nTeams / 3) ? "bg-[#3C9A5F]" : rank > nTeams - Math.ceil(nTeams / 3) ? "bg-[#C8102E]" : "bg-slate-400"}`}
            title={`League rank #${rank} of ${nTeams} (season-to-date). Ranks already account for direction — #1 is always best.`}
          >
            #{rank}
          </span>
        )}
      </div>
      <div className="w-16 shrink-0 text-right">
        <div className="text-base font-bold tabular-nums text-slate-900">{fmt(s.perGame, decimals)}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">per game</div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-600">{Math.round(s.total).toLocaleString()}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">total ({s.games} gm)</div>
      </div>
      <div className="w-14 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-400">{lg == null ? "—" : fmt(lg, decimals)}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">lg avg/gm</div>
      </div>
      <StatSpark pts={pts} lg={lg} color={accent} />
    </div>
  );
}

/** Two-way share bar with a dashed league-average marker, on-bar percentages,
 *  and a league rank chip (#1 = highest first-side share — a style spectrum,
 *  not good/bad). Metric named in the label. */
function SplitBar({
  label,
  a,
  b,
  la,
  lb,
  aName,
  bName,
  accent,
  rank,
  nTeams,
}: {
  label: string;
  a: number;
  b: number;
  la: number;
  lb: number;
  aName: string;
  bName: string;
  accent: string;
  rank: number | null;
  nTeams: number;
}) {
  if (!(a + b) || !(la + lb)) return null;
  const pct = (a / (a + b)) * 100;
  const lgPct = (la / (la + lb)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-600">{label}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-400">
          {rank != null && (
            <span
              className="rounded-full bg-slate-600 px-1.5 py-px text-[10px] font-bold text-white"
              title={`League rank by ${aName.toLowerCase()} share — #1 = most ${aName.toLowerCase()}-heavy of ${nTeams} teams`}
            >
              #{rank} {aName.toLowerCase()}-heavy
            </span>
          )}
          <span title="Difference vs the league-average share">
            {pct >= lgPct ? "+" : ""}
            {(pct - lgPct).toFixed(1)} pts vs lg
          </span>
        </span>
      </div>
      <div
        className="relative flex h-5 overflow-hidden rounded-full bg-slate-200"
        title={`${aName}: ${Math.round(a)} (${pct.toFixed(1)}%) · ${bName}: ${Math.round(b)} (${(100 - pct).toFixed(1)}%) — dashed marker = league-average ${aName.toLowerCase()} share (${lgPct.toFixed(1)}%)`}
      >
        <div className="flex h-full items-center justify-center rounded-l-full text-[10px] font-bold text-white" style={{ width: `${pct}%`, background: accent }}>
          {pct >= 14 && `${aName} ${pct.toFixed(0)}%`}
        </div>
        <div className="flex h-full flex-1 items-center justify-center text-[10px] font-bold text-slate-600">
          {100 - pct >= 14 && `${bName} ${(100 - pct).toFixed(0)}%`}
        </div>
        <div className="absolute top-0 h-full border-l-2 border-dashed border-slate-700/70" style={{ left: `${lgPct}%` }} />
      </div>
    </div>
  );
}

interface GameInfo {
  gameId: string;
  week: number;
  opp: string;
  home: boolean;
  played: boolean;
  teamScore: number | null;
  oppScore: number | null;
  win: boolean | null;
  tie: boolean;
  margin: number | null;
  spreadForTeam: number | null;
  atsResult: "W" | "L" | "P" | null;
  teamProb: number | null;
  oppProb: number | null;
  rest: number | null;
  g: Row;
}

function gameInfoFor(g: Row, team: string): GameInfo {
  const home = String(g.home_team) === team;
  const opp = home ? String(g.away_team) : String(g.home_team);
  const hs = g.home_score == null ? null : Number(g.home_score);
  const as_ = g.away_score == null ? null : Number(g.away_score);
  const played = hs != null && as_ != null;
  const teamScore = played ? (home ? hs! : as_!) : null;
  const oppScore = played ? (home ? as_! : hs!) : null;
  const margin = played ? teamScore! - oppScore! : null;
  const win = played ? (margin! > 0 ? true : margin! < 0 ? false : null) : null;
  const tie = played && margin === 0;
  const spreadLine = g.spread_line == null ? null : Number(g.spread_line);
  const spreadForTeam = spreadLine == null ? null : home ? spreadLine : -spreadLine;
  let atsResult: "W" | "L" | "P" | null = null;
  if (played && margin != null && spreadForTeam != null) {
    const diff = margin + spreadForTeam;
    atsResult = diff > 0 ? "W" : diff < 0 ? "L" : "P";
  }
  const homeMl = g.home_moneyline == null ? null : Number(g.home_moneyline);
  const awayMl = g.away_moneyline == null ? null : Number(g.away_moneyline);
  const { homeFair, awayFair } = fairProbs(awayMl, homeMl);
  const teamProb = home ? homeFair : awayFair;
  const oppProb = home ? awayFair : homeFair;
  const restCol = home ? g.home_rest : g.away_rest;
  const rest = restCol == null ? null : Number(restCol);
  return {
    gameId: String(g.game_id),
    week: Number(g.week),
    opp,
    home,
    played,
    teamScore,
    oppScore,
    win,
    tie,
    margin,
    spreadForTeam,
    atsResult,
    teamProb,
    oppProb,
    rest,
    g,
  };
}

/** Actual counts behind a split bar's percentages (e.g. "34 pass att · 22 rush car"). */
function RawCounts({ a, b, aLabel, bLabel }: { a: number | null; b: number | null; aLabel: string; bLabel: string }) {
  return (
    <div className="mt-1 flex justify-between text-[10px] text-slate-400">
      <span>{a == null ? "—" : Math.round(a).toLocaleString()} {aLabel}</span>
      <span>{b == null ? "—" : Math.round(b).toLocaleString()} {bLabel}</span>
    </div>
  );
}

/** Single-game pass/rush comparison led by the actual counts, not a percentage
 *  share — the bar's width is still proportional (quick visual read) but the
 *  numbers themselves are the headline, per the ask to focus on what actually
 *  happened in this game rather than a share-of-total framing. */
function GameStatBar({
  label,
  aVal,
  bVal,
  aUnit,
  bUnit,
  accent,
}: {
  label: string;
  aVal: number | null;
  bVal: number | null;
  aUnit: string;
  bUnit: string;
  accent: string;
}) {
  const a = aVal ?? 0;
  const b = bVal ?? 0;
  if (!(a + b)) return <div className="text-xs text-slate-400">{label}: no data.</div>;
  const pct = (a / (a + b)) * 100;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-600">{label}</div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
        <div style={{ width: `${pct}%`, background: accent }} />
        <div className="flex-1" style={{ background: "#cbd5e1" }} />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-base font-bold tabular-nums" style={{ color: accent }}>
          {Math.round(a).toLocaleString()} <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{aUnit}</span>
        </span>
        <span className="text-base font-bold tabular-nums text-slate-500">
          {Math.round(b).toLocaleString()} <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{bUnit}</span>
        </span>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-700">{value}</span>
    </div>
  );
}

/** Home/away market win-probability split bar (moneyline-implied fair odds). */
function GameProbBar({ info, meta, team }: { info: GameInfo; meta: Map<string, TeamMeta>; team: string }) {
  if (info.teamProb == null || info.oppProb == null) {
    return <div className="py-2 text-xs text-slate-400">No market odds recorded for this game.</div>;
  }
  const teamPct = info.teamProb * 100;
  const oppPct = info.oppProb * 100;
  const teamColor = meta.get(team)?.color ?? "#002f6c";
  const oppColor = meta.get(info.opp)?.color ?? "#94a3b8";
  const favoriteIsTeam = teamPct >= oppPct;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] font-semibold text-slate-600">
        <span>{team} {teamPct.toFixed(0)}%</span>
        <span>{info.opp} {oppPct.toFixed(0)}%</span>
      </div>
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-200">
        <div style={{ width: `${teamPct}%`, background: teamColor }} />
        <div className="flex-1" style={{ background: oppColor }} />
      </div>
      {info.played && info.win != null && !info.tie && (
        <div className="mt-1.5 text-[10.5px] text-slate-400">
          Market favored {favoriteIsTeam ? team : info.opp} — {info.win === favoriteIsTeam ? "the favorite won." : "the underdog won."}
        </div>
      )}
    </div>
  );
}

/** Season schedule — every game for the selected team, with results filled in
 *  and an expandable row for venue/weather/QB detail plus mini market/margin charts. */
function ScheduleSection({
  games,
  meta,
  team,
  color,
  df,
}: {
  games: GameInfo[];
  meta: Map<string, TeamMeta>;
  team: string;
  color: string;
  df: Row[];
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!games.length) return null;
  return (
    <Card title="Season schedule" subtitle="Every game this season — click a row for venue, weather, and win-probability detail.">
      <div className={tableWrapCls}>
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
          <thead className={theadCls}>
            <tr>
              <th className={`px-3 py-2 ${stickyColHeadCls}`}>Wk</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Opponent</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">Margin</th>
              <th className="px-3 py-2 text-right">Spread (ATS)</th>
              <th className="px-3 py-2">Win Prob</th>
              <th className="px-3 py-2 text-right">Rest</th>
            </tr>
          </thead>
          <tbody>
            {games.map((info) => {
              const opp = meta.get(info.opp);
              const isOpen = !!open[info.gameId];
              const gameRow = df.find((r) => Number(r.week) === info.week);
              const gv = (col: string): number | null => {
                const v = gameRow?.[col];
                return v == null ? null : Number(v);
              };
              return (
                <Fragment key={info.gameId}>
                  <tr
                    className={`${trCls} cursor-pointer ${info.played ? "" : "text-slate-400"}`}
                    onClick={() => setOpen((o) => ({ ...o, [info.gameId]: !o[info.gameId] }))}
                  >
                    <td className={`px-3 py-3 font-semibold text-slate-500 sm:py-2 ${stickyColCls}`}>
                      <span className={`mr-1.5 inline-block text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      W{info.week}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500" title={`${info.g.weekday ?? ""} ${info.g.gametime ?? ""}`}>
                      {info.g.gameday ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {opp?.logo && (
                          <TeamLogoLink
                            to={`/game_analysis/scorecards_teams?team=${info.opp}&season=${info.g.season}`}
                            logo={opp.logo}
                            alt={info.opp}
                            imgClassName="h-6 w-6 object-contain"
                            title={`Open ${opp.name} scorecard`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <span className="font-semibold text-slate-700">
                          {info.home ? "vs" : "@"} {info.opp}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {info.played ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                            info.tie ? "bg-slate-400" : info.win ? "bg-[#3C9A5F]" : "bg-[#C8102E]"
                          }`}
                        >
                          {info.tie ? "T" : info.win ? "W" : "L"}
                        </span>
                      ) : (
                        <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                          Scheduled
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {info.played ? <span className="font-semibold text-slate-800">{info.teamScore}–{info.oppScore}</span> : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        info.margin == null ? "text-slate-400" : info.margin > 0 ? "text-[#3C9A5F]" : info.margin < 0 ? "text-[#C8102E]" : "text-slate-500"
                      }`}
                    >
                      {info.margin == null ? "—" : `${info.margin > 0 ? "+" : ""}${info.margin}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {info.spreadForTeam == null ? (
                        "—"
                      ) : (
                        <span>
                          {info.spreadForTeam > 0 ? "+" : ""}
                          {info.spreadForTeam}
                          {info.atsResult && (
                            <span
                              className={`ml-1.5 text-[10px] font-bold ${
                                info.atsResult === "W" ? "text-[#3C9A5F]" : info.atsResult === "L" ? "text-[#C8102E]" : "text-slate-400"
                              }`}
                            >
                              {info.atsResult}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {info.teamProb != null && info.oppProb != null ? (
                        <div
                          className="flex h-2.5 w-24 overflow-hidden rounded-full bg-slate-200"
                          title={`${team} ${(info.teamProb * 100).toFixed(0)}% · ${info.opp} ${(info.oppProb * 100).toFixed(0)}%`}
                        >
                          <div style={{ width: `${info.teamProb * 100}%`, background: color }} />
                          <div className="flex-1" style={{ background: opp?.color ?? "#94a3b8" }} />
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {info.rest == null ? "—" : <span className={info.rest <= 5 ? "font-semibold text-[#C8102E]" : ""}>{info.rest}d</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-slate-100 bg-slate-50/70">
                      <td colSpan={9} className="px-4 py-4">
                        {info.played && gameRow ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Box score</div>
                                <MetricRow label="Points (allowed)" value={`${fmt(gv("points") ?? 0, 0)} (${fmt(gv("points_allowed") ?? 0, 0)})`} />
                                <MetricRow label="Total yards (allowed)" value={`${fmt(gv("total_yards") ?? 0, 0)} (${fmt(gv("total_yards_allowed") ?? 0, 0)})`} />
                                <MetricRow
                                  label="Pass / rush TDs (allowed)"
                                  value={`${fmt(gv("passing_tds") ?? 0, 0)}/${fmt(gv("rushing_tds") ?? 0, 0)} (${fmt(gv("passing_tds_allowed") ?? 0, 0)}/${fmt(gv("rushing_tds_allowed") ?? 0, 0)})`}
                                />
                                <MetricRow label="Turnovers (forced)" value={`${fmt(gv("turnovers") ?? 0, 0)} (${fmt(gv("turnovers_allowed") ?? 0, 0)})`} />
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Market win probability</div>
                                <GameProbBar info={info} meta={meta} team={team} />
                              </div>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="rounded-xl border border-slate-200 bg-white p-3" style={{ borderTop: `3px solid ${OFF_ACCENT}` }}>
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Offense — this game</div>
                                <div className="space-y-3">
                                  <GameStatBar label="Yards (passing vs rushing)" aVal={gv("passing_yards")} bVal={gv("rushing_yards")} aUnit="pass yds" bUnit="rush yds" accent={OFF_ACCENT} />
                                  <GameStatBar label="Play volume (pass attempts vs carries)" aVal={gv("attempts")} bVal={gv("carries")} aUnit="pass att" bUnit="rush car" accent={OFF_ACCENT} />
                                  <GameStatBar
                                    label="First downs (passing vs rushing)"
                                    aVal={gv("passing_first_downs")}
                                    bVal={gv("rushing_first_downs")}
                                    aUnit="pass 1st downs"
                                    bUnit="rush 1st downs"
                                    accent={OFF_ACCENT}
                                  />
                                </div>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-3" style={{ borderTop: `3px solid ${DEF_ACCENT}` }}>
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Defense (opponent) — this game</div>
                                <div className="space-y-3">
                                  <GameStatBar
                                    label="Yards allowed (pass vs rush)"
                                    aVal={gv("passing_yards_allowed")}
                                    bVal={gv("rushing_yards_allowed")}
                                    aUnit="pass yds allowed"
                                    bUnit="rush yds allowed"
                                    accent={DEF_ACCENT}
                                  />
                                  <GameStatBar
                                    label="Play volume faced (pass vs rush)"
                                    aVal={gv("attempts_allowed")}
                                    bVal={gv("carries_allowed")}
                                    aUnit="pass att faced"
                                    bUnit="rush car faced"
                                    accent={DEF_ACCENT}
                                  />
                                  <GameStatBar
                                    label="First downs allowed (pass vs rush)"
                                    aVal={gv("passing_first_downs_allowed")}
                                    bVal={gv("rushing_first_downs_allowed")}
                                    aUnit="pass 1st downs allowed"
                                    bUnit="rush 1st downs allowed"
                                    accent={DEF_ACCENT}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Market win probability</div>
                              <GameProbBar info={info} meta={meta} team={team} />
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <MetricRow label="Kickoff" value={`${info.g.gameday ?? "—"} ${info.g.gametime ?? ""} (${info.g.weekday ?? "—"})`} />
                              <MetricRow label="Venue" value={String(info.g.stadium ?? "—")} />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <ScrollHint />
      </div>
    </Card>
  );
}

export default function Scorecards() {
  const [searchParams] = useSearchParams();
  const { season, setSeason } = useSeasonWeek();
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [team, setTeam] = useState(searchParams.get("team") ?? "DAL");
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [schedule, setSchedule] = useState<Row[]>([]);

  usePageTitle(`Team Scorecard: ${team}`);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getMeta(), getGrades()]).then(([m, mt, g]) => {
      setMeta(m);
      setGrades(g);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
    });
  }, []);

  // Deep-linked season (e.g. from Team Comparison) wins over the shared
  // season/week context, applied once per mount.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const s = searchParams.get("season");
    if (s) {
      deepLinkApplied.current = true;
      setSeason(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!season) return;
    Promise.all([getTeamWeek(Number(season)), getTeamWeekRanks(Number(season)), getSchedule()]).then(([tw, rk, sch]) => {
      setTeamWeek(tw.filter((r) => r.game_type === "REG" || r.game_type == null));
      setRanks(rk);
      setSchedule(sch);
    });
  }, [season]);

  const teams = useMemo(() => [...new Set(teamWeek.map((r) => String(r.team)))].sort(), [teamWeek]);
  const df = useMemo(
    () => teamWeek.filter((r) => String(r.team) === team).sort((a, b) => Number(a.week) - Number(b.week)),
    [teamWeek, team],
  );
  const nTeams = teams.length;

  // League per-game averages: every team-week row of the season, equal weight.
  const leagueAvg = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (col: string): number | null => {
      if (!cache.has(col)) {
        const s = statOf(teamWeek, col);
        cache.set(col, s ? s.perGame : null);
      }
      return cache.get(col)!;
    };
  }, [teamWeek]);

  // Latest cumulative league rank for a column (season-to-date at the last played week).
  const lastWeek = useMemo(() => {
    const played = df.filter((r) => r.win != null).map((r) => Number(r.week));
    return played.length ? Math.max(...played) : null;
  }, [df]);
  const rankOf = useMemo(() => {
    const row = lastWeek == null ? undefined : ranks.find((r) => String(r.team) === team && Number(r.week) === lastWeek);
    return (col: string): number | null => {
      const v = row?.[`${col}_rank`];
      return v == null ? null : Math.round(Number(v));
    };
  }, [ranks, team, lastWeek]);

  const record = useMemo(() => {
    const played = df.filter((r) => r.win != null);
    const w = played.reduce((s, r) => s + Number(r.win), 0);
    return { wins: Math.round(w), losses: played.length - Math.round(w), games: played.length };
  }, [df]);

  // Season-average grades + league rank (same averaging as Team Comparison).
  const gradeInfo = useMemo(() => {
    const rows = grades.filter((r) => String(r.Season) === season);
    const byTeam = new Map<string, Row[]>();
    for (const r of rows) {
      const t = String(r.Team);
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(r);
    }
    const out: { key: string; label: string; value: number | null; rank: number | null }[] = [];
    for (const [key, label] of [["Overall Grade", "Overall"], ["Offensive Grade", "Offense"], ["Defensive Grade", "Defense"]] as const) {
      const avgs = [...byTeam.entries()]
        .map(([t, tr]) => ({ t, v: tr.reduce((s, r) => s + Number(r[key] ?? 0), 0) / tr.length }))
        .sort((a, b) => b.v - a.v);
      const mine = avgs.find((a) => a.t === team);
      out.push({ key, label, value: mine ? mine.v : null, rank: mine ? avgs.indexOf(mine) + 1 : null });
    }
    return { metrics: out, nGraded: byTeam.size };
  }, [grades, season, team]);

  const color = meta?.get(team)?.color ?? "#002f6c";

  // ---------- season schedule: every game this team/season, results filled in ----------
  const teamGames = useMemo<GameInfo[]>(() => {
    return schedule
      .filter((g) => Number(g.season) === Number(season) && g.game_type === "REG" && (g.home_team === team || g.away_team === team))
      .sort((a, b) => Number(a.week) - Number(b.week))
      .map((g) => gameInfoFor(g, team));
  }, [schedule, season, team]);

  // ---------- season journey: weekly points margin bars + overall grade line ----------
  const journeyOption = useMemo<EChartsOption | null>(() => {
    const played = df.filter((r) => r.win != null);
    if (!played.length) return null;
    const xs = played.map((r) => `W${r.week}`);
    const opps = played.map((r) => opponentLabel(String(r.game_id ?? ""), team));
    const margins = played.map((r) => (r.points_margin == null ? null : Number(r.points_margin)));
    const gradeByWeek = new Map(
      grades
        .filter((r) => String(r.Season) === season && String(r.Team) === team)
        .map((r) => [Number(r.Week), Number(r["Overall Grade"])]),
    );
    const gradeSeries = played.map((r) => gradeByWeek.get(Number(r.week)) ?? null);
    return {
      grid: { left: 10, right: 10, top: 34, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const m = margins[i];
          const g = gradeSeries[i];
          return `${xs[i]} vs ${opps[i]}<br/>Margin: ${m == null ? "—" : (m > 0 ? "+" : "") + m}${m != null ? (m > 0 ? " (W)" : m < 0 ? " (L)" : " (T)") : ""}<br/>Overall grade: ${g == null ? "—" : Math.round(g)}`;
        },
      },
      xAxis: { type: "category", data: xs, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "Margin", axisLabel: { fontSize: 10 } },
        { type: "value", name: "Grade", min: 0, max: 100, axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: "Points margin",
          type: "bar",
          barMaxWidth: 26,
          data: margins.map((m) => ({
            value: m,
            itemStyle: { color: m != null && m > 0 ? "#3C9A5F" : m != null && m < 0 ? "#C8102E" : "#94a3b8", borderRadius: 3 },
          })),
        },
        {
          name: "Overall grade",
          type: "line",
          yAxisIndex: 1,
          data: gradeSeries,
          lineStyle: { color: "#002f6c", width: 2 },
          itemStyle: { color: "#002f6c" },
          symbolSize: 5,
        },
      ],
    } as EChartsOption;
  }, [df, grades, season, team]);
  const journeyRef = useECharts(journeyOption);

  // League rank of this team's a/(a+b) share for a metric pair (#1 = highest share).
  const shareRank = useMemo(() => {
    return (aCol: string, bCol: string): number | null => {
      const shares: { t: string; v: number }[] = [];
      for (const t of teams) {
        const rows = teamWeek.filter((r) => String(r.team) === t);
        const a = statOf(rows, aCol)?.total ?? 0;
        const b = statOf(rows, bCol)?.total ?? 0;
        if (a + b > 0) shares.push({ t, v: a / (a + b) });
      }
      shares.sort((x, y) => y.v - x.v);
      const i = shares.findIndex((s) => s.t === team);
      return i < 0 ? null : i + 1;
    };
  }, [teamWeek, teams, team]);

  // Sparkline points for a column (weeks in order, win flag + opponent for tooltips).
  const sparkPts = (col: string): SparkPoint[] =>
    df.map((r) => ({
      week: Number(r.week),
      opp: opponentLabel(String(r.game_id ?? ""), team),
      value: r[col] == null ? null : Number(r[col]),
      win: Number(r.win) === 1,
    }));

  if (!meta) return <Loading />;
  const tm = meta.get(team);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
          <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
          Team Scorecard
          <InfoDot text="For a league-wide statistical view, see Spread Win Percentage." />
        </h1>
        <div className="flex gap-4">
          <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t, label: meta.get(t)?.name ?? t }))} />
        </div>
      </div>

      {/* ---------- hero: identity + grades ---------- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ borderTop: `4px solid ${color}` }}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4">
          <div className="flex items-center gap-4">
            {tm?.logo && <img src={tm.logo} alt={team} className="h-16" />}
            <div>
              <div className="text-lg font-extrabold" style={{ color }}>{tm?.name ?? team}</div>
              <div className="text-sm text-slate-500">
                {season} regular season · <span className="font-bold text-slate-800">{record.wins}-{record.losses}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-6 text-center">
            {(
              [
                ["Points/Gm", statOf(df, "points"), rankOf("points"), 1],
                ["Allowed/Gm", statOf(df, "points_allowed"), rankOf("points_allowed"), 1],
              ] as const
            ).map(([l, s, rank, d]) => (
              <div key={l}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
                <div className="text-xl font-bold tabular-nums">{s ? fmt(s.perGame, d) : "—"}</div>
                {rank != null && <div className="text-[10px] font-semibold text-slate-400">#{rank} of {nTeams}</div>}
              </div>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {gradeInfo.metrics.map((g) => (
              <div key={g.key} className="w-20 rounded-xl border border-slate-200 px-2 py-1.5 text-center" title={`Model grade, season average. Rank #${g.rank ?? "—"} of ${gradeInfo.nGraded}.`}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{g.label}</div>
                <div className="text-lg font-bold tabular-nums">{g.value == null ? "—" : Math.round(g.value)}</div>
                <div className="text-[10px] font-semibold text-slate-400">{g.rank == null ? "" : `#${g.rank}`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- season journey ---------- */}
      <Card
        title="Season journey"
        subtitle="Weekly points margin (green = win, red = loss) with the model's overall grade overlaid (right axis)."
      >
        <div ref={journeyRef} className="h-[260px]" />
      </Card>

      {/* ---------- playstyle ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Offense style" subtitle="Pass vs rush share of season totals. Dashed marker = league-average pass share." accent={OFF_ACCENT}>
          <div className="space-y-4">
            {([
              ["Yards (passing vs rushing)", "passing_yards", "rushing_yards", "pass yds", "rush yds"],
              ["Play volume (pass attempts vs carries)", "attempts", "carries", "pass att", "rush car"],
              ["First downs (passing vs rushing)", "passing_first_downs", "rushing_first_downs", "pass 1st downs", "rush 1st downs"],
            ] as const).map(([label, aCol, bCol, aLabel, bLabel]) => (
              <div key={aCol}>
                <SplitBar label={label} a={statOf(df, aCol)?.total ?? 0} b={statOf(df, bCol)?.total ?? 0} la={statOf(teamWeek, aCol)?.total ?? 0} lb={statOf(teamWeek, bCol)?.total ?? 0} aName="Pass" bName="Rush" accent={OFF_ACCENT} rank={shareRank(aCol, bCol)} nTeams={nTeams} />
                <RawCounts a={statOf(df, aCol)?.total ?? null} b={statOf(df, bCol)?.total ?? null} aLabel={aLabel} bLabel={bLabel} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Defense style" subtitle="What opponents do against this team, share of season totals. Dashed marker = league average." accent={DEF_ACCENT}>
          <div className="space-y-4">
            {([
              ["Yards allowed (pass vs rush)", "passing_yards_allowed", "rushing_yards_allowed", "pass yds allowed", "rush yds allowed"],
              ["Play volume faced (pass vs rush)", "attempts_allowed", "carries_allowed", "pass att faced", "rush car faced"],
              ["First downs allowed (pass vs rush)", "passing_first_downs_allowed", "rushing_first_downs_allowed", "pass 1st downs allowed", "rush 1st downs allowed"],
            ] as const).map(([label, aCol, bCol, aLabel, bLabel]) => (
              <div key={aCol}>
                <SplitBar label={label} a={statOf(df, aCol)?.total ?? 0} b={statOf(df, bCol)?.total ?? 0} la={statOf(teamWeek, aCol)?.total ?? 0} lb={statOf(teamWeek, bCol)?.total ?? 0} aName="Pass" bName="Rush" accent={DEF_ACCENT} rank={shareRank(aCol, bCol)} nTeams={nTeams} />
                <RawCounts a={statOf(df, aCol)?.total ?? null} b={statOf(df, bCol)?.total ?? null} aLabel={aLabel} bLabel={bLabel} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------- stat panels ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Offense"
          subtitle="Per-game average · season total · league average per game · weekly trend (dashed = league avg, green dot = win)."
          accent={OFF_ACCENT}
        >
          <div className="divide-y divide-slate-100">
            {OFF_STATS.map(([label, col, d]) => (
              <StatRow key={col} label={label} s={statOf(df, col)} lg={leagueAvg(col)} rank={rankOf(col)} nTeams={nTeams} decimals={d} accent={OFF_ACCENT} pts={sparkPts(col)} />
            ))}
          </div>
        </Card>
        <Card
          title="Defense (allowed)"
          subtitle="What this team gives up. Same columns; for defense, lower is better — the rank chips already account for that."
          accent={DEF_ACCENT}
        >
          <div className="divide-y divide-slate-100">
            {OFF_STATS.map(([label, col, d]) => (
              <StatRow key={col} label={`${label} allowed`} s={statOf(df, `${col}_allowed`)} lg={leagueAvg(`${col}_allowed`)} rank={rankOf(`${col}_allowed`)} nTeams={nTeams} decimals={d} accent={DEF_ACCENT} pts={sparkPts(`${col}_allowed`)} />
            ))}
          </div>
        </Card>
      </div>

      {/* ---------- season schedule ---------- */}
      <ScheduleSection games={teamGames} meta={meta} team={team} color={color} df={df} />
    </div>
  );
}
