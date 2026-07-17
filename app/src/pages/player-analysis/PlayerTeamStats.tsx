// Port of player_team_stats_page_3.py — top-5 players per team for a stat,
// division-ordered team cards with a shared x-axis.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, readableTextColor, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { Loading } from "../../components/Loading";
import { useECharts } from "../../components/charts/useECharts";

const EXCLUDE = new Set([
  "season", "week", "team", "opponent_team", "gameday", "game_id",
  "season_type", "game_type", "position", "player_position", "player_id", "gsis_id",
]);
const OFFENSE_KW = [
  "completions", "attempts", "passing_yards", "passing_tds", "interceptions", "sacks", "sack_yards",
  "sack_fumbles", "sack_fumbles_lost", "passing_air_yards", "passing_yards_after_catch", "passing_first_downs",
  "passing_epa", "passing_2pt_conversions", "pacr", "dakota", "carries", "rushing_yards", "rushing_tds",
  "rushing_fumbles", "rushing_fumbles_lost", "rushing_first_downs", "rushing_epa", "rushing_2pt_conversions",
  "receptions", "targets", "receiving_yards", "receiving_tds", "receiving_fumbles", "receiving_fumbles_lost",
  "receiving_air_yards", "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa",
  "receiving_2pt_conversions", "racr", "target_share", "air_yards_share", "wopr",
  "special_teams_tds", "fantasy_points", "fantasy_points_ppr",
];
const DEFENSE_KW = [
  "tackles", "solo_tackles", "assists", "sacks", "qb_hits", "interceptions", "forced_fumbles",
  "fumbles_forced", "tfl", "pass_defended", "pressures", "hurries", "stops", "mtkl",
];
const CONF_ORDER = ["AFC", "NFC"];
const DIV_ORDER = ["East", "North", "South", "West"];

function niceCeiling(x: number): number {
  if (x <= 0 || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (x <= m * base) return m * base;
  return 10 * base;
}

const isPctStat = (s: string) => ["pct", "percentage", "rate", "%", "success_rate"].some((k) => s.toLowerCase().includes(k));
const pretty = (s: string) => {
  const parts = s.replace(/_/g, " ").trim().split(" ");
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? " " + parts.slice(1).join(" ") : "");
};

function TeamCard({ team, stat, players, xMax, meta }: {
  team: string;
  stat: string;
  players: { name: string; value: number; pct: number }[];
  xMax: number;
  meta: TeamMeta | undefined;
}) {
  const bg = meta?.color ?? "#888";
  const fg = readableTextColor(bg);
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
    xAxis: { type: "value", min: 0, max: xMax, show: false },
    yAxis: { type: "category", data: players.map((p) => p.name), inverse: true, axisLabel: { fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
    tooltip: {
      formatter: (p: unknown) => {
        const q = p as { dataIndex: number };
        const pl = players[q.dataIndex];
        return `${pl.name}<br/>${stat}: ${pl.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}<br/>% of team: ${pl.pct.toFixed(1)}%`;
      },
    },
    series: [
      {
        type: "bar",
        data: players.map((p) => +p.value.toFixed(2)),
        itemStyle: { color: meta?.color2 ?? "#666" },
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          formatter: (p: { value?: unknown }) => {
            const v = Number(p.value);
            return isPctStat(stat) ? `${(Math.abs(v) <= 1 ? v * 100 : v).toFixed(1)}%` : v < 0 ? v.toFixed(2) : Math.round(v).toLocaleString();
          },
        },
      },
    ],
  }), [players, xMax, stat, meta]);
  const ref = useECharts(option);
  return (
    <div className="rounded-2xl border border-white/20 p-2.5 shadow-md" style={{ background: bg, color: fg }}>
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="text-base font-extrabold">{team}</div>
          <div className="text-xs opacity-85">{pretty(stat)}</div>
        </div>
        {meta?.logo && <img src={meta.logo} alt={team} className="h-6" />}
      </div>
      <div className="rounded-lg bg-white/90 p-1">
        <div ref={ref} className="h-[200px]" />
      </div>
    </div>
  );
}

