// Weekly Breakdown tab — new analytics, not a port. Answers five things
// per week: (1) the "Spread by game" bar chart (same shape as Game Picks'
// spreadOption, GamePicks.tsx:274, but colored by real outcome once played
// or by historic upset risk while the week is still ahead — Game Picks'
// version colors by the *user's own local picks*, which doesn't apply here),
// (2) which rank (games ordered by |spread| within a week, 1 = biggest
// favorite) gets upset most often across NFL history, (3) which games in
// the selected week look like upset candidates given historic spread-bucket
// win rates, (4) how every *other* occurrence of this same week number
// looked historically (e.g. "every Week 1") — a per-season summary chart up
// front, with the full game-by-game list collapsed behind a toggle (its row
// list is only built when expanded — nothing to show by default, so no
// reason to pay for it), and (5) per-team history for this week number —
// straight-up record, surfacing the best/worst performers. "Upset" (used
// throughout, including the per-team best/worst call) = the favorite (or,
// for (5), the team) loses straight-up — same definition as Win Rate &
// Calibration's `favWin`/Win Type columns; there's no against-the-spread
// cover metric anywhere in this app, by design.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getSchedule, type Row } from "../../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../../lib/team/meta";
import { Select } from "../../../components/filters/Select";
import { useECharts } from "../../../components/charts/useECharts";
import { rowChartH } from "../../../components/charts/sizing";
import { Loading, ErrorRetry } from "../../../components/Loading";
import { LazyMount } from "../../../components/LazyMount";
import { InfoDot } from "../../../components/InfoDot";
import { Kpi, Segmented, tableWrapCls, theadCls, trCls, ScrollHint } from "../../../components/ui";
import { WIN_TYPE_COLORS } from "../../../lib/logic/winType";
import { toGame, bucketOf, historicFavRate, computeRankStats, type Game } from "../../../lib/logic/spreadPicks";
import { eloTeamKey } from "../../../lib/logic/elo";
import { useSeasonWeek } from "../../../context/SeasonWeekContext";
import TeamWeekModal, { type TeamWeekGame } from "./TeamWeekModal";

const BIN_SIZE = 1.0;
const SIGNED = true;
const NO_FAV_COLOR = "#94a3b8"; // pick'em — slate-400
const RISK_MIN_N = 10; // below this, a bucket's p̂ is too thin to trust for risk coloring
const MIN_TEAM_GAMES = 3; // below this, a team's Week-N record is too thin for the best/worst callouts

// Upset-risk tiers for unplayed games, keyed off 1 - p̂(favorite win). Same
// green/orange/red family as WIN_TYPE_COLORS so "risk" reads on the same
// visual scale as "actual outcome" elsewhere in the app.
function riskTier(risk: number): { label: string; color: string } {
  if (risk < 0.25) return { label: "Low risk", color: "#3C9A5F" };
  if (risk < 0.4) return { label: "Medium risk", color: "#E87722" };
  return { label: "High risk", color: "#C8102E" };
}

const stepBtnCls =
  "grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500";

