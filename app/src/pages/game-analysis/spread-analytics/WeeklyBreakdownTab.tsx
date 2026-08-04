// Weekly Breakdown tab — new analytics, not a port. Answers four things
// per week: (1) the "Spread by game" bar chart (same shape as Game Picks'
// spreadOption, GamePicks.tsx:274, but colored by real outcome once played
// or by historic upset risk while the week is still ahead — Game Picks'
// version colors by the *user's own local picks*, which doesn't apply here),
// (2) which rank (games ordered by |spread| within a week, 1 = biggest
// favorite) gets upset most often across NFL history, (3) which games in
// the selected week look like upset candidates given historic spread-bucket
// win rates, and (4) how every *other* occurrence of this same week number
// looked historically (e.g. "every Week 1") — spread and result side by
// side across seasons, independent of the season selector above. "Upset" =
// the favorite loses straight-up — same definition as Win Rate &
// Calibration's `favWin`/Win Type columns; there's no against-the-spread
// cover metric anywhere in this app.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getSchedule, type Row } from "../../../lib/data/loader";
import { Select } from "../../../components/filters/Select";
import { useECharts } from "../../../components/charts/useECharts";
import { rowChartH } from "../../../components/charts/sizing";
import { Loading, ErrorRetry } from "../../../components/Loading";
import { LazyMount } from "../../../components/LazyMount";
import { InfoDot } from "../../../components/InfoDot";
import { Kpi, Segmented, tableWrapCls, theadCls, trCls, ScrollHint } from "../../../components/ui";
import { WIN_TYPE_COLORS } from "../../../lib/logic/winType";
import { toGame, bucketOf, historicFavRate, computeRankStats, type Game } from "../../../lib/logic/spreadPicks";
import { useSeasonWeek } from "../../../context/SeasonWeekContext";

const BIN_SIZE = 1.0;
const SIGNED = true;
const NO_FAV_COLOR = "#94a3b8"; // pick'em — slate-400
const RISK_MIN_N = 10; // below this, a bucket's p̂ is too thin to trust for risk coloring

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
  const [spreadSort, setSpreadSort] = useState<"time" | "spread">("spread");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setLoadError(null);
    getSchedule()
      .then(setSchedule)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
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
  // through each season one at a time.
  const weekAcrossSeasons = useMemo(() => {
    const bySeason = new Map<number, Game[]>();
    for (const g of reg) {
      if (g.week !== Number(week)) continue;
      if (!bySeason.has(g.season)) bySeason.set(g.season, []);
      bySeason.get(g.season)!.push(g);
    }
    const rowsOut: { g: Game; rank: number }[] = [];
    for (const games of bySeason.values()) {
      const sorted = [...games].sort((a, b) => b.absSpread - a.absSpread);
      sorted.forEach((g, i) => rowsOut.push({ g, rank: i + 1 }));
    }
    rowsOut.sort((a, b) => b.g.season - a.g.season || a.rank - b.rank);

    const seasonSummary = [...bySeason.entries()]
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
      .sort((a, b) => a.season - b.season);

    return { rows: rowsOut, seasonSummary };
  }, [reg, week]);

  const weekAcrossSeasonsOption = useMemo<EChartsOption | null>(() => {
    const { seasonSummary } = weekAcrossSeasons;
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
  }, [weekAcrossSeasons]);

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

      <div className={tableWrapCls}>
        <div className="border-b border-slate-100 px-4 pb-2.5 pt-3.5">
          <div className="text-sm font-semibold text-slate-800">Every Week {week}, every season — spread &amp; result</div>
          <div className="mt-0.5 text-xs text-slate-500">Sorted by season (newest first), then rank (biggest favorite first) within that season's Week {week}.</div>
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
              {weekAcrossSeasons.rows.map(({ g, rank }) => {
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
    </div>
  );
}
