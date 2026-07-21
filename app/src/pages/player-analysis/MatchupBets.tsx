// Port of matchup_bets_page_4.py — single-game player pivots, stat mismatches
// and opponent-allowed trends. (Deviation: browser-local time instead of
// hardcoded America/Monterrey for the default week — correct by design, the
// viewer's own "now" rather than one fixed region; uses the same shared
// defaultWeekNearToday() as Matchup Previews/Models Guide.)
// UX audit §11: this page is now the single-game drill-down reached by
// "zoom in" from Value Bets (audit's "two-step journey" recommendation) —
// no longer in the navbar (see App.tsx); season/week/game/stat/player are
// seeded from the URL so context carries over instead of re-asking.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getTeamWeek, getTeamWeekRanks, getSchedule, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { opponentLabel } from "../grading-model/shared";
import { Loading } from "../../components/Loading";
import { buildMismatchStatGroups, statLabel } from "./statPicker";
import { defaultWeekNearToday } from "../game-analysis/previews/engine";

const CATEGORY_ORDER = ["Passing", "Rushing", "Receiving", "Other"] as const;
const PASSING_EXTRA = new Set(["completions", "attempts", "interceptions", "pacr", "dakota", "sack_fumbles", "sack_fumbles_lost", "sack_yards_lost", "sacks_suffered"]);
const RECEIVING_EXTRA = new Set(["targets", "receptions", "racr", "target_share", "air_yards_share", "wopr"]);
function categoryOf(base: string): (typeof CATEGORY_ORDER)[number] {
  const b = base.toLowerCase();
  if (b.startsWith("passing") || PASSING_EXTRA.has(b)) return "Passing";
  if (b.startsWith("rushing") || b === "carries") return "Rushing";
  if (b.startsWith("receiving") || RECEIVING_EXTRA.has(b)) return "Receiving";
  return "Other";
}

const PRIORITY = [
  "passing_yards", "rushing_yards", "receiving_yards", "passing_tds", "rushing_tds", "receiving_tds",
  "targets", "receptions", "carries", "interceptions", "sacks", "tackles", "qb_hits", "pressures",
  "fantasy_points", "fantasy_points_ppr",
];
const MM_PRIORITY = [
  "passing_yards", "passing_tds", "rushing_yards", "rushing_tds", "receiving_yards", "receiving_tds",
  "fantasy_points_ppr", "fantasy_points", "targets", "receptions", "carries",
];
const EXCLUDE = new Set([
  "season", "week", "team", "opponent_team", "gameday", "game_id", "season_type", "game_type",
  "position", "player_position", "player_id", "gsis_id", "team_score", "opponent_score",
]);

