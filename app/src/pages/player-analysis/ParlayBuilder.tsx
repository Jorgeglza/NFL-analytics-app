// Port of build_parlay_page_2.py — multi-leg parlay builder.
// Quirks preserved: the Week dropdown exists but does not filter the bar/%
// (old callback ignored it); the player list ignores season_type.
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

interface Leg {
  season: string;
  seasonType: string;
  week: string; // display only (old page quirk: unused in calc)
  team: string;
  side: "offense" | "defense";
  stat: string;
  player: string;
  line: string;
}

const seasonCache = new Map<number, Promise<Row[]>>();
const loadSeason = (s: number) => {
  if (!seasonCache.has(s)) seasonCache.set(s, getPlayerWeek(s));
  return seasonCache.get(s)!;
};

function LegCard({
  leg,
  seasons,
  onChange,
  onAdd,
  onRemove,
  removable,
  onPct,
}: {
  leg: Leg;
  seasons: number[];
  onChange: (l: Leg) => void;
  onAdd: () => void;
  onRemove: () => void;
  removable: boolean;
  onPct: (pct: number | null) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (leg.season) loadSeason(Number(leg.season)).then(setRows);
  }, [leg.season]);

  const seasonTypes = useMemo(() => [...new Set(rows.map((r) => String(r.season_type)))].sort(), [rows]);
  const typed = useMemo(() => rows.filter((r) => !leg.seasonType || String(r.season_type) === leg.seasonType), [rows, leg.seasonType]);
  const teams = useMemo(() => [...new Set(typed.map((r) => String(r.team)))].sort(), [typed]);
  const team = teams.includes(leg.team) ? leg.team : teams[0] ?? "";
  const weeks = useMemo(
    () => [...new Set(typed.filter((r) => String(r.team) === team).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [typed, team],
  );
  const numericCols = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((c) => !EXCLUDE.has(c) && rows.some((r) => typeof r[c] === "number"));
  }, [rows]);
  const sideCols = useMemo(() => {
    const kws = leg.side === "offense" ? OFFENSE_KW : DEFENSE_KW;
    const f = numericCols.filter((c) => kws.some((k) => c.toLowerCase().includes(k)));
    return f.length ? f : numericCols;
  }, [numericCols, leg.side]);
  const stat = sideCols.includes(leg.stat) ? leg.stat : sideCols.includes("passing_yards") ? "passing_yards" : sideCols[0] ?? "";

  // players with positive totals (season+team only, like the old page)
  const players = useMemo(() => {
    const seasonRows = rows.filter((r) => String(r.team) === team);
    const totals = new Map<string, number>();
    for (const r of seasonRows) {
      const p = String(r.player_display_name ?? r.player_name ?? r.player_id);
      totals.set(p, (totals.get(p) ?? 0) + (r[stat] == null ? 0 : Number(r[stat]) || 0));
    }
    return [...totals.entries()]
      .filter(([, t]) => t > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([p]) => p);
  }, [rows, team, stat]);
  const player = players.includes(leg.player) ? leg.player : players[0] ?? "";

  const line = leg.line === "" ? null : Number(leg.line);

  const calc = useMemo(() => {
    if (!player || !stat) return null;
    const q = typed.filter((r) => String(r.team) === team && String(r.player_display_name ?? r.player_name ?? r.player_id) === player);
    const byWeek = new Map<number, number>();
    const oppByWeek = new Map<number, string>();
    for (const r of q) {
      const w = Number(r.week);
      byWeek.set(w, (byWeek.get(w) ?? 0) + (r[stat] == null ? 0 : Number(r[stat]) || 0));
      if (r.game_id != null) oppByWeek.set(w, opponentLabel(String(r.game_id), team));
    }
    const teamTotals = new Map<number, number>();
    for (const r of typed.filter((r) => String(r.team) === team)) {
      const w = Number(r.week);
      teamTotals.set(w, (teamTotals.get(w) ?? 0) + (r[stat] == null ? 0 : Number(r[stat]) || 0));
    }
    const wks = [...byWeek.keys()].sort((a, b) => a - b);
    const vals = wks.map((w) => byWeek.get(w)!);
    const total = vals.length;
    const made = line != null ? vals.filter((v) => v >= line).length : 0;
    const pct = total ? Math.round((made / total) * 100) : 0;
    const headshot = q.find((r) => r.headshot_url != null)?.headshot_url;
    return { wks, vals, oppByWeek, teamTotals, pct, headshot: headshot ? String(headshot) : null };
  }, [typed, team, player, stat, line]);

  useEffect(() => {
    onPct(calc && line != null ? calc.pct : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc?.pct, line]);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!calc) return null;
    return {
      grid: { left: 4, right: 8, top: 15, bottom: 2, containLabel: true },
      xAxis: { type: "category", data: calc.wks.map((w) => `W${w}`), axisLabel: { fontSize: 9 } },
      yAxis: { type: "value", show: false },
      tooltip: {
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const w = calc.wks[q.dataIndex];
          const v = calc.vals[q.dataIndex];
          const t = calc.teamTotals.get(w);
          return `Week W${w} | Opp: ${calc.oppByWeek.get(w) ?? ""}<br/>${stat}: ${v}<br/>${t ? Math.round((v / t) * 100) : 0}% of ${stat}`;
        },
      },
      series: [
        {
          type: "bar",
          data: calc.vals.map((v) => ({ value: v, itemStyle: { color: line != null && v >= line ? "green" : "red" } })),
          label: { show: true, position: "top", fontSize: 8, formatter: (p: { value?: unknown }) => `${Math.round(Number(p.value))}` },
          ...(line != null
            ? { markLine: { symbol: "none", lineStyle: { type: "dashed", color: "green", width: 1 }, label: { show: false }, data: [{ yAxis: line }] } }
            : {}),
        },
      ],
    } as EChartsOption;
  }, [calc, stat, line]);
  const barRef = useECharts(barOption);

  const set = (patch: Partial<Leg>) => onChange({ ...leg, ...patch, team, stat, player, ...patch });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="min-w-[340px] flex-1">
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Season" value={leg.season} onChange={(v) => set({ season: v })} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Season Type" value={leg.seasonType} onChange={(v) => set({ seasonType: v })} options={(seasonTypes.length ? seasonTypes : ["REG"]).map((t) => ({ value: t, label: t }))} />
          <Select label="Week" value={leg.week} onChange={(v) => set({ week: v })} options={weeks.map((w) => ({ value: String(w), label: `W${w}` }))} />
          <Select label="Team" value={team} onChange={(v) => set({ team: v })} options={teams.map((t) => ({ value: t, label: t }))} />
          <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Stat Type
            <div className="flex gap-1">
              {(["offense", "defense"] as const).map((sd) => (
                <button key={sd} onClick={() => set({ side: sd })} className={`rounded-full px-2.5 py-1 text-xs capitalize ${leg.side === sd ? "bg-[#002f6c] text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
                  {sd}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select label="Stat" value={stat} onChange={(v) => set({ stat: v })} options={sideCols.map((c) => ({ value: c, label: c }))} />
          <Select label="Player" value={player} onChange={(v) => set({ player: v })} options={players.map((p) => ({ value: p, label: p }))} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Line
            <input type="number" value={leg.line} onChange={(e) => set({ line: e.target.value })} placeholder="Set line" className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      {calc?.headshot && <img src={calc.headshot} alt={player} className="h-16 w-16 rounded-full object-cover" />}
      <div ref={barRef} className="h-40 w-[360px]" />

      <div className="flex flex-col items-center gap-2">
        <div
          className="grid h-20 w-20 place-items-center rounded-full"
          style={{ background: `conic-gradient(#16a34a ${calc?.pct ?? 0}%, #e5e7eb 0)` }}
          title={`${calc?.pct ?? 0}%`}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-xl font-extrabold">{calc ? `${calc.pct}%` : "—"}</div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button onClick={onAdd} className="h-8 w-8 rounded-full border border-slate-300 font-bold hover:bg-slate-100">+</button>
          {removable && (
            <button onClick={onRemove} className="h-8 w-8 rounded-full border border-slate-300 font-bold hover:bg-slate-100">−</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ParlayBuilder() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [pcts, setPcts] = useState<Record<number, number | null>>({});

  useEffect(() => {
    getMeta().then((m) => {
      const ss = [...m.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setLegs([{ season: String(ss[0]), seasonType: "REG", week: "", team: "", side: "offense", stat: "passing_yards", player: "", line: "" }]);
    });
  }, []);

  const probs = legs.map((_, i) => pcts[i]).filter((p): p is number => p != null).map((p) => p / 100);
  const expectedProb = probs.length ? probs.reduce((a, b) => a * b, 1) : null;
  const expectedOdds = expectedProb != null && expectedProb > 0 ? 1 / expectedProb : null;

  if (!legs.length) return <Loading label="Loading player data…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#002f6c]">Parlay Builder</h1>
        <div className="flex gap-3">
          {[
            ["Expected Probability", expectedProb == null ? "—" : `${(expectedProb * 100).toFixed(2)}%`],
            ["Expected Odds", expectedOdds == null ? "—" : expectedOdds.toFixed(2)],
          ].map(([l, v]) => (
            <div key={l} className="min-w-36 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-center">
              <div className="text-sm font-bold">{l}</div>
              <div className="mt-0.5 text-2xl font-bold">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {legs.map((leg, i) => (
        <LegCard
          key={i}
          leg={leg}
          seasons={seasons}
          onChange={(l) => setLegs((cur) => cur.map((x, j) => (j === i ? l : x)))}
          onAdd={() => setLegs((cur) => [...cur.slice(0, i + 1), { ...leg }, ...cur.slice(i + 1)])}
          onRemove={() => {
            setLegs((cur) => cur.filter((_, j) => j !== i));
            setPcts({});
          }}
          removable={legs.length > 1}
          onPct={(p) => setPcts((cur) => ({ ...cur, [i]: p }))}
        />
      ))}
    </div>
  );
}
