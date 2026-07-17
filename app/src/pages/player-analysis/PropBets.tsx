// Port of prop_bets_players_page_1.py — player-week pivot vs a prop line,
// with per-player bar + made/below donut.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getMeta, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { opponentLabel } from "../grading-model/shared";
import { Loading } from "../../components/Loading";

const EXCLUDE = new Set([
  "season", "week", "team", "opponent_team", "gameday", "game_id",
  "season_type", "game_type", "position", "player_position", "player_id", "gsis_id",
]);

const OFFENSE_KW = [
  "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
  "sacks", "sack_yards", "sack_fumbles", "sack_fumbles_lost",
  "passing_air_yards", "passing_yards_after_catch", "passing_first_downs",
  "passing_epa", "passing_2pt_conversions", "pacr", "dakota",
  "carries", "rushing_yards", "rushing_tds", "rushing_fumbles",
  "rushing_fumbles_lost", "rushing_first_downs", "rushing_epa", "rushing_2pt_conversions",
  "receptions", "targets", "receiving_yards", "receiving_tds",
  "receiving_fumbles", "receiving_fumbles_lost", "receiving_air_yards",
  "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa",
  "receiving_2pt_conversions", "racr", "target_share", "air_yards_share", "wopr",
  "special_teams_tds", "fantasy_points", "fantasy_points_ppr",
];
const DEFENSE_KW = [
  "tackles", "solo_tackles", "assists", "sacks", "qb_hits", "interceptions",
  "forced_fumbles", "fumbles_forced", "tfl", "pass_defended", "pressures",
  "hurries", "stops", "mtkl",
];

