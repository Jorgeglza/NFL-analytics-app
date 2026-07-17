// Port of value_bets_page_5.py — offense vs defense ranking mismatches from
// to-date averages, players pivot with above-average highlighting, helper scatter.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getTeamWeek, getSchedule, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";

const PRIORITY = [
  "passing_yards", "rushing_yards", "receiving_yards", "passing_tds", "rushing_tds", "receiving_tds",
  "targets", "receptions", "carries", "fantasy_points", "fantasy_points_ppr",
];
const EXCLUDE = new Set([
  "season", "week", "team", "opponent_team", "gameday", "game_id", "season_type", "game_type",
  "position", "player_position", "player_id", "gsis_id", "team_score", "opponent_score",
]);

interface Mismatch {
  offTeam: string;
  defTeam: string;
  rankOff: number;
  rankDef: number;
  avgOff: number;
  avgDefAllowed: number;
  score: number;
}

export default function ValueBets() {
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [pw, setPw] = useState<Row[]>([]);
  const [tw, setTw] = useState<Row[]>([]);
  const [week, setWeek] = useState("");
  const [stat, setStat] = useState("receiving_yards");
  const [topN, setTopN] = useState(5);

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
    Promise.all([getPlayerWeek(Number(season)), getTeamWeek(Number(season))]).then(([p, t]) => {
      setPw(p);
      setTw(t.filter((x) => x.game_type === "REG" || x.game_type == null));
    });
  }, [season]);

  const s = Number(season);
  const regSched = useMemo(() => schedule.filter((g) => Number(g.season) === s && g.game_type === "REG"), [schedule, s]);
  const weeks = useMemo(() => [...new Set(regSched.map((g) => Number(g.week)))].sort((a, b) => a - b), [regSched]);
  const selWeek = weeks.map(String).includes(week) ? week : String(weeks[0] ?? "");
  const w = Number(selWeek);

  const numericCols = useMemo(() => {
    if (!pw.length) return [];
    const cols = Object.keys(pw[0]).filter((c) => !EXCLUDE.has(c) && pw.some((r) => typeof r[c] === "number"));
    return [...PRIORITY.filter((c) => cols.includes(c)), ...cols.filter((c) => !PRIORITY.includes(c))];
  }, [pw]);
  const selStat = numericCols.includes(stat) ? stat : numericCols[0] ?? "";
  const color = (t: string) => meta?.get(t)?.color ?? "#888";
  const logo = (t: string) => meta?.get(t)?.logo;

  // ranks from to-date means (like _rank_or_compute)
  const mismatches = useMemo<Mismatch[] | null>(() => {
    if (!tw.length || !selStat || !regSched.length) return null;
    const base = selStat.endsWith("_allowed") ? selStat.slice(0, -8) : selStat;
    const allowedCol = `${base}_allowed`;
    const cols = new Set(Object.keys(tw[0] ?? {}));
    if (!cols.has(base) || !cols.has(allowedCol)) return null;
    const upTo = tw.filter((r) => Number(r.week) <= w);
    const meanOf = (col: string): Map<string, number> => {
      const sum = new Map<string, { s: number; n: number }>();
      for (const r of upTo) {
        if (r[col] == null) continue;
        const t = String(r.team);
        if (!sum.has(t)) sum.set(t, { s: 0, n: 0 });
        const e = sum.get(t)!;
        e.s += Number(r[col]);
        e.n++;
      }
      return new Map([...sum.entries()].map(([t, e]) => [t, e.s / e.n]));
    };
    const offAvg = meanOf(base);
    const defAvg = meanOf(allowedCol);
    if (!offAvg.size || !defAvg.size) return null;
    // rank: off higher=better (rank 1 = highest); def lower allowed = better (rank 1 = lowest)
    const rankMap = (m: Map<string, number>, higherBetter: boolean): Map<string, number> => {
      const out = new Map<string, number>();
      for (const [t, v] of m) {
        let r = 1;
        for (const [, v2] of m) if (higherBetter ? v2 > v : v2 < v) r++;
        out.set(t, r);
      }
      return out;
    };
    const offRank = rankMap(offAvg, true);
    const defRank = rankMap(defAvg, false);
    const rows: Mismatch[] = [];
    for (const g of regSched.filter((g) => Number(g.week) === w)) {
      const away = String(g.away_team);
      const home = String(g.home_team);
      for (const [off, def] of [[away, home], [home, away]] as const) {
        const ro = offRank.get(off);
        const rd = defRank.get(def);
        if (ro == null || rd == null) continue;
        rows.push({
          offTeam: off,
          defTeam: def,
          rankOff: ro,
          rankDef: rd,
          avgOff: offAvg.get(off)!,
          avgDefAllowed: defAvg.get(def)!,
          score: rd - ro,
        });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, topN);
  }, [tw, selStat, regSched, w, topN]);

  const kpis = useMemo(() => {
    if (!mismatches?.length) return null;
    return {
      avg: (mismatches.reduce((a, m) => a + m.score, 0) / mismatches.length).toFixed(1),
      best: String(Math.max(...mismatches.map((m) => m.score))),
      opp: (mismatches.reduce((a, m) => a + m.avgDefAllowed, 0) / mismatches.length).toFixed(1),
    };
  }, [mismatches]);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!mismatches?.length) return null;
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const m = mismatches[q.dataIndex];
          return `Offense: ${m.offTeam} vs ${m.defTeam}<br/>Mismatch score: ${m.score}<br/>Off Rank: ${m.rankOff} | Opp Def Rank (allowed): ${m.rankDef}<br/>Team Avg: ${m.avgOff.toFixed(1)} | Opp Allowed Avg: ${m.avgDefAllowed.toFixed(1)}`;
        },
      },
      xAxis: { type: "category", data: mismatches.map((m) => `${m.offTeam} vs ${m.defTeam}`), axisLabel: { rotate: 20, fontSize: 10 } },
      yAxis: { type: "value", name: "Score (OppDefRank − OffRank)" },
      series: [{ type: "bar", data: mismatches.map((m) => ({ value: m.score, itemStyle: { color: color(m.offTeam) } })), label: { show: true, position: "top" } }],
    } as EChartsOption;
  }, [mismatches, meta]);

  const rankLinesOption = useMemo<EChartsOption | null>(() => {
    if (!mismatches?.length) return null;
    const labels = mismatches.map((m) => `${m.offTeam} vs ${m.defTeam}`);
    const series: object[] = [];
    mismatches.forEach((m, i) => {
      const lineColor = m.score >= 0 ? color(m.offTeam) : color(m.defTeam);
      series.push({
        type: "line",
        data: labels.map((_, j) => (j === i ? null : null)).map((_, j) => (j === i ? m.rankOff : null)),
        showSymbol: false,
        tooltip: { show: false },
      });
      // vertical line via custom pair series
      series.push({
        type: "line",
        data: labels.map((_, j) => (j === i ? m.rankOff : null)),
        lineStyle: { width: 0 },
        symbolSize: 26,
        symbol: logo(m.offTeam) ? `image://${logo(m.offTeam)}` : "circle",
        itemStyle: { color: color(m.offTeam) },
        tooltip: { show: false },
        z: 3,
      });
      series.push({
        type: "line",
        data: labels.map((_, j) => (j === i ? m.rankDef : null)),
        lineStyle: { width: 0 },
        symbolSize: 26,
        symbol: logo(m.defTeam) ? `image://${logo(m.defTeam)}` : "circle",
        itemStyle: { color: color(m.defTeam) },
        tooltip: { show: false },
        z: 3,
      });
      series.push({
        type: "bar",
        stack: `l${i}`,
        barGap: "-100%",
        barWidth: 4,
        data: labels.map((_, j) => (j === i ? Math.min(m.rankOff, m.rankDef) : null)),
        itemStyle: { color: "transparent" },
        tooltip: { show: false },
      });
      series.push({
        type: "bar",
        stack: `l${i}`,
        barWidth: 4,
        data: labels.map((_, j) => (j === i ? Math.abs(m.rankDef - m.rankOff) : null)),
        itemStyle: { color: lineColor },
        label: {
          show: true,
          position: "insideTop",
          fontSize: 13,
          fontWeight: "bold",
          color: lineColor,
          formatter: () => `${m.score >= 0 ? "+" : ""}${m.score}`,
        },
        tooltip: {
          show: true,
          formatter: () =>
            `<b>${m.offTeam}</b> Offense — Rank ${m.rankOff}, avg ${m.avgOff.toFixed(1)}<br/><b>${m.defTeam}</b> Defense allowed — Rank ${m.rankDef}, avg ${m.avgDefAllowed.toFixed(1)}<br/>Score: ${m.score >= 0 ? "+" : ""}${m.score}`,
        },
      });
    });
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      tooltip: { trigger: "item" },
      xAxis: { type: "category", data: labels, name: "Matchup", axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "Rank (1 best → 32 worst)", min: 0, max: 35 },
      series: series as never,
    } as EChartsOption;
  }, [mismatches, meta]);

  // players pivot for offense teams of the mismatches
  const pivot = useMemo(() => {
    if (!mismatches?.length || !pw.length || !selStat) return null;
    const oppOf = new Map(mismatches.map((m) => [m.offTeam, m.defTeam]));
    const scoreOf = new Map(mismatches.map((m) => [m.offTeam, m.score]));
    const teams = [...oppOf.keys()];
    const dfp = pw.filter((r) => String(r.season_type ?? "REG") === "REG" && teams.includes(String(r.team)));
    const allWeeks = weeks;
    const byPlayer = new Map<string, { team: string; cells: Map<number, number> }>();
    for (const r of dfp) {
      const v = r[selStat] == null ? NaN : Number(r[selStat]);
      if (!Number.isFinite(v)) continue;
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      const key = `${p}|${r.team}`;
      if (!byPlayer.has(key)) byPlayer.set(key, { team: String(r.team), cells: new Map() });
      const e = byPlayer.get(key)!;
      e.cells.set(Number(r.week), (e.cells.get(Number(r.week)) ?? 0) + v);
    }
    const players = [...byPlayer.entries()]
      .map(([key, e]) => {
        const vals = [...e.cells.values()];
        const total = vals.reduce((a, b) => a + b, 0);
        return {
          player: key.split("|")[0],
          team: e.team,
          cells: e.cells,
          total,
          rowAvg: vals.length ? total / vals.length : null,
          opp: oppOf.get(e.team) ?? "",
          mismatch: scoreOf.get(e.team) ?? null,
        };
      })
      .filter((p) => p.total !== 0)
      .sort((a, b) => b.total - a.total);
    const playerAvgs = players.map((p) => p.rowAvg ?? 0);
    const kpiPlayerAvg = playerAvgs.length ? (playerAvgs.reduce((a, b) => a + b, 0) / playerAvgs.length).toFixed(1) : "-";
    return { weeks: allWeeks, players, kpiPlayerAvg };
  }, [mismatches, pw, selStat, weeks]);

  const helperOption = useMemo<EChartsOption | null>(() => {
    if (!mismatches?.length) return null;
    return {
      grid: { left: 10, right: 20, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const m = mismatches[q.dataIndex];
          return `Off: ${m.offTeam} vs ${m.defTeam}<br/>Team Avg: ${m.avgOff.toFixed(1)}<br/>Opp Allowed Avg: ${m.avgDefAllowed.toFixed(1)}<br/>Off Rank: ${m.rankOff} | Opp Def Rank: ${m.rankDef}`;
        },
      },
      xAxis: { type: "value", name: "Opponent Avg Allowed (to date)", nameLocation: "middle", nameGap: 26, scale: true },
      yAxis: { type: "value", name: "Team Avg Production", scale: true },
      series: [
        {
          type: "scatter",
          symbolSize: 12,
          data: mismatches.map((m) => ({
            value: [+m.avgDefAllowed.toFixed(1), +m.avgOff.toFixed(1)],
            itemStyle: { color: color(m.offTeam) },
            label: { show: true, position: "top", fontSize: 9, formatter: `${m.offTeam} vs ${m.defTeam}` },
          })),
        },
      ],
    } as EChartsOption;
  }, [mismatches, meta]);

  const barRef = useECharts(barOption);
  const rankRef = useECharts(rankLinesOption);
  const helperRef = useECharts(helperOption);

  const fmt = (v: number | null | undefined) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1));

  if (!pw.length || !tw.length) return <Loading label="Loading value-bet data…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Value Bets — Mismatches</h1>
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `W${x}` }))} />
        <Select label="Stat" value={selStat} onChange={setStat} options={numericCols.map((c) => ({ value: c, label: c }))} />
        <label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Top-N: {topN}
          <input type="range" min={1} max={32} step={1} value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="w-44" />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          [`Avg Mismatch (Top ${topN})`, kpis?.avg ?? "-"],
          ["Best Mismatch Score", kpis?.best ?? "-"],
          [`Avg Opp Allowed (Top ${topN})`, kpis?.opp ?? "-"],
          ["Avg per Player (table)", pivot?.kpiPlayerAvg ?? "-"],
        ].map(([l, v]) => (
          <div key={l} className="min-w-44 flex-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
            <div className="text-[22px] font-bold">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm font-semibold">
          Top {topN} Mismatches — Week {selWeek} — {selStat.replace(/_/g, " ")}
        </div>
        <div ref={barRef} className="h-80" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm font-semibold">Rank Comparison (Y: Rank 1 best) — line colored by advantaged team</div>
        <div ref={rankRef} className="h-96" />
      </div>

      {pivot && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-2 py-2" />
                <th className="px-2 py-2 text-left">Team</th>
                <th className="px-2 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-center">Opp W{selWeek}</th>
                {pivot.weeks.map((wk) => (
                  <th key={wk} className="px-1.5 py-2 text-center">W{wk}</th>
                ))}
                <th className="px-2 py-2 text-center">Mismatch</th>
                <th className="px-2 py-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {pivot.players.map((p) => (
                <tr key={`${p.player}|${p.team}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1">{logo(p.team) && <img src={logo(p.team)!} alt={p.team} className="h-6 w-6 object-contain" />}</td>
                  <td className="px-2 py-1 text-left">{p.team}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-left font-medium">{p.player}</td>
                  <td className="px-2 py-1 text-center">{p.opp}</td>
                  {pivot.weeks.map((wk) => {
                    const v = p.cells.get(wk) ?? null;
                    const above = p.rowAvg != null && v != null && v >= p.rowAvg;
                    const tip = v != null && p.rowAvg != null ? `Value: ${v.toFixed(1)} — Player avg: ${p.rowAvg.toFixed(1)} — Above avg: ${above ? "Yes" : "No"}` : "";
                    return (
                      <td key={wk} title={tip} className={`px-1.5 py-1 text-center ${above ? "bg-emerald-500/20 font-semibold text-emerald-900" : ""}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-center font-semibold" title={p.mismatch != null ? `Offense mismatch for ${p.team}: ${p.mismatch >= 0 ? "+" : ""}${p.mismatch} (+ = offense advantage vs ${p.opp})` : ""}>
                    {p.mismatch == null ? "" : `${p.mismatch >= 0 ? "+" : ""}${p.mismatch}`}
                  </td>
                  <td className="px-2 py-1 text-center font-semibold">{fmt(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm font-semibold">Matchup Helper — Team Avg vs Opp Allowed (to date)</div>
        <div ref={helperRef} className="h-[340px]" />
      </div>
    </div>
  );
}
