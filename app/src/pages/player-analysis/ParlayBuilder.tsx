// Port of build_parlay_page_2.py — multi-leg parlay builder.
// Quirks preserved: the player list ignores season_type. The old page's inert
// Week dropdown (displayed but never used in the calc) has been removed
// rather than kept as a non-functional control.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { getPlayerWeek, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { opponentLabel } from "../grading-model/shared";
import { Loading } from "../../components/Loading";
import { buildStatGroups, statLabel, americanOdds, headshotCrop, randomItem, randomPassRushRecStat, HIT_COLOR, MISS_COLOR, NEUTRAL_COLOR } from "./statPicker";

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
  const [teamMeta, setTeamMeta] = useState<Map<string, TeamMeta> | null>(null);
  useEffect(() => {
    if (leg.season) loadSeason(Number(leg.season)).then(setRows);
  }, [leg.season]);
  useEffect(() => {
    getTeamMetaMap().then(setTeamMeta);
  }, []);

  const seasonTypes = useMemo(() => [...new Set(rows.map((r) => String(r.season_type)))].sort(), [rows]);
  const typed = useMemo(() => rows.filter((r) => !leg.seasonType || String(r.season_type) === leg.seasonType), [rows, leg.seasonType]);
  const teams = useMemo(() => [...new Set(typed.map((r) => String(r.team)))].sort(), [typed]);
  const team = teams.includes(leg.team) ? leg.team : teams[0] ?? "";

  // Random starting team for this leg (unless already set), picked once its
  // teams list is known — applies both to the initial leg and any new leg
  // added via "+" (which starts with team: "").
  const teamRandomizedRef = useRef(false);
  useEffect(() => {
    if (teamRandomizedRef.current || leg.team || !teams.length) return;
    teamRandomizedRef.current = true;
    const t = randomItem(teams);
    if (t) onChange({ ...leg, team: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  const numericCols = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((c) => !EXCLUDE.has(c) && rows.some((r) => typeof r[c] === "number"));
  }, [rows]);
  const sideCols = useMemo(() => {
    const kws = leg.side === "offense" ? OFFENSE_KW : DEFENSE_KW;
    const f = numericCols.filter((c) => {
      const lc = c.toLowerCase();
      // Keyword matching alone leaks def_* columns into offense ("sacks", "interceptions").
      if (leg.side === "offense" && lc.startsWith("def_")) return false;
      return kws.some((k) => lc.includes(k));
    });
    return f.length ? f : numericCols;
  }, [numericCols, leg.side]);
  const statGroups = useMemo(() => buildStatGroups(sideCols, leg.side), [sideCols, leg.side]);
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
    return { wks, vals, oppByWeek, teamTotals, made, total, pct, headshot: headshot ? String(headshot) : null };
  }, [typed, team, player, stat, line]);

  useEffect(() => {
    onPct(calc && line != null ? calc.pct : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc?.pct, line]);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!calc) return null;
    return {
      grid: { left: 4, right: 8, top: 15, bottom: 2, containLabel: true },
      xAxis: {
        type: "category",
        // Two-line label: week number + opponent (@ = away game).
        data: calc.wks.map((w) => `W${w}\n${calc.oppByWeek.get(w) ?? ""}`),
        axisLabel: { interval: 0, fontSize: 8, lineHeight: 10 },
      },
      yAxis: { type: "value", show: false },
      tooltip: {
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          const w = calc.wks[q.dataIndex];
          const v = calc.vals[q.dataIndex];
          const t = calc.teamTotals.get(w);
          return `Week ${w} vs ${calc.oppByWeek.get(w) ?? "?"}<br/>${statLabel(stat)}: ${v}<br/>${t ? Math.round((v / t) * 100) : 0}% of team ${statLabel(stat)}`;
        },
      },
      series: [
        {
          type: "bar",
          // No line set → neutral navy; with a line → green over / red under.
          data: calc.vals.map((v) => ({ value: v, itemStyle: { color: line == null ? NEUTRAL_COLOR : v >= line ? HIT_COLOR : MISS_COLOR } })),
          label: { show: true, position: "top", fontSize: 8, formatter: (p: { value?: unknown }) => `${Math.round(Number(p.value))}` },
          ...(line != null
            ? { markLine: { symbol: "none", lineStyle: { type: "dashed", color: HIT_COLOR, width: 1 }, label: { show: false }, data: [{ yAxis: line }] } }
            : {}),
        },
      ],
    } as EChartsOption;
  }, [calc, stat, line]);
  const barRef = useECharts(barOption);

  const set = (patch: Partial<Leg>) => onChange({ ...leg, ...patch, team, stat, player, ...patch });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="min-w-[340px] flex-1">
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Season" value={leg.season} onChange={(v) => set({ season: v })} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Season Type" value={leg.seasonType} onChange={(v) => set({ seasonType: v })} options={(seasonTypes.length ? seasonTypes : ["REG"]).map((t) => ({ value: t, label: t }))} />
          <Select label="Team" value={team} onChange={(v) => set({ team: v })} options={teams.map((t) => ({ value: t, label: teamMeta?.get(t)?.name ?? t }))} />
          <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Stat Type
            <div className="flex gap-1">
              {(["offense", "defense"] as const).map((sd) => (
                <button key={sd} onClick={() => set({ side: sd })} className={`rounded-full px-2.5 py-1 text-xs normal-case tracking-normal capitalize ${leg.side === sd ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                  {sd}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select label="Stat" value={stat} onChange={(v) => set({ stat: v })} groups={statGroups} />
          <Select label="Player" value={player} onChange={(v) => set({ player: v })} options={players.map((p) => ({ value: p, label: p }))} />
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#002f6c]">
            Line
            <input
              type="number"
              step="0.5"
              value={leg.line}
              onChange={(e) => set({ line: e.target.value })}
              placeholder="e.g. 250.5"
              className="w-28 rounded-lg border-2 border-[#002f6c]/40 bg-white px-3 py-2 text-sm font-semibold shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
            />
          </label>
        </div>
      </div>

      {calc?.headshot && (
        <img
          src={headshotCrop(calc.headshot)}
          alt={player}
          width={64}
          height={64}
          loading="lazy"
          className="h-16 w-16 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200"
          onError={(e) => {
            // Fall back to the untransformed CDN URL if the crop variant 404s.
            if (calc.headshot && e.currentTarget.src !== calc.headshot) e.currentTarget.src = calc.headshot;
          }}
        />
      )}
      <div ref={barRef} className="h-40 w-[360px]" />

      <div className="flex flex-col items-center gap-2">
        <div
          className="grid h-20 w-20 place-items-center rounded-full"
          style={{ background: line != null && calc ? `conic-gradient(${HIT_COLOR} ${calc.pct}%, #e5e7eb 0)` : "#e5e7eb" }}
          title={line != null && calc ? `Cleared ${line} in ${calc.made} of ${calc.total} games` : "Set a line"}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-xl font-extrabold">
            {line != null && calc ? `${calc.pct}%` : "—"}
          </div>
        </div>
        <div className="text-center text-[10px] font-medium text-slate-500">
          {line != null && calc && calc.total > 0 ? (
            <>
              {calc.made} of {calc.total}
              {americanOdds(calc.made / calc.total) && <span className="text-slate-400"> · fair {americanOdds(calc.made / calc.total)}</span>}
            </>
          ) : (
            "Set a line"
          )}
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

// team/player are left blank — LegCard randomizes the team once its data
// loads, and defaults the player to the stat's top player automatically.
const defaultLeg = (season: number): Leg => ({
  season: String(season), seasonType: "REG", team: "", side: "offense", stat: randomPassRushRecStat(), player: "", line: "",
});

export default function ParlayBuilder() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [pcts, setPcts] = useState<Record<number, number | null>>({});
  // Bumped on every reset so LegCard remounts (fresh key) instead of reusing
  // the same instance — otherwise its one-shot team-randomization ref has
  // already fired and reset would land on the first team alphabetically
  // instead of a new random one.
  const [resetGen, setResetGen] = useState(0);

  useEffect(() => {
    getMeta().then((m) => {
      const ss = [...m.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setLegs([defaultLeg(ss[0])]);
    });
  }, []);

  const resetParlay = () => {
    setLegs([defaultLeg(seasons[0] ?? new Date().getFullYear())]);
    setPcts({});
    setResetGen((g) => g + 1);
  };

  const probs = legs.map((_, i) => pcts[i]).filter((p): p is number => p != null).map((p) => p / 100);
  const expectedProb = probs.length ? probs.reduce((a, b) => a * b, 1) : null;
  const expectedOdds = expectedProb != null && expectedProb > 0 ? 1 / expectedProb : null;

  if (!legs.length) return <Loading label="Loading player data…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Parlay Builder</h1>
        <div className="flex items-center gap-3">
          {[
            ["Expected Probability", expectedProb == null ? "—" : `${(expectedProb * 100).toFixed(2)}%`],
            ["Expected Odds", expectedOdds == null ? "—" : expectedOdds.toFixed(2)],
          ].map(([l, v]) => (
            <div key={l} className="min-w-40 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-center shadow-sm" style={{ borderTop: "3px solid #002f6c" }}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
              <div className="mt-0.5 text-2xl font-bold">{v}</div>
            </div>
          ))}
          <button
            onClick={resetParlay}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:text-slate-900"
            title="Clear all legs and start over"
          >
            Reset
          </button>
        </div>
      </div>

      {legs.map((leg, i) => (
        <LegCard
          key={`${resetGen}-${i}`}
          leg={leg}
          seasons={seasons}
          onChange={(l) => setLegs((cur) => cur.map((x, j) => (j === i ? l : x)))}
          // A new leg starts fresh (random team + random pass/rush/rec stat,
          // blank player) rather than duplicating the leg it was added from.
          onAdd={() =>
            setLegs((cur) => [
              ...cur.slice(0, i + 1),
              { season: leg.season, seasonType: leg.seasonType, team: "", side: "offense", stat: randomPassRushRecStat(), player: "", line: "" },
              ...cur.slice(i + 1),
            ])
          }
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