export default function PlayerTeamStats() {
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [seasonType, setSeasonType] = useState("REG");
  const [side, setSide] = useState<"offense" | "defense">("offense");
  const [stat, setStat] = useState("passing_yards");
  const [weekLo, setWeekLo] = useState(1);
  const [weekHi, setWeekHi] = useState(18);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getMeta()]).then(([m, mt]) => {
      setMeta(m);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setSeason(String(ss[0]));
    });
  }, []);
  useEffect(() => {
    if (season) getPlayerWeek(Number(season)).then(setRows);
  }, [season]);

  const seasonTypes = useMemo(() => [...new Set(rows.map((r) => String(r.season_type)))].sort(), [rows]);
  const typed = useMemo(() => rows.filter((r) => !seasonType || String(r.season_type) === seasonType), [rows, seasonType]);
  const allWeeks = useMemo(() => [...new Set(typed.map((r) => Number(r.week)))].sort((a, b) => a - b), [typed]);
  useEffect(() => {
    if (allWeeks.length) {
      setWeekLo(allWeeks[0]);
      setWeekHi(allWeeks[allWeeks.length - 1]);
    }
  }, [allWeeks.join(",")]);

  const numericCols = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((c) => !EXCLUDE.has(c) && rows.some((r) => typeof r[c] === "number"));
  }, [rows]);
  const sideCols = useMemo(() => {
    const kws = side === "offense" ? OFFENSE_KW : DEFENSE_KW;
    const f = numericCols.filter((c) => kws.some((k) => c.toLowerCase().includes(k)));
    return f.length ? f : numericCols;
  }, [numericCols, side]);
  const selStat = sideCols.includes(stat) ? stat : sideCols.includes("passing_yards") ? "passing_yards" : sideCols[0] ?? "";

  const grid = useMemo(() => {
    if (!selStat || !meta) return null;
    const lo = Math.min(weekLo, weekHi);
    const hi = Math.max(weekLo, weekHi);
    const sliced = typed.filter((r) => Number(r.week) >= lo && Number(r.week) <= hi && r.team != null);
    if (!sliced.length) return null;
    // per (team, player) sums
    const byTeam = new Map<string, Map<string, number>>();
    for (const r of sliced) {
      const t = String(r.team);
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      const v = r[selStat] == null ? NaN : Number(r[selStat]);
      if (!Number.isFinite(v)) continue;
      if (!byTeam.has(t)) byTeam.set(t, new Map());
      byTeam.get(t)!.set(p, (byTeam.get(t)!.get(p) ?? 0) + v);
    }
    const teamCards = [...byTeam.entries()].map(([team, players]) => {
      const nonZero = [...players.entries()].filter(([, v]) => v !== 0);
      const total = nonZero.reduce((s, [, v]) => s + v, 0);
      const top5 = nonZero.sort((a, b) => b[1] - a[1]).slice(0, 5);
      return {
        team,
        players: top5.map(([name, value]) => ({ name, value, pct: total ? (value / total) * 100 : 0 })),
      };
    });
    // shared x range: max top-1 across teams
    const top1s = teamCards.map((t) => t.players[0]?.value ?? 0).filter(Number.isFinite);
    const xMax = isPctStat(selStat)
      ? Math.max(...top1s.map(Math.abs), 0) <= 1 + 1e-9 ? 1 : 100
      : niceCeiling(Math.max(1, ...top1s) * 1.05);

    // group by conference/division
    const blocks: { conf: string; div: string; teams: typeof teamCards }[] = [];
    for (const conf of CONF_ORDER) {
      for (const div of DIV_ORDER) {
        const teams = teamCards
          .filter((t) => {
            const tm = meta.get(t.team);
            return tm?.conference === conf && tm?.division === `${conf} ${div}`;
          })
          .sort((a, b) => a.team.localeCompare(b.team));
        if (teams.length) blocks.push({ conf, div, teams });
      }
    }
    const used = new Set(blocks.flatMap((b) => b.teams.map((t) => t.team)));
    const leftovers = teamCards.filter((t) => !used.has(t.team)).sort((a, b) => a.team.localeCompare(b.team));
    if (leftovers.length) blocks.push({ conf: "Other", div: "Other", teams: leftovers });
    return { blocks, xMax };
  }, [typed, selStat, weekLo, weekHi, meta]);

  if (!meta) return <Loading />;

  let prevConf = "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Player Team Stats</h1>
        <Select label="Season Type" value={seasonType} onChange={setSeasonType} options={(seasonTypes.length ? seasonTypes : ["REG"]).map((t) => ({ value: t, label: t }))} />
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
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
          Weeks: {Math.min(weekLo, weekHi)}–{Math.max(weekLo, weekHi)}
          <div className="flex items-center gap-2">
            <input type="range" min={allWeeks[0] ?? 1} max={allWeeks[allWeeks.length - 1] ?? 18} value={weekLo} onChange={(e) => setWeekLo(Number(e.target.value))} className="w-32" />
            <input type="range" min={allWeeks[0] ?? 1} max={allWeeks[allWeeks.length - 1] ?? 18} value={weekHi} onChange={(e) => setWeekHi(Number(e.target.value))} className="w-32" />
          </div>
        </label>
      </div>

      {grid ? (
        <div className="space-y-3">
          {grid.blocks.map((b) => {
            const showConf = b.conf !== prevConf;
            prevConf = b.conf;
            return (
              <div key={`${b.conf}-${b.div}`}>
                {showConf && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <div className="h-px flex-1 bg-slate-300" />
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">{b.conf}</span>
                    <div className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                <div className="mb-1.5 flex items-center gap-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="rounded-full border border-slate-100 bg-white px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-500">{b.conf} • {b.div}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                  {b.teams.map((t) => (
                    <TeamCard key={t.team} team={t.team} stat={selStat} players={t.players} xMax={grid.xMax} meta={meta.get(t.team)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-slate-400">No data for the selected filters.</div>
      )}
    </div>
  );
}
