// Port of matchup_bets_page_4.py — single-game player pivots, stat mismatches
// and opponent-allowed trends. (Deviation: browser-local time instead of
// hardcoded America/Monterrey for the default week.)
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getTeamWeek, getTeamWeekRanks, getSchedule, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { opponentLabel } from "../grading-model/shared";
import { Loading } from "../../components/Loading";

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
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [pw, setPw] = useState<Row[]>([]);
  const [tw, setTw] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [week, setWeek] = useState("");
  const [gameId, setGameId] = useState("");
  const [stat, setStat] = useState("passing_yards");
  const [setLine, setSetLine] = useState("");
  const [topN, setTopN] = useState(8);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getSchedule(), getMeta()]).then(([m, s, mt]) => {
      setMeta(m);
      setSchedule(s);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setSeason(String(ss[0]));
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

  // default week = gameday closest to today
  const defaultWeek = useMemo(() => {
    let best: number | null = null;
    let bestD = Infinity;
    const today = Date.now();
    for (const g of regSched) {
      if (g.gameday == null) continue;
      const d = Math.abs(Date.parse(String(g.gameday)) - today);
      if (d < bestD) {
        bestD = d;
        best = Number(g.week);
      }
    }
    return best ?? weeks[0];
  }, [regSched, weeks]);
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
    rows.sort((a, b) => b.edge - a.edge);
    return rows.slice(0, topN);
  }, [ranks, away, home, w, topN]);

  const mmRanksOption = useMemo<EChartsOption | null>(() => {
    if (!mismatches?.length) return null;
    const labels = mismatches.map((m) => m.stat.replace(/_/g, " "));
    return {
      grid: { left: 10, right: 10, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0, textStyle: { fontSize: 10 } },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { seriesName: string; dataIndex: number };
          const m = mismatches[q.dataIndex];
          return q.seriesName.startsWith("Offense")
            ? `<b>${m.offTeam}</b> Offense<br/>Stat: ${m.stat}<br/>Rank: ${m.offRank}`
            : `Vs <b>${m.defTeam}</b> Defense<br/>Stat: ${m.stat}<br/>Allowed Rank: ${m.defAllowedRank}`;
        },
      },
      xAxis: { type: "category", data: labels, axisLabel: { rotate: 30, fontSize: 9 } },
      yAxis: { type: "value", name: "Rank" },
      series: [
        { name: "Offense Rank (lower better)", type: "bar", data: mismatches.map((m) => ({ value: m.offRank, itemStyle: { color: color(m.offTeam) } })) },
        { name: "Opp Allowed Rank", type: "bar", data: mismatches.map((m) => m.defAllowedRank), itemStyle: { color: "rgba(0,0,0,0.35)" } },
      ],
    } as EChartsOption;
  }, [mismatches, meta]);

  const mmScoreOption = useMemo<EChartsOption | null>(() => {
    if (!mismatches?.length) return null;
    const scores = mismatches.map((m) => m.defAllowedRank - m.offRank);
    const maxAbs = Math.max(5, ...scores.map(Math.abs)) + 2;
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const m = mismatches[q.dataIndex];
          return `<b>${m.offTeam}</b> offense vs <b>${m.defTeam}</b><br/>Stat: ${m.stat}<br/>Off Rank: ${m.offRank} | Opp Allowed Rank: ${m.defAllowedRank}<br/>Score: ${scores[q.dataIndex] >= 0 ? "+" : ""}${scores[q.dataIndex]}`;
        },
      },
      xAxis: { type: "category", data: mismatches.map((m) => `${m.offTeam} vs ${m.defTeam} — ${m.stat.replace(/_/g, " ")}`), axisLabel: { rotate: 30, fontSize: 8 } },
      yAxis: { type: "value", min: -maxAbs, max: maxAbs, name: "OppAllowedRank − OffRank" },
      series: [
        {
          type: "bar",
          data: mismatches.map((m, i) => ({ value: scores[i], itemStyle: { color: color(m.offTeam) } })),
          markLine: { symbol: "none", lineStyle: { color: "#aaa", width: 2 }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [mismatches, meta]);

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

  const mmRanksRef = useECharts(mmRanksOption);
  const mmScoreRef = useECharts(mmScoreOption);
  const totalsBarRef = useECharts(totalsBarOption);
  const totalsDonutRef = useECharts(totalsDonutOption);
  const oppAllowedRef = useECharts(oppAllowedOption);
  const playerBarRef = useECharts(playerBarOption);
  const playerDonutRef = useECharts(playerDonutOption);

  const fmt = (v: number | null | undefined) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1));

  if (!pw.length || !meta) return <Loading label="Loading matchup data…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Matchup Bets</h1>
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `W${x}` }))} />
        <Select label="Game" value={selGameId} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team} — ${g.gameday ?? ""}` }))} />
        <Select label="Stat" value={selStat} onChange={setStat} options={numericCols.map((c) => ({ value: c, label: c }))} />
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Set line
          <input type="number" value={setLine} onChange={(e) => setSetLine(e.target.value)} placeholder="set_line" className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </div>

      {/* Mismatches */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold">Matchup Mismatches (by Stat)</span>
          <label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Top-N: {topN}
            <input type="range" min={3} max={16} step={1} value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="w-40" />
          </label>
        </div>
        <div className="mb-2 flex gap-3">
          {[
            ["Best Edge", mismatches?.length ? mismatches[0].edge.toFixed(1) : "—"],
            ["Avg Edge (Top-N)", mismatches?.length ? (mismatches.reduce((a, m) => a + m.edge, 0) / mismatches.length).toFixed(1) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="min-w-40 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
              <div className="text-xl font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <div ref={mmRanksRef} className="h-80 min-w-80 flex-1" />
          <div ref={mmScoreRef} className="h-80 min-w-80 flex-1" />
        </div>
        <div className="mt-1 text-xs text-slate-500">Edge = Offense strength (inverted rank) + Opponent allowed rank. Higher = better mismatch.</div>
      </div>

      {/* Team totals */}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-72 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 text-sm font-semibold">{away} @ {home} — {selStat}</div>
          <div ref={totalsBarRef} className="h-60" />
        </div>
        <div className="min-w-72 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div ref={totalsDonutRef} className="h-64" />
        </div>
      </div>

      {/* Opponent allowed & rank */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm font-semibold">Opponent Avg Allowed &amp; Rank by Week — {away} vs {home}</div>
        <div ref={oppAllowedRef} className="h-80" />
      </div>

      {/* Pivot */}
      {pivot && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Player detail */}
      {playerRow && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex min-h-14 items-center gap-3">
              {headshot && <img src={headshot} alt={playerRow.player} className="h-14 w-14 rounded-full object-cover" />}
              <span className="text-lg font-semibold">{playerRow.player} — {selStat}</span>
            </div>
            <div ref={playerBarRef} className="h-[360px]" />
          </div>
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 min-h-14 text-lg font-semibold">Made vs Below line</div>
            <div ref={playerDonutRef} className="h-[360px]" />
          </div>
        </div>
      )}
    </div>
  );
}
