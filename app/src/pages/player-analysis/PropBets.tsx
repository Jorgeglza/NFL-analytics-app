// Port of prop_bets_players_page_1.py — player-week pivot vs a prop line,
// with per-player bar + made/below donut.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getMeta, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { opponentLabel } from "../grading-model/shared";
import { Loading } from "../../components/Loading";
import { buildStatGroups, statLabel, americanOdds, headshotCrop, HIT_COLOR, MISS_COLOR, NEUTRAL_COLOR } from "./statPicker";

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
  // Seeded from the URL when arriving via a cross-link (audit §11 🟢, e.g. from
  // Matchup Bets) so the player/team/stat context carries over instead of
  // re-asking.
  const [searchParams] = useSearchParams();
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState(searchParams.get("season") ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [seasonType, setSeasonType] = useState("REG");
  const [team, setTeam] = useState(searchParams.get("team") ?? "");
  const [side, setSide] = useState<"offense" | "defense">("offense");
  const [stat, setStat] = useState(searchParams.get("stat") ?? "passing_yards");
  const [setLine, setSetLine] = useState<string>("");
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(searchParams.get("player"));

  useEffect(() => {
    getMeta().then((m) => {
      const ss = [...m.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length && !season) setSeason(String(ss[0]));
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
    const f = numericCols.filter((c) => {
      const lc = c.toLowerCase();
      // Keyword matching alone leaks def_* columns into offense ("sacks", "interceptions").
      if (side === "offense" && lc.startsWith("def_")) return false;
      return kws.some((k) => lc.includes(k));
    });
    return f.length ? f : numericCols;
  }, [numericCols, side]);
  const selStat = sideCols.includes(stat) ? stat : sideCols.includes("passing_yards") ? "passing_yards" : sideCols[0] ?? "";

  const statGroups = useMemo(() => buildStatGroups(sideCols, side), [sideCols, side]);

  const line = setLine === "" ? null : Number(setLine);

  // ---------- pivot ----------
  const pivot = useMemo(() => {
    if (!selTeam || !selStat) return null;
    const subset = filteredType.filter((r) => String(r.team) === selTeam && r.week != null);
    if (!subset.length) return null;
    const weekTotals = new Map<number, number>();
    const byPlayer = new Map<string, Map<number, number>>();
    const oppMap = new Map<string, string>(); // `${player}|${week}`
    const weekOpp = new Map<number, string>(); // team-level: who the game was against
    for (const r of subset) {
      const w = Number(r.week);
      const v = r[selStat] == null ? null : Number(r[selStat]);
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      if (r.game_id != null) {
        const opp = opponentLabel(String(r.game_id), selTeam);
        oppMap.set(`${p}|${w}`, opp);
        if (opp && !weekOpp.has(w)) weekOpp.set(w, opp);
      }
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
    return { weeks, players, weekTotals, oppMap, weekOpp };
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
  const headshotCrisp = useMemo(() => (headshot ? headshotCrop(headshot) : null), [headshot]);

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
          const pctT = v != null && total ? `${Math.round((v / total) * 100)}% of team ${statLabel(selStat)}` : "";
          return `Week ${w} vs ${pivot.oppMap.get(`${playerRow.player}|${w}`) ?? "?"}<br/>${statLabel(selStat)}: ${v ?? "—"}<br/>${pctT}`;
        },
      },
      xAxis: {
        type: "category",
        // Two-line label: week number + opponent (@ = away game).
        data: weeks.map((w) => `W${w}\n${pivot.weekOpp.get(w) ?? ""}`),
        axisLabel: { interval: 0, fontSize: 10, lineHeight: 13 },
      },
      yAxis: { type: "value", name: statLabel(selStat) },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({
            value: v,
            // No line set → neutral navy; with a line → green over / red under.
            itemStyle: { color: line == null ? NEUTRAL_COLOR : v != null && v >= line ? HIT_COLOR : MISS_COLOR },
          })),
          ...(line != null
            ? { markLine: { symbol: "none", lineStyle: { type: "dashed", color: HIT_COLOR, width: 2 }, label: { formatter: String(line) }, data: [{ yAxis: line }] } }
            : {}),
        },
      ],
    } as EChartsOption;
  }, [pivot, playerRow, selStat, line]);

  // Hit-rate vs the set line, over games the player actually has a value for.
  const verdict = useMemo(() => {
    if (!pivot || !playerRow || line == null || !Number.isFinite(line)) return null;
    const vals = pivot.weeks.map((w) => playerRow.cells.get(w)).filter((v): v is number => v != null);
    const total = vals.length;
    if (!total) return null;
    const made = vals.filter((v) => v >= line).length;
    const p = made / total;
    return { made, total, pct: Math.round(p * 100), odds: americanOdds(p) };
  }, [pivot, playerRow, line]);

  const donutOption = useMemo<EChartsOption | null>(() => {
    if (!verdict) return null;
    const { made, total, pct } = verdict;
    const below = total - made;
    return {
      legend: { bottom: 0 },
      graphic: [{ type: "text", left: "center", top: "middle", style: { text: `${pct}%`, fontSize: 24, fontWeight: "bold" } }],
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          label: { show: false },
          data: [
            { value: made, name: "Made Line", itemStyle: { color: HIT_COLOR } },
            { value: below, name: "Below Line", itemStyle: { color: MISS_COLOR } },
          ],
        },
      ],
    } as EChartsOption;
  }, [verdict]);

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
        <Select label="Stat" value={selStat} onChange={setStat} groups={statGroups} />
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#002f6c]">
          Set line
          <input
            type="number"
            step="0.5"
            value={setLine}
            onChange={(e) => setSetLine(e.target.value)}
            placeholder="e.g. 250.5"
            className="w-28 rounded-lg border-2 border-[#002f6c]/40 bg-white px-3 py-2 text-sm font-semibold shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
          />
        </label>
      </div>

      {pivot && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Player</th>
                {pivot.weeks.map((w) => (
                  <th key={w} className="px-2 py-2 text-center">
                    W{w}
                    <span className="block text-[9px] font-medium normal-case tracking-normal text-slate-400">
                      {pivot.weekOpp.get(w) ?? ""}
                    </span>
                  </th>
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
          <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
            Opponent shown under each week — @ = away game. A missing week is the team's bye.
          </div>
        </div>
      )}

      {playerRow && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          {verdict ? (
            <span>
              <span className="font-semibold">{playerRow.player}</span> cleared{" "}
              <span className="font-semibold">{line}</span> {statLabel(selStat).toLowerCase()} in{" "}
              <span className="font-semibold">{verdict.made} of {verdict.total}</span> games (
              <span className={`font-bold ${verdict.pct >= 50 ? "text-emerald-700" : "text-red-700"}`}>{verdict.pct}%</span>)
              {verdict.odds && (
                <span className="text-slate-500"> — implied fair odds {verdict.odds}</span>
              )}
            </span>
          ) : (
            <span className="text-slate-500">
              Set a line above to see how often <span className="font-medium text-slate-700">{playerRow.player}</span> cleared it and the implied fair odds.
            </span>
          )}
        </div>
      )}

      {playerRow && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex min-h-14 items-center gap-3">
              {headshotCrisp && (
                <img
                  src={headshotCrisp}
                  alt={playerRow.player}
                  width={56}
                  height={56}
                  loading="lazy"
                  className="h-14 w-14 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200"
                  onError={(e) => {
                    // Fall back to the untransformed CDN URL if the crop variant 404s.
                    if (headshot && e.currentTarget.src !== headshot) e.currentTarget.src = headshot;
                  }}
                />
              )}
              <span className="text-lg font-semibold">{playerRow.player} — {statLabel(selStat)}</span>
            </div>
            <div ref={barRef} className="h-[360px]" />
          </div>
          <div className="min-w-80 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 min-h-14 text-lg font-semibold">Made vs Below line</div>
            {verdict ? (
              <div ref={donutRef} className="h-[360px]" />
            ) : (
              <div className="flex h-[360px] items-center justify-center text-sm text-slate-400">
                Set a line to see the hit-rate split.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