export default function MatchupBets() {
  const [searchParams] = useSearchParams();
  const urlSeason = searchParams.get("season") ?? "";
  const urlWeek = searchParams.get("week") ?? "";
  const urlGame = searchParams.get("game") ?? "";
  const urlStat = searchParams.get("stat");
  const urlPlayer = searchParams.get("player");

  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState(urlSeason);
  const [pw, setPw] = useState<Row[]>([]);
  const [tw, setTw] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [week, setWeek] = useState(urlWeek);
  const [gameId, setGameId] = useState(urlGame);
  const [stat, setStat] = useState(urlStat ?? "passing_yards");
  const [setLine, setSetLine] = useState("");
  const [topN, setTopN] = useState(8);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(urlPlayer);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getSchedule(), getMeta()]).then(([m, s, mt]) => {
      setMeta(m);
      setSchedule(s);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length && !season) setSeason(String(ss[0]));
    });
  }, []);
  useEffect(() => {
    if (!season) return;
    Promise.all([getPlayerWeek(Number(season)), getTeamWeek(Number(season)), getTeamWeekRanks(Number(season))]).then(
      ([p, t, r]) => {
        setPw(p);
        setTw(t.filter((x) => x.game_type === "REG" || x.game_type == null));
        setRanks(r);
      },
    );
  }, [season]);

  const s = Number(season);
  const regSched = useMemo(() => schedule.filter((g) => Number(g.season) === s && g.game_type === "REG"), [schedule, s]);
  const weeks = useMemo(() => [...new Set(regSched.map((g) => Number(g.week)))].sort((a, b) => a - b), [regSched]);

  // default week = gameday closest to today (shared with Matchup Previews/Models Guide)
  const defaultWeek = useMemo(() => defaultWeekNearToday(regSched, s) ?? weeks[0], [regSched, s, weeks]);
  const selWeek = weeks.map(String).includes(week) ? week : String(defaultWeek ?? "");
  const w = Number(selWeek);

  const games = useMemo(
    () =>
      regSched
        .filter((g) => Number(g.week) === w)
        .sort((a, b) => String(a.gameday ?? "").localeCompare(String(b.gameday ?? "")) || String(a.game_id).localeCompare(String(b.game_id))),
    [regSched, w],
  );
  const defaultGame = useMemo(() => {
    const now = Date.now();
    const fut = games.filter((g) => g.gameday != null && Date.parse(String(g.gameday)) >= now - 86400000);
    return String((fut[0] ?? games[0])?.game_id ?? "");
  }, [games]);
  const selGameId = games.some((g) => String(g.game_id) === gameId) ? gameId : defaultGame;
  const selGame = games.find((g) => String(g.game_id) === selGameId);
  const [away, home] = useMemo(() => {
    const parts = selGameId.split("_");
    return parts.length === 4 ? [parts[2], parts[3]] : ["", ""];
  }, [selGameId]);

  const numericCols = useMemo(() => {
    if (!pw.length) return [];
    const cols = Object.keys(pw[0]).filter((c) => !EXCLUDE.has(c) && pw.some((r) => typeof r[c] === "number"));
    return [...PRIORITY.filter((c) => cols.includes(c)), ...cols.filter((c) => !PRIORITY.includes(c))];
  }, [pw]);
  const selStat = numericCols.includes(stat) ? stat : numericCols[0] ?? "";
  const line = setLine === "" ? null : Number(setLine);
  const color = (t: string) => meta?.get(t)?.color ?? "#888";

  // ---------- rank helpers (carry-forward) ----------
  const rankCf = (team: string, wk: number, col: string): number | null => {
    const rows = ranks
      .filter((r) => String(r.team) === team && Number(r.week) <= wk && r[col] != null)
      .sort((a, b) => Number(a.week) - Number(b.week));
    return rows.length ? Number(rows[rows.length - 1][col]) : null;
  };

  // ---------- mismatches ----------
  const mismatches = useMemo(() => {
    if (!ranks.length || !away || !home) return null;
    const cols = new Set(Object.keys(ranks[0] ?? {}));
    const bases: string[] = [];
    for (const c of cols) if (c.endsWith("_rank") && !c.endsWith("_allowed_rank") && cols.has(`${c.slice(0, -5)}_allowed_rank`)) bases.push(c.slice(0, -5));
    const ordered = [...MM_PRIORITY.filter((b) => bases.includes(b)), ...bases.filter((b) => !MM_PRIORITY.includes(b)).sort()];
    if (!ordered.length) return null;
    // max rank scale
    let maxRank = 32;
    for (const b of ordered) {
      for (const c of [`${b}_rank`, `${b}_allowed_rank`]) {
        for (const r of ranks) {
          if (Number(r.week) <= w && r[c] != null) maxRank = Math.max(maxRank, Number(r[c]));
        }
      }
    }
    const rows: { stat: string; offTeam: string; defTeam: string; offRank: number; defAllowedRank: number; edge: number }[] = [];
    for (const base of ordered) {
      for (const [off, def] of [[away, home], [home, away]] as const) {
        const offR = rankCf(off, w, `${base}_rank`);
        const defR = rankCf(def, w, `${base}_allowed_rank`);
        if (offR != null && defR != null) {
          rows.push({ stat: base, offTeam: off, defTeam: def, offRank: offR, defAllowedRank: defR, edge: maxRank - offR + 1 + defR });
        }
      }
    }
    // Edge = maxRank − offR + 1 + defR, bounded [2, 2·maxRank] (offR/defR ∈ [1, maxRank]).
    // Give the raw number a scale (audit §11 🟡): 0–100 position on that fixed range + a
    // qualitative band, so "52.0" reads as something without needing this week's full population.
    const lo = 2;
    const hi = 2 * maxRank;
    const scored = rows
      .sort((a, b) => b.edge - a.edge)
      .map((r) => {
        const scalePct = Math.round(((r.edge - lo) / (hi - lo)) * 100);
        const band = scalePct >= 75 ? "Strong" : scalePct >= 50 ? "Solid" : scalePct >= 25 ? "Slight" : "Weak";
        return { ...r, scalePct, band, edgeMax: hi, category: categoryOf(r.stat) };
      });
    return scored.slice(0, topN);
  }, [ranks, away, home, w, topN]);

  // Group the biggest mismatches by category (audit follow-up: the flat 8-stat
  // list plus two rank-bar charts didn't answer "what kind of mismatch is
  // this" — categories let you scan Passing/Rushing/Receiving/Other and drill
  // into one at a time instead of parsing two dense always-on charts).
  const groupedMismatches = useMemo(() => {
    if (!mismatches?.length) return [];
    const byCat = new Map<string, typeof mismatches>();
    for (const m of mismatches) {
      const list = byCat.get(m.category) ?? [];
      list.push(m);
      byCat.set(m.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c))
      .map((category) => ({ category, stats: byCat.get(category)!, best: byCat.get(category)![0] }))
      .sort((a, b) => b.best.edge - a.best.edge);
  }, [mismatches]);

  const [openCategory, setOpenCategory] = useState<string | null>(null);
  useEffect(() => {
    setOpenCategory(groupedMismatches[0]?.category ?? null);
    // Reset the drill-down to the biggest category whenever the selected game
    // (or its just-loaded mismatch data) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selGameId, ranks.length]);

  // ---------- team totals ----------
  const scope = useMemo(
    () => pw.filter((r) => (String(r.team) === away || String(r.team) === home) && String(r.season_type ?? "REG") === "REG"),
    [pw, away, home],
  );
  const teamTotals = useMemo(() => {
    const tot = new Map<string, number>();
    for (const r of scope) {
      const v = r[selStat] == null ? NaN : Number(r[selStat]);
      if (Number.isFinite(v)) tot.set(String(r.team), (tot.get(String(r.team)) ?? 0) + v);
    }
    return [tot.get(away) ?? 0, tot.get(home) ?? 0];
  }, [scope, selStat, away, home]);

  const totalsBarOption = useMemo<EChartsOption | null>(() => {
    if (!away) return null;
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: [away, home] },
      yAxis: { type: "value", name: selStat.replace(/_/g, " ") },
      tooltip: {},
      series: [
        {
          type: "bar",
          data: [
            { value: Math.round(teamTotals[0]), itemStyle: { color: color(away) } },
            { value: Math.round(teamTotals[1]), itemStyle: { color: color(home) } },
          ],
          label: { show: true, position: "top" },
        },
      ],
    } as EChartsOption;
  }, [teamTotals, away, home, selStat, meta]);
  const totalsDonutOption = useMemo<EChartsOption | null>(() => {
    if (!away) return null;
    return {
      legend: { bottom: 0 },
      tooltip: {},
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          label: { show: true, formatter: "{b}\n{d}%" },
          data: [
            { value: +teamTotals[0].toFixed(1), name: away, itemStyle: { color: color(away) } },
            { value: +teamTotals[1].toFixed(1), name: home, itemStyle: { color: color(home) } },
          ],
        },
      ],
    } as EChartsOption;
  }, [teamTotals, away, home, meta]);

  // ---------- opponent allowed & rank ----------
  const oppAllowedOption = useMemo<EChartsOption | null>(() => {
    if (!tw.length || !away || !selStat) return null;
    const cols = new Set(Object.keys(tw[0] ?? {}));
    const base = selStat.endsWith("_allowed") ? selStat.slice(0, -8) : selStat;
    const allowedCol = cols.has(`${base}_allowed`) ? `${base}_allowed` : cols.has(base) ? base : null;
    if (!allowedCol) return null;
    const wksAll = [...new Set(regSched.map((g) => Number(g.week)))].sort((a, b) => a - b).filter((x) => x <= w + 1);
    const oppOf = (team: string, wk: number): string | null => {
      const g = regSched.find((g) => Number(g.week) === wk && (String(g.home_team) === team || String(g.away_team) === team));
      if (!g) return null;
      return String(g.home_team) === team ? String(g.away_team) : String(g.home_team);
    };
    const avgAllowed = (opp: string | null, wk: number): number | null => {
      if (!opp) return null;
      const vals = tw
        .filter((r) => String(r.team) === opp && Number(r.week) <= wk && r[allowedCol] != null)
        .map((r) => Number(r[allowedCol]));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const rankOfOpp = (opp: string | null, wk: number): number | null => {
      if (!opp) return null;
      return rankCf(opp, wk, `${allowedCol}_rank`) ?? rankCf(opp, wk, `${base}_rank`);
    };
    const series = [away, home].map((team) => ({
      team,
      opps: wksAll.map((wk) => oppOf(team, wk)),
      avg: wksAll.map((wk) => {
        const v = avgAllowed(oppOf(team, wk), wk);
        return v == null ? null : +v.toFixed(2);
      }),
      rank: wksAll.map((wk) => rankOfOpp(oppOf(team, wk), wk)),
    }));
    const maxRank = Math.max(32, ...series.flatMap((sr) => sr.rank.filter((r): r is number => r != null)));
    return {
      grid: { left: 10, right: 45, top: 30, bottom: 25, containLabel: true },
      legend: { bottom: 0, textStyle: { fontSize: 10 } },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const ps = params as { seriesName: string; dataIndex: number; value: number | null; seriesType: string }[];
          const idx = ps[0]?.dataIndex ?? 0;
          const lines = [`Week ${wksAll[idx]}`];
          for (const sr of series) {
            lines.push(`<b>${sr.team}</b> — Opp: ${sr.opps[idx] ?? "—"} | Avg allowed: ${sr.avg[idx] ?? "—"} | Rank: ${sr.rank[idx] ?? "—"}`);
          }
          return lines.join("<br/>");
        },
      },
      xAxis: { type: "category", data: wksAll.map(String), name: "Week", nameLocation: "middle", nameGap: 24 },
      yAxis: [
        { type: "value", name: `${allowedCol.replace(/_/g, " ")}` },
        { type: "value", name: "Opp Rank", min: 1, max: maxRank, splitLine: { show: false } },
      ],
      series: [
        { name: `${away} Opp Allowed`, type: "bar", data: series[0].avg, itemStyle: { color: color(away), opacity: 0.95 } },
        { name: `${home} Opp Allowed`, type: "bar", data: series[1].avg, itemStyle: { color: color(home), opacity: 0.65 } },
        { name: `${away} Opp Rank`, type: "line", yAxisIndex: 1, data: series[0].rank, lineStyle: { color: color(away), width: 2 }, itemStyle: { color: color(away) }, symbolSize: 5 },
        { name: `${home} Opp Rank`, type: "line", yAxisIndex: 1, data: series[1].rank, lineStyle: { color: color(home), width: 2 }, itemStyle: { color: color(home) }, symbolSize: 5 },
      ],
    } as EChartsOption;
  }, [tw, regSched, away, home, selStat, w, ranks, meta]);

  // ---------- pivot ----------
  const pivot = useMemo(() => {
    if (!away || !selStat || !scope.length) return null;
    const allWeeks = [...new Set(regSched.map((g) => Number(g.week)))].sort((a, b) => a - b);
    const byPlayer = new Map<string, Map<number, number>>();
    const playerTeamTotals = new Map<string, Map<string, number>>(); // player -> team -> sum (dominant team)
    const teamWeekTotals = new Map<string, number>(); // `${team}|${week}`
    const oppMap = new Map<string, string>();
    for (const r of scope) {
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      const wk = Number(r.week);
      const v = r[selStat] == null ? NaN : Number(r[selStat]);
      const t = String(r.team);
      if (r.game_id != null) oppMap.set(`${p}|${wk}`, opponentLabel(String(r.game_id), t));
      if (!Number.isFinite(v)) continue;
      if (!byPlayer.has(p)) byPlayer.set(p, new Map());
      byPlayer.get(p)!.set(wk, (byPlayer.get(p)!.get(wk) ?? 0) + v);
      if (!playerTeamTotals.has(p)) playerTeamTotals.set(p, new Map());
      playerTeamTotals.get(p)!.set(t, (playerTeamTotals.get(p)!.get(t) ?? 0) + v);
      teamWeekTotals.set(`${t}|${wk}`, (teamWeekTotals.get(`${t}|${wk}`) ?? 0) + v);
    }
    const players = [...byPlayer.entries()]
      .map(([p, cells]) => {
        const total = [...cells.values()].reduce((a, b) => a + b, 0);
        const teamEntry = [...(playerTeamTotals.get(p) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0];
        return { player: p, cells, total, team: teamEntry?.[0] ?? "" };
      })
      .filter((p) => p.total !== 0)
      .sort((a, b) => b.total - a.total || a.team.localeCompare(b.team) || a.player.localeCompare(b.player));
    return { weeks: allWeeks, players, teamWeekTotals, oppMap };
  }, [scope, regSched, selStat, away]);

  const selPlayer = useMemo(() => {
    if (!pivot?.players.length) return null;
    if (selectedPlayer && pivot.players.some((p) => p.player === selectedPlayer)) return selectedPlayer;
    return pivot.players[0].player;
  }, [pivot, selectedPlayer]);
  const playerRow = pivot?.players.find((p) => p.player === selPlayer) ?? null;
  const headshot = useMemo(() => {
    const r = scope.find((r) => String(r.player_display_name ?? r.player_name ?? r.player_id) === selPlayer && r.headshot_url != null);
    return r ? String(r.headshot_url) : null;
  }, [scope, selPlayer]);

  const playerBarOption = useMemo<EChartsOption | null>(() => {
    if (!pivot || !playerRow) return null;
    const wks = pivot.weeks.filter((wk) => playerRow.cells.has(wk));
    const vals = wks.map((wk) => playerRow.cells.get(wk)!);
    return {
      grid: { left: 10, right: 15, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          return `Week W${wks[q.dataIndex]}<br/>${selStat}: ${vals[q.dataIndex]}`;
        },
      },
      xAxis: { type: "category", data: wks.map((wk) => `W${wk}`), name: "Week", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: selStat },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({ value: v, itemStyle: { color: line != null && v >= line ? "green" : "red" } })),
          label: { show: true, position: "top", fontSize: 9, formatter: (p: { value?: unknown }) => `${Math.round(Number(p.value))}` },
          ...(line != null ? { markLine: { symbol: "none", lineStyle: { type: "dashed", color: "green", width: 2 }, label: { show: false }, data: [{ yAxis: line }] } } : {}),
        },
      ],
    } as EChartsOption;
  }, [pivot, playerRow, selStat, line]);

  const playerDonutOption = useMemo<EChartsOption | null>(() => {
    if (!pivot || !playerRow) return null;
    const vals = pivot.weeks.map((wk) => playerRow.cells.get(wk)).filter((v): v is number => v != null);
    const made = line != null ? vals.filter((v) => v >= line).length : 0;
    const below = Math.max(vals.length - made, 0);
    const pct = vals.length ? Math.round((made / vals.length) * 100) : 0;
    return {
      legend: { bottom: 0 },
      graphic: [{ type: "text", left: "center", top: "middle", style: { text: `${pct}%`, fontSize: 24, fontWeight: "bold" } }],
      series: [{ type: "pie", radius: ["55%", "80%"], label: { show: false }, data: [
        { value: made, name: "Made Line", itemStyle: { color: "green" } },
        { value: below, name: "Below Line", itemStyle: { color: "red" } },
      ] }],
    } as EChartsOption;
  }, [pivot, playerRow, line]);

  const totalsBarRef = useECharts(totalsBarOption);
  const totalsDonutRef = useECharts(totalsDonutOption);
  const oppAllowedRef = useECharts(oppAllowedOption);
  const playerBarRef = useECharts(playerBarOption);
  const playerDonutRef = useECharts(playerDonutOption);

  const fmt = (v: number | null | undefined) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1));

  if (!pw.length || !meta) return <Loading label="Loading matchup data…" />;

  const bandColor = (band: string) =>
    band === "Strong" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : band === "Solid" ? "bg-blue-100 text-blue-800 border-blue-200"
    : band === "Slight" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="space-y-4">
      <Link
        to={`/player_analysis/value_bets?season=${season}&week=${selWeek}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-[#002f6c] hover:underline"
      >
        ← Back to Value Bets
      </Link>
      {/* 1. Game-specific selection — Stat lives below, next to the section it actually drives */}
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Matchup Bets</h1>
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `W${x}` }))} />
        <Select label="Game" value={selGameId} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team} — ${g.gameday ?? ""}` }))} />
      </div>

      {/* 2. General KPIs / game info */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          {meta?.get(away)?.logo && <img src={meta.get(away)!.logo} alt={away} className="h-9 w-9 object-contain" />}
          <span className="text-xl font-extrabold text-slate-800">{away}</span>
          <span className="text-sm font-medium text-slate-400">@</span>
          <span className="text-xl font-extrabold text-slate-800">{home}</span>
          {meta?.get(home)?.logo && <img src={meta.get(home)!.logo} alt={home} className="h-9 w-9 object-contain" />}
          {selGame?.gameday && <span className="ml-1 text-xs text-slate-400">{selGame.gameday}</span>}
        </div>
        <div className="ml-auto flex flex-wrap gap-3">
          {[
            ["Best Mismatch", mismatches?.length ? `${mismatches[0].edge.toFixed(1)} — ${mismatches[0].band}` : "—"],
            [`Avg Edge (Top ${topN})`, mismatches?.length ? (mismatches.reduce((a, m) => a + m.edge, 0) / mismatches.length).toFixed(1) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="min-w-40 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
              <div className="text-xl font-bold">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Biggest mismatches, grouped by category with a drill-down */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold">Matchup Mismatches — by category</span>
          <label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Top-N: {topN}
            <input type="range" min={3} max={16} step={1} value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="w-40" />
          </label>
        </div>
        {groupedMismatches.length ? (
          <div className="divide-y divide-slate-100">
            {groupedMismatches.map((g) => {
              const isOpen = openCategory === g.category;
              const maxRank = g.best.edgeMax / 2;
              return (
                <div key={g.category}>
                  <button
                    onClick={() => setOpenCategory(isOpen ? null : g.category)}
                    className="flex w-full items-center gap-2 py-2.5 text-left"
                  >
                    <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                    <span className="font-semibold text-slate-800">{g.category}</span>
                    <span className="text-xs text-slate-400">{g.stats.length} stat{g.stats.length === 1 ? "" : "s"}</span>
                    <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${bandColor(g.best.band)}`}>
                      Best: {statLabel(g.best.stat)} <b>{g.best.edge.toFixed(1)}</b> · {g.best.band}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 pb-3 pl-5">
                      {g.stats.map((m) => (
                        <div key={`${m.stat}-${m.offTeam}-${m.defTeam}`} className="flex flex-wrap items-center gap-2.5">
                          <span className="w-44 shrink-0 text-xs font-medium text-slate-700">{statLabel(m.stat)}</span>
                          <div className="flex min-w-40 flex-1 items-center gap-1.5">
                            <span className="w-20 shrink-0 text-right text-[10px] text-slate-500">{m.offTeam} #{m.offRank}</span>
                            <div className="h-2 flex-1 rounded-full bg-slate-100">
                              <div className="h-2 rounded-full" style={{ width: `${((maxRank - m.offRank + 1) / maxRank) * 100}%`, background: color(m.offTeam) }} />
                            </div>
                          </div>
                          <div className="flex min-w-40 flex-1 items-center gap-1.5">
                            <div className="h-2 flex-1 rounded-full bg-slate-100">
                              <div className="h-2 rounded-full" style={{ width: `${(m.defAllowedRank / maxRank) * 100}%`, background: "rgba(0,0,0,0.35)" }} />
                            </div>
                            <span className="w-28 shrink-0 text-[10px] text-slate-500">vs {m.defTeam} #{m.defAllowedRank} allowed</span>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${bandColor(m.band)}`}>
                            {m.edge.toFixed(1)} · {m.band}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-slate-400">No rank data for this matchup yet.</div>
        )}
        <div className="mt-2 text-xs text-slate-500">
          Edge = Offense strength (inverted rank) + Opponent allowed rank, on a fixed 2–{mismatches?.length ? mismatches[0].edgeMax : "2N"} scale for this league size.
          Weak &lt;25% · Slight 25–50% · Solid 50–75% · Strong ≥75%. Higher = better mismatch. Left bar = offense strength, right bar = opponent allowed — longer is better for that side.
        </div>
      </div>

      {/* 4. Stat detail comparison — Stat + Set line live here, next to what they drive */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <span className="text-sm font-semibold">Stat Detail Comparison</span>
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Stat" value={selStat} onChange={setStat} groups={buildMismatchStatGroups(numericCols)} />
            <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Set line
              <input type="number" value={setLine} onChange={(e) => setSetLine(e.target.value)} placeholder="set_line" className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-72 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-1 text-xs font-semibold text-slate-500">{away} @ {home} — {statLabel(selStat)} (season total)</div>
            <div ref={totalsBarRef} className="h-60" />
          </div>
          <div className="min-w-72 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div ref={totalsDonutRef} className="h-64" />
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">Opponent Avg Allowed &amp; Rank by Week — {away} vs {home}</div>
          <div ref={oppAllowedRef} className="h-80" />
        </div>

      {/* Pivot */}
      {pivot && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-2 py-2" />
                <th className="px-2 py-2 text-left">Team</th>
                <th className="px-2 py-2 text-left">Player</th>
                {pivot.weeks.map((wk) => (
                  <th key={wk} className="px-1.5 py-2 text-center">W{wk}</th>
                ))}
                <th className="px-2 py-2 text-center">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {pivot.players.map((p) => (
                <tr key={p.player} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${p.player === selPlayer ? "bg-blue-50" : ""}`} onClick={() => setSelectedPlayer(p.player)}>
                  <td className="px-2 py-1">{meta?.get(p.team)?.logo && <img src={meta.get(p.team)!.logo} alt={p.team} className="h-6 w-6 object-contain" />}</td>
                  <td className="px-2 py-1 text-left">{p.team}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-left font-medium">{p.player}</td>
                  {pivot.weeks.map((wk) => {
                    const v = p.cells.get(wk) ?? null;
                    const hit = line != null && v != null && v >= line;
                    const twt = pivot.teamWeekTotals.get(`${p.team}|${wk}`);
                    const tip = v != null ? `Opp: ${pivot.oppMap.get(`${p.player}|${wk}`) ?? ""} — ${twt ? Math.round((v / twt) * 100) : 0}% of team` : "";
                    return (
                      <td key={wk} title={tip} className={`px-1.5 py-1 text-center ${hit ? "bg-emerald-500/25 font-semibold text-emerald-900" : ""}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-center font-semibold">{fmt(p.total)}</td>
                  <td className="px-2 py-1 text-center">
                    <Link
                      to={`/player_analysis/prop_bets_players?season=${season}&team=${p.team}&stat=${selStat}&player=${encodeURIComponent(p.player)}`}
                      title="Open in Prop Bets"
                      onClick={(e) => e.stopPropagation()}
                      className="text-slate-400 hover:text-[#002f6c]"
                    >
                      →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Player detail */}
      {playerRow && (
        <div className="mt-3 flex flex-wrap gap-3">
          <div className="min-w-80 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-2 flex min-h-14 items-center gap-3">
              {headshot && <img src={headshot} alt={playerRow.player} className="h-14 w-14 rounded-full object-cover" />}
              <span className="text-sm font-semibold">{playerRow.player} — {statLabel(selStat)}</span>
            </div>
            <div ref={playerBarRef} className="h-[360px]" />
          </div>
          <div className="min-w-80 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-2 min-h-14 text-sm font-semibold">Made vs Below line</div>
            <div ref={playerDonutRef} className="h-[360px]" />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