export default function PropBets() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [seasonType, setSeasonType] = useState("REG");
  const [team, setTeam] = useState("");
  const [side, setSide] = useState<"offense" | "defense">("offense");
  const [stat, setStat] = useState("passing_yards");
  const [setLine, setSetLine] = useState<string>("");
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  useEffect(() => {
    getMeta().then((m) => {
      const ss = [...m.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setSeason(String(ss[0]));
    });
  }, []);
  useEffect(() => {
    if (season) getPlayerWeek(Number(season)).then(setRows);
  }, [season]);

  const seasonTypes = useMemo(() => [...new Set(rows.map((r) => String(r.season_type)))].filter((s) => s !== "null").sort(), [rows]);
  const filteredType = useMemo(
    () => rows.filter((r) => !seasonType || String(r.season_type) === seasonType),
    [rows, seasonType],
  );
  const teams = useMemo(() => [...new Set(filteredType.map((r) => String(r.team)))].sort(), [filteredType]);
  const selTeam = teams.includes(team) ? team : teams[0] ?? "";

  const numericCols = useMemo(() => {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    return cols.filter((c) => !EXCLUDE.has(c) && rows.some((r) => typeof r[c] === "number"));
  }, [rows]);
  const sideCols = useMemo(() => {
    const kws = side === "offense" ? OFFENSE_KW : DEFENSE_KW;
    const f = numericCols.filter((c) => kws.some((k) => c.toLowerCase().includes(k)));
    return f.length ? f : numericCols;
  }, [numericCols, side]);
  const selStat = sideCols.includes(stat) ? stat : sideCols.includes("passing_yards") ? "passing_yards" : sideCols[0] ?? "";

  const line = setLine === "" ? null : Number(setLine);

  // ---------- pivot ----------
  const pivot = useMemo(() => {
    if (!selTeam || !selStat) return null;
    const subset = filteredType.filter((r) => String(r.team) === selTeam && r.week != null);
    if (!subset.length) return null;
    const weekTotals = new Map<number, number>();
    const byPlayer = new Map<string, Map<number, number>>();
    const oppMap = new Map<string, string>(); // `${player}|${week}`
    for (const r of subset) {
      const w = Number(r.week);
      const v = r[selStat] == null ? null : Number(r[selStat]);
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      if (r.game_id != null) oppMap.set(`${p}|${w}`, opponentLabel(String(r.game_id), selTeam));
      if (v == null || !Number.isFinite(v)) continue;
      weekTotals.set(w, (weekTotals.get(w) ?? 0) + v);
      if (!byPlayer.has(p)) byPlayer.set(p, new Map());
      byPlayer.get(p)!.set(w, (byPlayer.get(p)!.get(w) ?? 0) + v);
    }
    const weeks = [...new Set(subset.map((r) => Number(r.week)))].sort((a, b) => a - b);
    const players = [...byPlayer.entries()]
      .map(([p, m]) => ({ player: p, cells: m, total: [...m.values()].reduce((a, b) => a + b, 0) }))
      .filter((p) => p.total !== 0)
      .sort((a, b) => b.total - a.total);
    return { weeks, players, weekTotals, oppMap };
  }, [filteredType, selTeam, selStat]);

  const selPlayer = useMemo(() => {
    if (!pivot) return null;
    if (selectedPlayer && pivot.players.some((p) => p.player === selectedPlayer)) return selectedPlayer;
    return pivot.players[0]?.player ?? null;
  }, [pivot, selectedPlayer]);

  const playerRow = pivot?.players.find((p) => p.player === selPlayer) ?? null;
  const headshot = useMemo(() => {
    if (!selPlayer) return null;
    const r = filteredType.find(
      (r) => String(r.player_display_name ?? r.player_name ?? r.player_id) === selPlayer && r.headshot_url != null,
    );
    return r ? String(r.headshot_url) : null;
  }, [filteredType, selPlayer]);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!pivot || !playerRow) return null;
    const weeks = pivot.weeks;
    const vals = weeks.map((w) => playerRow.cells.get(w) ?? null);
    return {
      grid: { left: 10, right: 15, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const w = weeks[q.dataIndex];
          const v = vals[q.dataIndex];
          const total = pivot.weekTotals.get(w);
          const pctT = v != null && total ? `${Math.round((v / total) * 100)}% of ${selStat}` : "";
          return `Week ${w} | Opp: ${pivot.oppMap.get(`${playerRow.player}|${w}`) ?? ""}<br/>${selStat}: ${v ?? "—"}<br/>${pctT}`;
        },
      },
      xAxis: { type: "category", data: weeks.map((w) => `W${w}`), name: "Week", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: selStat },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({
            value: v,
            itemStyle: { color: line != null && v != null && v >= line ? "green" : "red" },
          })),
          ...(line != null
            ? { markLine: { symbol: "none", lineStyle: { type: "dashed", color: "green", width: 2 }, label: { formatter: String(line) }, data: [{ yAxis: line }] } }
            : {}),
        },
      ],
    } as EChartsOption;
  }, [pivot, playerRow, selStat, line]);

  const donutOption = useMemo<EChartsOption | null>(() => {
    if (!pivot || !playerRow) return null;
    const vals = pivot.weeks.map((w) => playerRow.cells.get(w)).filter((v): v is number => v != null);
    const total = vals.length;
    const made = line != null ? vals.filter((v) => v >= line).length : 0;
    const below = Math.max(total - made, 0);
    const pct = total ? Math.round((made / total) * 100) : 0;
    return {
      legend: { bottom: 0 },
      graphic: [{ type: "text", left: "center", top: "middle", style: { text: `${pct}%`, fontSize: 24, fontWeight: "bold" } }],
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          label: { show: false },
          data: [
            { value: made, name: "Made Line", itemStyle: { color: "green" } },
            { value: below, name: "Below Line", itemStyle: { color: "red" } },
          ],
        },
      ],
    } as EChartsOption;
  }, [pivot, playerRow, line]);

  const barRef = useECharts(barOption);
  const donutRef = useECharts(donutOption);

  const fmt = (v: number | null | undefined) =>
    v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1);

  if (!rows.length) return <Loading label="Loading player data…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Prop Bets — Players</h1>
        <Select label="Season Type" value={seasonType} onChange={setSeasonType} options={(seasonTypes.length ? seasonTypes : ["REG"]).map((t) => ({ value: t, label: t }))} />
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Team" value={selTeam} onChange={setTeam} options={teams.map((t) => ({ value: t, label: t }))} />
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Side
          <div className="flex gap-2">
            {(["offense", "defense"] as const).map((sd) => (
              <button key={sd} onClick={() => setSide(sd)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal capitalize ${side === sd ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {sd}
              </button>
            ))}
          </div>
        </div>
        <Select label="Stat" value={selStat} onChange={setStat} options={sideCols.map((c) => ({ value: c, label: c }))} />
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Set line
          <input type="number" value={setLine} onChange={(e) => setSetLine(e.target.value)} placeholder="set_line" className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </div>

      {pivot && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Player</th>
                {pivot.weeks.map((w) => (
                  <th key={w} className="px-2 py-2 text-center">W{w}</th>
                ))}
                <th className="px-3 py-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {pivot.players.map((p) => (
                <tr key={p.player} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${p.player === selPlayer ? "bg-blue-50" : ""}`} onClick={() => setSelectedPlayer(p.player)}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-left font-medium">{p.player}</td>
                  {pivot.weeks.map((w) => {
                    const v = p.cells.get(w) ?? null;
                    const hit = line != null && v != null && v >= line;
                    const total = pivot.weekTotals.get(w);
                    const tip = v != null && total ? `Opp: ${pivot.oppMap.get(`${p.player}|${w}`) ?? ""} — ${Math.round((v / total) * 100)}% of ${selStat}` : "";
                    return (
                      <td key={w} title={tip} className={`px-2 py-1.5 text-center ${hit ? "bg-emerald-500/25 font-semibold text-emerald-900" : ""}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-center font-semibold">{fmt(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playerRow && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex min-h-14 items-center gap-3">
              {headshot && <img src={headshot} alt={playerRow.player} className="h-14 w-14 rounded-full object-cover" />}
              <span className="text-lg font-semibold">{playerRow.player} — {selStat}</span>
            </div>
            <div ref={barRef} className="h-[360px]" />
          </div>
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 min-h-14 text-lg font-semibold">Made vs Below line</div>
            <div ref={donutRef} className="h-[360px]" />
          </div>
        </div>
      )}
    </div>
  );
}