export default function WeeklyBreakdownTab() {
  const { season, week, setSeason, setWeek } = useSeasonWeek();
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [teamMeta, setTeamMeta] = useState<Map<string, TeamMeta>>(new Map());
  const [spreadSort, setSpreadSort] = useState<"time" | "spread">("spread");
  const [showFullTable, setShowFullTable] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setLoadError(null);
    getSchedule()
      .then(setSchedule)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    // Best-effort — logos/colors just don't render in the team popup if this fails.
    getTeamMetaMap()
      .then(setTeamMeta)
      .catch(() => setTeamMeta(new Map()));
  }, [retryTick]);

  const reg = useMemo(
    () => schedule.filter((r) => r.game_type === "REG").map(toGame).filter((g): g is Game => g != null),
    [schedule],
  );
  const seasons = useMemo(() => [...new Set(reg.map((g) => g.season))].sort((a, b) => b - a), [reg]);
  const weeks = useMemo(
    () => [...new Set(reg.filter((g) => g.season === Number(season)).map((g) => g.week))].sort((a, b) => a - b),
    [reg, season],
  );
  const weekIdx = weeks.indexOf(Number(week));
  const stepWeek = (dir: -1 | 1) => {
    const next = weeks[weekIdx + dir];
    if (next != null) setWeek(String(next));
  };

  // Raw scheduling rows (for kickoff time/day) matched back up with the
  // parsed Game — toGame() drops fields it doesn't need, incl. gameday.
  const weekRows = useMemo(
    () => schedule.filter((r) => Number(r.season) === Number(season) && Number(r.week) === Number(week) && r.game_type === "REG"),
    [schedule, season, week],
  );
  const weekGames = useMemo(() => reg.filter((g) => g.season === Number(season) && g.week === Number(week)), [reg, season, week]);

  // Historic favorite win-rate lookup, excluding the selected week from its
  // own history — identical rule/population to Win Rate & Calibration's
  // Weekly Picks panel (historicFavRate is the same function it now shares).
  const pHatOf = useMemo(
    () => (season && week ? historicFavRate(reg, Number(season), Number(week), BIN_SIZE, SIGNED) : null),
    [reg, season, week],
  );

  const rankStats = useMemo(() => computeRankStats(reg), [reg]);
  const rankByN = useMemo(() => new Map(rankStats.map((r) => [r.rank, r])), [rankStats]);

  // Per-game view: rank (by |spread| desc within the week), historic p̂/risk,
  // actual outcome when played. Ranks with ties on |spread| keep insertion
  // order (schedule order), same as computeRankStats.
  const rows = useMemo(() => {
    const withRank = [...weekGames].sort((a, b) => b.absSpread - a.absSpread).map((g, i) => ({ g, rank: i + 1 }));
    return withRank.map(({ g, rank }) => {
      const row = weekRows.find((r) => String(r.game_id) === g.gameId);
      const bucket = bucketOf(g.spread, BIN_SIZE, SIGNED).label;
      const pHat = g.favorite && pHatOf ? pHatOf(bucket, g.favorite) : null;
      const risk = pHat == null ? null : 1 - pHat;
      const rankUpsetRate = rankByN.get(rank)?.upsetRate ?? null;
      const rankN = rankByN.get(rank)?.n ?? 0;
      return { g, row, rank, bucket, pHat, risk, rankUpsetRate, rankN };
    });
  }, [weekGames, weekRows, pHatOf, rankByN]);

  const played = rows.filter((r) => r.g.played && r.g.winType != null);
  const anyPlayed = played.length > 0;

  const kpis = useMemo(() => {
    const n = rows.length;
    const avgAbs = n ? rows.reduce((s, r) => s + r.g.absSpread, 0) / n : null;
    if (anyPlayed) {
      const upsets = played.filter((r) => !r.g.favWin).length;
      return {
        n,
        avgAbs,
        upsets,
        upsetRate: played.length ? (100 * upsets) / played.length : null,
        label: "Upsets so far",
        value: `${upsets}/${played.length}`,
      };
    }
    const risky = rows.filter((r) => r.risk != null && r.risk >= 0.4).length;
    return { n, avgAbs, upsets: null, upsetRate: null, label: "High-risk games", value: `${risky}`, risky };
  }, [rows, played, anyPlayed]);

  // ---------- Spread-by-game bar chart ----------
  const sortedRows = useMemo(() => {
    if (spreadSort === "spread") return [...rows].sort((a, b) => a.g.spread - b.g.spread);
    return [...rows].sort((a, b) => String(a.row?.gameday ?? "").localeCompare(String(b.row?.gameday ?? "")));
  }, [rows, spreadSort]);

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!sortedRows.length) return null;
    return {
      grid: { left: 10, right: 40, top: 25, bottom: 10, containLabel: true },
      xAxis: { type: "value", name: "Spread", nameLocation: "middle", nameGap: 22 },
      yAxis: {
        type: "category",
        inverse: true,
        data: sortedRows.map((r) => `${r.g.awayTeam} @ ${r.g.homeTeam}`),
        axisLabel: { fontSize: 10 },
      },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          barMaxWidth: 14,
          data: sortedRows.map((r) => {
            const played = r.g.played && r.g.winType != null;
            const color = played ? WIN_TYPE_COLORS[r.g.winType!] : r.risk == null ? NO_FAV_COLOR : riskTier(r.risk).color;
            const statusLabel = played ? r.g.winType! : r.risk == null ? "No favorite" : riskTier(r.risk).label;
            return {
              value: r.g.spread,
              itemStyle: { color, borderRadius: 3 },
              tooltip: {
                formatter: () =>
                  `${r.g.awayTeam} @ ${r.g.homeTeam} — ${String(r.row?.gameday ?? "")}<br/>Rank ${r.rank} (|spread| this week)<br/>${played ? `Winner: ${r.g.winner === "home" ? r.g.homeTeam : r.g.winner === "away" ? r.g.awayTeam : "—"} | ${statusLabel}` : `${statusLabel}${r.pHat != null ? ` — historic favorite win % ${(100 * r.pHat).toFixed(0)}%` : ""}`}<br/>Spread: ${r.g.spread.toFixed(1)} (${r.g.spread < 0 ? "home" : r.g.spread > 0 ? "away" : "pick'em"} favored)`,
              },
            };
          }),
          label: { show: true, position: "right", fontSize: 9, formatter: (p: { value?: unknown }) => String(p.value) },
        },
      ],
    } as EChartsOption;
  }, [sortedRows]);

  // ---------- Upset rate by rank (all-time) ----------
  const rankOption = useMemo<EChartsOption | null>(() => {
    if (!rankStats.length) return null;
    const shown = rankStats.filter((r) => r.n >= RISK_MIN_N);
    if (!shown.length) return null;
    return {
      grid: { left: 10, right: 15, top: 25, bottom: 30, containLabel: true },
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          if (!arr.length) return "";
          const r = shown[arr[0].dataIndex];
          return `Rank ${r.rank}<br/>Upset rate: ${(100 * r.upsetRate).toFixed(1)}%<br/>${r.upsets}/${r.n} games`;
        },
      },
      xAxis: { type: "category" as const, data: shown.map((r) => String(r.rank)), name: "Rank (1 = biggest favorite of the week)", nameLocation: "middle" as const, nameGap: 28, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value" as const, min: 0, max: 100, name: "Upset rate %" },
      series: [
        {
          type: "bar" as const,
          data: shown.map((r) => +(100 * r.upsetRate).toFixed(1)),
          itemStyle: { color: "#C8102E" },
          label: { show: true, position: "top" as const, fontSize: 9, formatter: (p: { value?: unknown }) => `${Number(p.value).toFixed(0)}%` },
        },
      ],
    } as EChartsOption;
  }, [rankStats]);

  // ---------- This week number across every season (e.g. "every Week 1") ----------
  // Independent of the season selector above — pools every REG game ever
  // played in the selected week *number*, regardless of season, so the user
  // can see how e.g. "Week 1" has looked historically without stepping
  // through each season one at a time. Grouped once and reused by both the
  // always-on summary chart (cheap — one row per season) and the full
  // game-by-game table (gated below — it's the one place on this page
  // that lists every game individually, ~15+ rows per season).
  const bySeasonForWeek = useMemo(() => {
    const m = new Map<number, Game[]>();
    for (const g of reg) {
      if (g.week !== Number(week)) continue;
      if (!m.has(g.season)) m.set(g.season, []);
      m.get(g.season)!.push(g);
    }
    return m;
  }, [reg, week]);

  const weekAcrossSeasonsSummary = useMemo(
    () =>
      [...bySeasonForWeek.entries()]
        .map(([s, games]) => {
          const gradedGames = games.filter((g) => g.played && g.winType != null);
          const upsets = gradedGames.filter((g) => !g.favWin).length;
          return {
            season: s,
            n: games.length,
            avgAbsSpread: games.reduce((sum, g) => sum + g.absSpread, 0) / games.length,
            graded: gradedGames.length,
            upsets,
            upsetRate: gradedGames.length ? upsets / gradedGames.length : null,
          };
        })
        .sort((a, b) => a.season - b.season),
    [bySeasonForWeek],
  );

  // Only built once the "Show full game-by-game history" toggle is opened —
  // nothing below reads this while collapsed, so skip the flatten/sort/rank
  // work (and the ~15+ rows/season of table markup it feeds) until asked for.
  const weekAcrossSeasonsRows = useMemo(() => {
    if (!showFullTable) return [];
    const rowsOut: { g: Game; rank: number }[] = [];
    for (const games of bySeasonForWeek.values()) {
      const sorted = [...games].sort((a, b) => b.absSpread - a.absSpread);
      sorted.forEach((g, i) => rowsOut.push({ g, rank: i + 1 }));
    }
    rowsOut.sort((a, b) => b.g.season - a.g.season || a.rank - b.rank);
    return rowsOut;
  }, [bySeasonForWeek, showFullTable]);

  // ---------- Per-team history for this week number (straight-up only) ----------
  // Answers "best/worst Week N performer" — straight-up record, same
  // definition as every other rate on this page (favWin/winType; no
  // against-the-spread metric). Aggregated directly from the raw schedule
  // rows rather than `reg`/`toGame` since it needs final scores, not just
  // the derived Game fields. Ties are excluded from the denominator,
  // matching this app's ties-excluded convention everywhere else (see Win
  // Rate & Calibration's header comment). Single pass over this week's rows
  // — cheap regardless of toggle state, so always computed (no reason to
  // gate this one). Team keys go through `eloTeamKey` (same franchise-
  // relocation alias Elo already uses: SD->LAC, OAK->LV, STL->LA) so a
  // relocated franchise's pre-move history joins its current abbreviation
  // instead of showing up as two separate rows.
  const teamStats = useMemo(() => {
    type Acc = { team: string; games: number; wins: number; losses: number };
    const acc = new Map<string, Acc>();
    const ensure = (t: string): Acc => {
      if (!acc.has(t)) acc.set(t, { team: t, games: 0, wins: 0, losses: 0 });
      return acc.get(t)!;
    };
    for (const r of schedule) {
      if (r.game_type !== "REG" || Number(r.week) !== Number(week)) continue;
      const hs = r.home_score == null ? null : Number(r.home_score);
      const as_ = r.away_score == null ? null : Number(r.away_score);
      if (hs == null || as_ == null) continue; // unplayed — no record to count yet
      const home = eloTeamKey(String(r.home_team));
      const away = eloTeamKey(String(r.away_team));
      const homeMargin = hs - as_;
      const h = ensure(home);
      const a = ensure(away);
      h.games++;
      a.games++;
      if (homeMargin > 0) {
        h.wins++;
        a.losses++;
      } else if (homeMargin < 0) {
        a.wins++;
        h.losses++;
      } // ties: counted in `games` but not wins/losses, matching the ties-excluded convention
    }
    return [...acc.values()]
      .map((t) => {
        const decisive = t.wins + t.losses;
        return { ...t, winPct: decisive ? t.wins / decisive : null };
      })
      .sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1) || b.games - a.games);
  }, [schedule, week]);

  const teamHighlights = useMemo(() => {
    const eligible = teamStats.filter((t) => t.games >= MIN_TEAM_GAMES);
    const best = eligible.length ? [...eligible].sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1))[0] : null;
    const worst = eligible.length ? [...eligible].sort((a, b) => (a.winPct ?? 2) - (b.winPct ?? 2))[0] : null;
    return { best, worst };
  }, [teamStats]);

  // Popup detail for one clicked team's Week-N history — game-by-game
  // (opponent, spread, score, result, win type, and that game's rank within
  // its own week, reusing `bySeasonForWeek`'s grouping). Includes the
  // current/unplayed season's game too (e.g. 2026 for Week 1) so the table
  // reads as "every occurrence of this matchup slot," not just graded ones —
  // score/result/win type render as "—" for it. Only built once a team is
  // actually clicked, same "don't compute what nobody asked for" rule as the
  // collapsed full table above.
  const teamGamesDetail = useMemo<TeamWeekGame[] | null>(() => {
    if (!selectedTeam) return null;
    const scoreByGameId = new Map(schedule.map((r) => [String(r.game_id), r]));
    return reg
      .filter((g) => g.week === Number(week) && (eloTeamKey(g.homeTeam) === selectedTeam || eloTeamKey(g.awayTeam) === selectedTeam))
      .map((g) => {
        const isHome = eloTeamKey(g.homeTeam) === selectedTeam;
        const opponent = isHome ? eloTeamKey(g.awayTeam) : eloTeamKey(g.homeTeam);
        const row = scoreByGameId.get(g.gameId);
        const hs = row?.home_score == null ? null : Number(row.home_score);
        const as_ = row?.away_score == null ? null : Number(row.away_score);
        const played = hs != null && as_ != null;
        const teamScore = played ? (isHome ? hs : as_) : null;
        const oppScore = played ? (isHome ? as_ : hs) : null;
        const tie = played && g.winner == null;
        const win = played ? !tie && ((isHome && g.winner === "home") || (!isHome && g.winner === "away")) : null;
        const spread = isHome ? g.spread : -g.spread;
        const seasonGames = bySeasonForWeek.get(g.season) ?? [];
        const rank = [...seasonGames].sort((a, b) => b.absSpread - a.absSpread).findIndex((x) => x.gameId === g.gameId) + 1;
        return { season: g.season, rank, opponent, isHome, spread, teamScore, oppScore, win, tie, winType: g.winType };
      });
  }, [selectedTeam, reg, schedule, week, bySeasonForWeek]);

  const weekAcrossSeasonsOption = useMemo<EChartsOption | null>(() => {
    const seasonSummary = weekAcrossSeasonsSummary;
    if (!seasonSummary.length) return null;
    return {
      grid: { left: 10, right: 40, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          if (!arr.length) return "";
          const s = seasonSummary[arr[0].dataIndex];
          return `${s.season}<br/>Avg |spread|: ${s.avgAbsSpread.toFixed(1)}<br/>Upset rate: ${s.upsetRate == null ? "—" : `${(100 * s.upsetRate).toFixed(0)}% (${s.upsets}/${s.graded})`}`;
        },
      },
      xAxis: { type: "category" as const, data: seasonSummary.map((s) => String(s.season)), axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value" as const, name: "Avg |spread|" },
        { type: "value" as const, name: "Upset rate %", min: 0, max: 100, splitLine: { show: false } },
      ],
      series: [
        { name: "Avg |spread|", type: "bar" as const, data: seasonSummary.map((s) => +s.avgAbsSpread.toFixed(1)), itemStyle: { color: "rgba(100,100,100,0.35)" } },
        {
          name: "Upset rate",
          type: "line" as const,
          yAxisIndex: 1,
          data: seasonSummary.map((s) => (s.upsetRate == null ? null : +(100 * s.upsetRate).toFixed(1))),
          connectNulls: false,
          symbolSize: 6,
          itemStyle: { color: "#C8102E" },
          lineStyle: { width: 2 },
        },
      ],
    } as EChartsOption;
  }, [weekAcrossSeasonsSummary]);

  const spreadRef = useECharts(spreadOption);
  const rankRef = useECharts(rankOption);
  const weekAcrossSeasonsRef = useECharts(weekAcrossSeasonsOption);

  if (loadError) return <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!schedule.length) return <Loading label="Loading schedule…" />;

  const riskiest = [...rows]
    .filter((r) => r.risk != null)
    .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
    .slice(0, 5)
    .map((r) => r.g.gameId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <div className="flex items-end gap-1.5">
          <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <button className={stepBtnCls} onClick={() => stepWeek(-1)} disabled={weekIdx <= 0} title="Previous week">‹</button>
          <button className={stepBtnCls} onClick={() => stepWeek(1)} disabled={weekIdx < 0 || weekIdx >= weeks.length - 1} title="Next week">›</button>
        </div>
        {!anyPlayed && rows.length > 0 && (
          <span className="pb-2 text-xs text-slate-400">
            Week {week} hasn't been played yet — bars and candidates below are colored by <span className="font-semibold">historic upset risk</span>, not results.
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="flex flex-wrap gap-3">
        <Kpi label="Games (N)" value={kpis.n} />
        <Kpi label="Avg |spread|" value={kpis.avgAbs == null ? "N/A" : kpis.avgAbs.toFixed(1)} />
        <Kpi label={kpis.label} value={kpis.value} accent={anyPlayed ? "#C8102E" : "#E87722"} sub={kpis.upsetRate != null ? `${kpis.upsetRate.toFixed(0)}% of graded games` : undefined} />
      </div>

      {/* Spread by game */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Spread by game — Week {week}, {season}
            <InfoDot text="Colored by actual result once played (green/blue = favorite won, orange/red = underdog won). Before kickoff, colored by historic upset risk for that spread bucket instead." />
          </h2>
          <Segmented value={spreadSort} onChange={setSpreadSort} options={[{ value: "time", label: "Game time" }, { value: "spread", label: "Spread" }]} />
        </div>
        {spreadOption ? (
          <div ref={spreadRef} style={{ height: Math.max(180, rowChartH(sortedRows.length, 28, 70)) }} />
        ) : (
          <div className="grid h-[180px] place-items-center text-sm text-slate-400">No games this week</div>
        )}
      </div>

      {/* Upset rate by rank */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Upset rate by rank — all seasons
          <InfoDot text="Games are ranked 1..N within each week by |spread| (1 = biggest favorite of that week), then the underdog-win rate at each rank is aggregated across every REG season/week on file. Ranks with fewer than 10 historic games are hidden — too few to read." />
        </h2>
        {rankOption ? (
          <LazyMount minHeight={280}>
            <div ref={rankRef} className="h-[280px]" />
          </LazyMount>
        ) : (
          <div className="grid h-[280px] place-items-center text-sm text-slate-400">Not enough history yet</div>
        )}
      </div>

      {/* Upset candidates */}
      <div className={tableWrapCls}>
        <div className="border-b border-slate-100 px-4 pb-2.5 pt-3.5">
          <div className="text-sm font-semibold text-slate-800">
            Upset candidates — Week {week}, {season}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Ranked by historic upset risk (1 − historic favorite win % for that spread bucket, excluding this week). Top 5 riskiest rows highlighted.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={theadCls}>
              <tr>
                {["Rank", "Game", "Spread", "Favorite", "Bucket", "Hist Fav %", "Upset Risk", "Rank Upset Rate (all-time)", "Result"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => (b.risk ?? -1) - (a.risk ?? -1))
                .map((r) => {
                  const isRisky = riskiest.includes(r.g.gameId);
                  const favTeam = r.g.favorite === "home" ? r.g.homeTeam : r.g.favorite === "away" ? r.g.awayTeam : "—";
                  const tier = r.risk == null ? null : riskTier(r.risk);
                  return (
                    <tr key={r.g.gameId} className={`${trCls} ${isRisky ? "bg-[#C8102E]/5" : ""}`}>
                      <td className="px-3 py-1.5">{r.rank}</td>
                      <td className="px-3 py-1.5 font-medium">{r.g.awayTeam} @ {r.g.homeTeam}</td>
                      <td className="px-3 py-1.5">{r.g.spread}</td>
                      <td className="px-3 py-1.5">{favTeam}</td>
                      <td className="px-3 py-1.5">{r.bucket}</td>
                      <td className="px-3 py-1.5">{r.pHat == null ? "—" : `${(100 * r.pHat).toFixed(1)}%`}</td>
                      <td className="px-3 py-1.5">
                        {tier ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: tier.color }}>
                            {r.risk != null ? `${(100 * r.risk).toFixed(0)}%` : ""} {isRisky ? "⚠️" : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5">{r.rankUpsetRate == null || r.rankN < RISK_MIN_N ? "—" : `${(100 * r.rankUpsetRate).toFixed(0)}% (n=${r.rankN})`}</td>
                      <td className="px-3 py-1.5">
                        {!r.g.played || r.g.winType == null ? (
                          <span className="text-slate-400">—</span>
                        ) : r.g.favWin ? (
                          <span className="font-bold text-[#3C9A5F]">✓ Favorite</span>
                        ) : (
                          <span className="font-bold text-[#C8102E]">✗ Upset</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <ScrollHint />
        </div>
      </div>

      {/* Every Week N across seasons — independent of the season selector above */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Week {week} across every season
          <InfoDot text="Every historic occurrence of this week number (not just the season selected above): average |spread| per season (bars, left axis) against the underdog-upset rate that season (line, right axis)." />
        </h2>
        {weekAcrossSeasonsOption ? (
          <LazyMount minHeight={280}>
            <div ref={weekAcrossSeasonsRef} className="h-[280px]" />
          </LazyMount>
        ) : (
          <div className="grid h-[280px] place-items-center text-sm text-slate-400">No history for this week yet</div>
        )}
      </div>

      {/* Team performance — Week N historically (straight-up only) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Team performance — Week {week} historically
          <InfoDot text={`Every team's straight-up Week ${week} record across every REG season on file (games actually won/lost — same definition as every other rate on this page). Best/worst callouts require at least ${MIN_TEAM_GAMES} graded games.`} />
        </h2>
        {teamStats.length ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3">
              <Kpi
                label={`Best Week ${week} performer`}
                value={teamHighlights.best ? teamHighlights.best.team : "—"}
                accent="#3C9A5F"
                sub={teamHighlights.best ? `${(100 * (teamHighlights.best.winPct ?? 0)).toFixed(0)}% (${teamHighlights.best.wins}-${teamHighlights.best.losses})` : `Needs ${MIN_TEAM_GAMES}+ games`}
              />
              <Kpi
                label={`Worst Week ${week} performer`}
                value={teamHighlights.worst ? teamHighlights.worst.team : "—"}
                accent="#C8102E"
                sub={teamHighlights.worst ? `${(100 * (teamHighlights.worst.winPct ?? 0)).toFixed(0)}% (${teamHighlights.worst.wins}-${teamHighlights.worst.losses})` : `Needs ${MIN_TEAM_GAMES}+ games`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={theadCls}>
                  <tr>
                    {["Team", "Games", "Record", "Win %"].map((h) => (
                      <th key={h} className="px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map((t) => (
                    <tr
                      key={t.team}
                      onClick={() => setSelectedTeam(t.team)}
                      title={`See ${t.team}'s Week ${week} history`}
                      className={`${trCls} cursor-pointer ${t.games < MIN_TEAM_GAMES ? "text-slate-400" : ""}`}
                    >
                      <td className="px-3 py-1.5 font-medium">{t.team}</td>
                      <td className="px-3 py-1.5">{t.games}</td>
                      <td className="px-3 py-1.5">{t.wins}-{t.losses}</td>
                      <td className="px-3 py-1.5">{t.winPct == null ? "—" : `${(100 * t.winPct).toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="grid h-[120px] place-items-center text-sm text-slate-400">No played games for Week {week} yet</div>
        )}
      </div>

      {/* Full game-by-game history — collapsed by default; row list (and its
          ~15+ rows/season of table markup) is only built once opened, see
          weekAcrossSeasonsRows above. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button onClick={() => setShowFullTable((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-sm font-semibold text-slate-800">Every Week {week}, every season — full spread &amp; result table</span>
          <span className="text-xs font-medium text-[#002f6c]">{showFullTable ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {showFullTable && (
          <div className="border-t border-slate-100">
            <div className="px-4 pb-2.5 pt-3.5 text-xs text-slate-500">
              Sorted by season (newest first), then rank (biggest favorite first) within that season's Week {week}.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={theadCls}>
                  <tr>
                    {["Season", "Rank", "Game", "Spread", "Favorite", "Result"].map((h) => (
                      <th key={h} className="px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekAcrossSeasonsRows.map(({ g, rank }) => {
                    const favTeam = g.favorite === "home" ? g.homeTeam : g.favorite === "away" ? g.awayTeam : "—";
                    return (
                      <tr key={g.gameId} className={`${trCls} ${g.season === Number(season) ? "bg-[#002f6c]/5" : ""}`}>
                        <td className="px-3 py-1.5 font-medium">{g.season}</td>
                        <td className="px-3 py-1.5">{rank}</td>
                        <td className="px-3 py-1.5">{g.awayTeam} @ {g.homeTeam}</td>
                        <td className="px-3 py-1.5">{g.spread}</td>
                        <td className="px-3 py-1.5">{favTeam}</td>
                        <td className="px-3 py-1.5">
                          {!g.played || g.winType == null ? (
                            <span className="text-slate-400">—</span>
                          ) : g.favWin ? (
                            <span className="font-bold text-[#3C9A5F]">✓ Favorite</span>
                          ) : (
                            <span className="font-bold text-[#C8102E]">✗ Upset</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ScrollHint />
            </div>
          </div>
        )}
      </div>

      {selectedTeam && teamGamesDetail && (
        <TeamWeekModal team={selectedTeam} week={week} meta={teamMeta.get(selectedTeam)} games={teamGamesDetail} onClose={() => setSelectedTeam(null)} />
      )}
    </div>
  );
}
