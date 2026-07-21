// Port of team_comparison_page_3.py — 3-column head-to-head comparison with
// rank bars, expandable substats, grades boxes and side trend/matchup charts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getTeamWeek, getTeamWeekRanks, getGrades, getSchedule, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { opponentLabel } from "../grading-model/shared";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";

const STAT_LIST = ["points", "total_yards", "total_tds", "passing_yards", "rushing_yards", "turnovers"];
const STAT_HIERARCHY: Record<string, string[]> = {
  points: ["passing_tds", "rushing_tds"],
  passing_yards: ["completion_pct", "completions", "passing_air_yards", "passing_yards_after_catch", "passing_epa", "yds_per_pass"],
  rushing_yards: ["carries", "yds_per_rush", "rushing_epa", "rushing_first_downs"],
  turnovers: ["interceptions", "rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost", "int_per_attempt"],
};
for (const [k, v] of Object.entries({ ...STAT_HIERARCHY })) {
  STAT_HIERARCHY[`${k}_allowed`] = v.map((s) => `${s}_allowed`);
}

const title = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Grade metrics (grades.json columns) are chartable like stats via the grade boxes.
const GRADE_METRICS = ["Overall Grade", "Offensive Grade", "Defensive Grade"] as const;
const isGradeStat = (s: string) => (GRADE_METRICS as readonly string[]).includes(s);

function fmtPrev(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

interface StatSummary {
  total: number;
  average: number | null;
  prev: number | null;
  prevOpp: string;
  hasData: boolean;
}

export default function TeamComparison() {
  const [searchParams] = useSearchParams();
  const { season, week, setSeason, setWeek } = useSeasonWeek();
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [team1, setTeam1] = useState(searchParams.get("team1") ?? "SF");
  const [team2, setTeam2] = useState(searchParams.get("team2") ?? "CIN");
  const [selectedStat, setSelectedStat] = useState("points_margin");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [schedule, setSchedule] = useState<Row[]>([]);

  usePageTitle(`Team Comparison: ${team1} vs ${team2}`);

  // Deep-linked season/week (e.g. from Game Picks) wins over the shared
  // season/week context, applied once per mount.
  const deepLinkApplied = useRef(false);
  // Skip randomization entirely when arriving via a deep link (e.g. from Game
  // Picks) that already specifies the teams.
  const randomizedRef = useRef(!!searchParams.get("team1"));

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getGrades()]).then(([m, g]) => {
      setMeta(m);
      setGrades(g);
      const ss = [...new Set(g.map((r) => Number(r.Season)))].sort((a, b) => b - a);
      setSeasons(ss);
    });
    getSchedule().then(setSchedule);
  }, []);

  useEffect(() => {
    if (deepLinkApplied.current) return;
    const s = searchParams.get("season");
    const w = searchParams.get("week");
    if (s && w) {
      deepLinkApplied.current = true;
      setSeason(s);
      setWeek(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Default to a random matchup (away = team1, home = team2) from the shared
  // season/week's games, re-randomized every time the page is opened fresh
  // (not persisted, and skipped entirely when deep-linked with explicit teams).
  useEffect(() => {
    if (randomizedRef.current || !schedule.length || !season || !week) return;
    const games = schedule.filter((r) => String(r.season) === season && String(r.week) === week);
    if (!games.length) return;
    randomizedRef.current = true;
    const g = games[Math.floor(Math.random() * games.length)];
    setTeam1(String(g.away_team));
    setTeam2(String(g.home_team));
  }, [schedule, season, week]);

  useEffect(() => {
    if (!season) return;
    Promise.all([getTeamWeek(Number(season)), getTeamWeekRanks(Number(season))]).then(([tw, rk]) => {
      setTeamWeek(tw.filter((r) => r.game_type === "REG" || r.game_type == null));
      setRanks(rk);
    });
  }, [season]);

  const weeks = useMemo(() => [...new Set(teamWeek.map((r) => Number(r.week)))].sort((a, b) => a - b), [teamWeek]);

  // This page's team_week data can lag schedule.json by a week; fall back to
  // the latest week this season's data actually has rather than showing an
  // invalid selection (without overwriting the shared season/week context).
  useEffect(() => {
    if (weeks.length && !weeks.includes(Number(week))) setWeek(String(weeks[weeks.length - 1]));
  }, [weeks, week, setWeek]);
  const teams = useMemo(() => [...new Set(teamWeek.map((r) => String(r.team)))].sort(), [teamWeek]);
  const wk = Number(week);

  const teamRows = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of teamWeek) {
      const t = String(r.team);
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(r);
    }
    for (const rows of m.values()) rows.sort((a, b) => Number(a.week) - Number(b.week));
    return m;
  }, [teamWeek]);

  // Selected week's game_id for a team (for cross-links) — audit's "no direct
  // link to the corresponding Matchup Preview / Scorecards" gap.
  const gameIdOf = (team: string): string | null => {
    const row = (teamRows.get(team) ?? []).find((r) => Number(r.week) === wk);
    return row?.game_id != null ? String(row.game_id) : null;
  };

  const rankOf = (team: string, col: string): number | null => {
    const row = ranks.find((r) => String(r.team) === team && Number(r.week) === wk);
    const v = row?.[`${col}_rank`];
    return v == null ? null : Number(v);
  };

  const summaryOf = (team: string, stat: string): StatSummary => {
    const rows = (teamRows.get(team) ?? []).filter((r) => Number(r.week) <= wk);
    const vals = rows.map((r) => (r[stat] == null ? null : Number(r[stat])));
    const clean = vals.filter((v): v is number => v != null && Number.isFinite(v));
    const exact = rows.find((r) => Number(r.week) === wk);
    return {
      total: clean.reduce((a, b) => a + b, 0),
      average: clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null,
      prev: exact && exact[stat] != null ? Number(exact[stat]) : null,
      prevOpp: exact ? opponentLabel(String(exact.game_id ?? ""), team) : "",
      hasData: clean.length > 0,
    };
  };

  const recordOf = (team: string): string => {
    const rows = (teamRows.get(team) ?? []).filter((r) => Number(r.week) <= wk && r.win != null);
    const wins = rows.reduce((s, r) => s + Number(r.win), 0);
    return `${Math.round(wins)} - ${rows.length - Math.round(wins)}`;
  };

  const gradesOf = (team: string): [string, string, string] => {
    const rows = grades.filter((r) => String(r.Season) === season && String(r.Team) === team && Number(r.Week) <= wk);
    if (!rows.length) return ["--", "--", "--"];
    const m = (c: string) => String(Math.round(rows.reduce((s, r) => s + Number(r[c] ?? 0), 0) / rows.length));
    return [m("Overall Grade"), m("Offensive Grade"), m("Defensive Grade")];
  };

  // League rank of each team's season-to-date average grade (audit §4: grade
  // numbers had no scale context). Same averaging as gradesOf().
  const gradeRanks = useMemo(() => {
    const metrics = ["Overall Grade", "Offensive Grade", "Defensive Grade"] as const;
    const rows = grades.filter((r) => String(r.Season) === season && Number(r.Week) <= wk);
    const byTeam = new Map<string, Row[]>();
    for (const r of rows) {
      const t = String(r.Team);
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(r);
    }
    const out: Record<string, Map<string, number>> = {};
    for (const m of metrics) {
      const avgs = [...byTeam.entries()]
        .map(([t, tr]) => ({ t, v: tr.reduce((s, r) => s + Number(r[m] ?? 0), 0) / tr.length }))
        .sort((a, b) => b.v - a.v);
      out[m] = new Map(avgs.map((a, i) => [a.t, i + 1]));
    }
    return { ranks: out, nTeams: byTeam.size };
  }, [grades, season, wk]);

  const color = (t: string) => meta?.get(t)?.color ?? "#888";

  // ---------- center stat rows ----------
  function RankBar({ stat }: { stat: string }) {
    const r1 = rankOf(team1, stat);
    const r2 = rankOf(team2, stat);
    let w1 = 0.5;
    if (r1 != null && r2 != null && r1 + r2 > 0) {
      w1 = 0.5 + (r2 / (r1 + r2) - 0.5) * 0.5; // squash 0.5, like the old page
    }
    return (
      <div className="flex h-6 w-full overflow-hidden rounded-full ring-1 ring-inset ring-black/5" title="League rank — bigger side of the bar = better rank">
        <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${w1 * 100}%`, background: color(team1) }} title={`${team1} league rank: ${r1 == null ? "--" : `#${Math.round(r1)}`}`}>
          {r1 == null ? "--" : `#${Math.round(r1)}`}
        </div>
        <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${(1 - w1) * 100}%`, background: color(team2) }} title={`${team2} league rank: ${r2 == null ? "--" : `#${Math.round(r2)}`}`}>
          {r2 == null ? "--" : `#${Math.round(r2)}`}
        </div>
      </div>
    );
  }

  function StatCells({ s, order, team, sub }: { s: StatSummary; order: ("prev" | "total" | "avg")[]; team: string; sub?: boolean }) {
    // A real zero (data present, value 0) and missing data ("--") look
    // identical as plain "0" otherwise — user-reported confusion on
    // low-count stats like Interceptions Allowed. Zero gets its own muted,
    // dashed treatment + an explicit tooltip so it doesn't read as a glitch.
    const pill = (key: string, label: string, value: string, raw: number | null, hint?: string) => {
      const isZero = raw != null && raw === 0;
      return (
        <div
          key={key}
          className={`rounded-xl border text-center ${sub ? "w-14 px-1 py-0.5" : "w-[72px] px-1.5 py-1"} ${
            isZero ? "border-dashed border-slate-200 bg-slate-50/40" : "border-slate-200 bg-slate-50/80"
          }`}
          title={isZero ? `${hint ? `${hint} — ` : ""}confirmed zero (data present, not missing)` : hint}
          style={{ boxShadow: `inset 0 2px 0 0 ${color(team)}33` }}
        >
          <div className={`font-semibold uppercase tracking-wider text-slate-400 ${sub ? "text-[8px]" : "text-[9px]"}`}>{label}</div>
          <div className={`font-semibold tabular-nums ${sub ? "text-[11px]" : "text-sm"} ${isZero ? "italic text-slate-400" : "text-slate-800"}`}>
            {value || "--"}
          </div>
        </div>
      );
    };
    const cell: Record<string, JSX.Element> = {
      prev: pill("prev", "Last", fmtPrev(s.prev), s.prev, s.prevOpp ? `Week ${week} vs ${s.prevOpp}` : undefined),
      avg: pill("avg", "Avg", s.average == null ? "" : (Math.round(s.average * 10) / 10).toFixed(1), s.average, "Per-game average this season"),
      total: pill("total", "Total", Math.trunc(s.total).toLocaleString(), s.total, "Season total"),
    };
    return <div className="flex gap-1.5">{order.map((k) => cell[k])}</div>;
  }

  function StatRow({ stat, sub = false }: { stat: string; sub?: boolean }) {
    const s1 = summaryOf(team1, stat);
    const s2 = summaryOf(team2, stat);
    const subs = STAT_HIERARCHY[stat];
    // Audit §4: stats that are null in the pipeline (turnovers family) used to
    // render dead "--"/0 pills for every team — show an explicit note instead.
    if (!s1.hasData && !s2.hasData) {
      return (
        <div className={`flex items-center justify-center gap-2 py-1.5 ${sub ? "pl-4" : ""}`}>
          <span className={`font-semibold text-slate-400 ${sub ? "text-[0.7rem]" : "text-sm"}`}>{title(stat)}</span>
          <span
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400"
            title="This stat is not yet provided by the data pipeline (known issue) — values will appear once the source is fixed."
          >
            Data unavailable
          </span>
        </div>
      );
    }
    return (
      <div className={`flex items-center justify-center gap-4 ${sub ? "py-1 pl-4 opacity-90" : "py-1.5 text-sm"}`}>
        <div className="flex flex-1 justify-end">
          {StatCells({ s: s1, order: ["prev", "total", "avg"], team: team1, sub })}
        </div>
        <div className="w-44 text-center">
          <div className="mb-1 flex items-center justify-center gap-1">
            <button
              className={`cursor-pointer select-none font-semibold text-slate-700 transition-colors hover:text-[#002f6c] ${sub ? "text-[0.7rem]" : ""} ${selectedStat === stat ? "text-[#002f6c] underline decoration-2 underline-offset-4" : ""}`}
              onClick={() => setSelectedStat(stat)}
              title="Click to chart this stat"
            >
              {title(stat)}
            </button>
            {subs && !sub && (
              <button
                className="grid h-5 w-5 place-items-center rounded-full border border-slate-200 bg-white text-xs leading-none text-slate-500 hover:border-[#002f6c] hover:text-[#002f6c]"
                onClick={() => setExpanded((e) => ({ ...e, [stat]: !e[stat] }))}
                title={expanded[stat] ? "Hide breakdown" : "Show breakdown"}
              >
                {expanded[stat] ? "–" : "+"}
              </button>
            )}
          </div>
          {RankBar({ stat })}
        </div>
        <div className="flex flex-1 justify-start">
          {StatCells({ s: s2, order: ["avg", "total", "prev"], team: team2, sub })}
        </div>
      </div>
    );
  }

  function Section({ name, stats, bg }: { name: string; stats: string[]; bg?: string }) {
    return (
      <div className="relative mb-6 rounded-2xl border border-slate-200 bg-white p-4 pt-5 shadow-sm" style={{ background: bg }}>
        <div className="absolute -top-2.5 left-4 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#002f6c]">{name}</div>
        <div className="divide-y divide-slate-100">
          {stats.map((st) => (
            <div key={st}>
              {StatRow({ stat: st })}
              {expanded[st] && (STAT_HIERARCHY[st] ?? []).map((sub) => <div key={sub}>{StatRow({ stat: sub, sub: true })}</div>)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------- side charts ----------
  // Weekly series of the selected stat for one team. Grade metrics come from
  // grades.json (win/opponent joined from team_week); everything else from team_week.
  const seriesOf = (team: string): { week: number; value: number; opp: string; win: number | null }[] => {
    const tw = teamRows.get(team) ?? [];
    if (isGradeStat(selectedStat)) {
      const byWeek = new Map(tw.map((r) => [Number(r.week), r]));
      return grades
        .filter((r) => String(r.Season) === season && String(r.Team) === team && Number(r.Week) <= wk && r[selectedStat] != null)
        .map((r) => {
          const w = Number(r.Week);
          const twr = byWeek.get(w);
          return {
            week: w,
            value: Number(r[selectedStat]),
            opp: twr ? opponentLabel(String(twr.game_id ?? ""), team) : "",
            win: twr?.win == null ? null : Number(twr.win),
          };
        })
        .sort((a, b) => a.week - b.week);
    }
    return tw
      .filter((r) => Number(r.week) <= wk && r[selectedStat] != null)
      .map((r) => ({
        week: Number(r.week),
        value: Number(r[selectedStat]),
        opp: opponentLabel(String(r.game_id ?? ""), team),
        win: r.win == null ? null : Number(r.win),
      }));
  };

  // Shared y-range across both teams' trend charts (audit §4: independent
  // scales made visual comparison of margins misleading).
  const trendYRange = useMemo(() => {
    const vals = [...seriesOf(team1), ...seriesOf(team2)].map((p) => p.value);
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo || 1) * 0.08;
    return { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRows, grades, season, team1, team2, selectedStat, wk]);

  const trendOption = (team: string): EChartsOption | null => {
    const pts = seriesOf(team);
    if (!pts.length) return null;
    const xs = pts.map((p) => String(p.week));
    const ys = pts.map((p) => p.value);
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    const opps = pts.map((p) => p.opp);
    return {
      grid: { left: 5, right: 10, top: 10, bottom: 5, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number; value: number | [unknown, number] };
          return `Week ${xs[q.dataIndex]} | ${opps[q.dataIndex]}<br/>${title(selectedStat)}: ${ys[q.dataIndex].toFixed(1)}`;
        },
      },
      xAxis: { type: "category", data: xs, name: "Week", nameLocation: "middle", nameGap: 22, axisLabel: { fontSize: 9 } },
      yAxis: { type: "value", axisLabel: { fontSize: 9 }, min: trendYRange?.min, max: trendYRange?.max },
      series: [
        {
          type: "line",
          data: ys.map((v, i) => ({
            value: +v.toFixed(2),
            itemStyle: { color: pts[i].win === 1 ? "green" : "red" },
          })),
          lineStyle: { color: "#9E9E9E", width: 1 },
          symbolSize: 7,
        },
        { type: "line", data: xs.map(() => +avg.toFixed(2)), symbol: "none", lineStyle: { type: "dashed", width: 1, color: "#9E9E9E" }, tooltip: { show: false } },
      ],
    } as EChartsOption;
  };

  const matchupOptions = (team: string, opp: string): { main: EChartsOption; rank: EChartsOption } | null => {
    if (!teamWeek.length) return null;
    const grade = isGradeStat(selectedStat);
    const isAllowed = !grade && selectedStat.endsWith("_allowed");
    const base = isAllowed ? selectedStat.slice(0, -8) : selectedStat;
    const cols = new Set(Object.keys(teamWeek[0] ?? {}));
    const teamCol = selectedStat;
    // grade metrics compare team-vs-team on the same metric; stats compare vs the opponent's allowed side
    const oppCol = grade ? selectedStat : isAllowed ? base : cols.has(`${base}_allowed`) ? `${base}_allowed` : base;

    const avgPrev = (t: string, col: string): [number | null, number | null] => {
      const rows = grade
        ? grades
            .filter((r) => String(r.Season) === season && String(r.Team) === t && Number(r.Week) <= wk && r[col] != null)
            .sort((a, b) => Number(a.Week) - Number(b.Week))
        : (teamRows.get(t) ?? []).filter((r) => Number(r.week) <= wk && r[col] != null);
      if (!rows.length) return [null, null];
      const vals = rows.map((r) => Number(r[col]));
      return [vals.reduce((a, b) => a + b, 0) / vals.length, vals[vals.length - 1]];
    };
    const toInt = (v: number | null) => (v == null ? null : Math.round(v));
    const [tAvg, tPrev] = avgPrev(team, teamCol);
    const [oAvg, oPrev] = avgPrev(opp, oppCol);
    const tLabel = isAllowed ? `${team} (Allowed)` : team;
    const oLabel = grade ? opp : isAllowed ? opp : oppCol.endsWith("_allowed") ? `${opp} (Allowed)` : opp;
    const tRank = grade ? (gradeRanks.ranks[selectedStat]?.get(team) ?? null) : rankOf(team, teamCol);
    const oRank = grade ? (gradeRanks.ranks[selectedStat]?.get(opp) ?? null) : rankOf(opp, oppCol);

    const main: EChartsOption = {
      grid: { left: 5, right: 5, top: 25, bottom: 20, containLabel: true },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 10 } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: ["Avg", "Prev"] },
      yAxis: { type: "value", axisLabel: { fontSize: 9 } },
      series: [
        { name: tLabel, type: "bar", data: [toInt(tAvg), toInt(tPrev)], itemStyle: { color: color(team) }, label: { show: true, position: "top", fontSize: 10 } },
        { name: oLabel, type: "bar", data: [toInt(oAvg), toInt(oPrev)], itemStyle: { color: color(opp), opacity: 0.75 }, label: { show: true, position: "top", fontSize: 10 } },
      ],
    } as EChartsOption;
    const rank: EChartsOption = {
      grid: { left: 5, right: 5, top: 25, bottom: 5, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: [tLabel, oLabel], axisLabel: { fontSize: 8, interval: 0 } },
      yAxis: { type: "value", show: false, max: Math.max(tRank ?? 0, oRank ?? 0) + 2 },
      series: [
        {
          type: "bar",
          data: [
            { value: tRank == null ? null : Math.round(tRank), itemStyle: { color: color(team) } },
            { value: oRank == null ? null : Math.round(oRank), itemStyle: { color: color(opp) } },
          ],
          label: { show: true, position: "top", fontSize: 10 },
        },
      ],
    } as EChartsOption;
    return { main, rank };
  };

  const trend1 = useMemo(() => trendOption(team1), [teamRows, grades, season, team1, selectedStat, wk, trendYRange]);
  const trend2 = useMemo(() => trendOption(team2), [teamRows, grades, season, team2, selectedStat, wk, trendYRange]);
  const m1 = useMemo(() => matchupOptions(team1, team2), [teamRows, ranks, grades, gradeRanks, season, team1, team2, selectedStat, wk]);
  const m2 = useMemo(() => matchupOptions(team2, team1), [teamRows, ranks, grades, gradeRanks, season, team1, team2, selectedStat, wk]);

  const trend1Ref = useECharts(trend1);
  const trend2Ref = useECharts(trend2);
  const m1MainRef = useECharts(m1?.main ?? null);
  const m1RankRef = useECharts(m1?.rank ?? null);
  const m2MainRef = useECharts(m2?.main ?? null);
  const m2RankRef = useECharts(m2?.rank ?? null);

  if (!meta) return <Loading />;

  function GradesBox({ team }: { team: string }) {
    const [ovr, off, def] = gradesOf(team);
    const metricOf = { Ovr: "Overall Grade", Off: "Offensive Grade", Def: "Defensive Grade" } as const;
    return (
      <div className="relative mb-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-xs font-semibold">Grades</div>
        <div className="flex gap-2">
          {([["Ovr", ovr], ["Off", off], ["Def", def]] as const).map(([l, v]) => {
            const metric = metricOf[l];
            const rank = gradeRanks.ranks[metric]?.get(team);
            const active = selectedStat === metric;
            return (
              <button
                key={l}
                onClick={() => setSelectedStat(metric)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-center transition-colors ${active ? "border-[#002f6c] bg-[#002f6c]/5" : "border-slate-200 hover:border-[#002f6c]/50"}`}
                title={`Click to chart ${metric} by week${rank ? ` — league rank #${rank} of ${gradeRanks.nTeams} (season-to-date average)` : ""}`}
              >
                <div className={`text-[0.7rem] ${active ? "font-semibold text-[#002f6c]" : "text-slate-500"}`}>{l}</div>
                <div className="text-lg font-bold">{v}</div>
                {rank != null && <div className="text-[10px] font-semibold text-slate-400">#{rank}</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function TeamColumn({ team, setTeam, trendRef, mainRef, rankRef, label }: {
    team: string;
    setTeam: (t: string) => void;
    trendRef: React.Ref<HTMLDivElement>;
    mainRef: React.Ref<HTMLDivElement>;
    rankRef: React.Ref<HTMLDivElement>;
    label: string;
  }) {
    return (
      // Sticky on desktop: the side charts stay in view while the (taller)
      // center stat column scrolls. top = navbar + sticky filter bar. No
      // "Team N" heading — vertical budget goes to keeping both charts visible.
      <div className="w-full lg:sticky lg:top-[128px] lg:w-1/4 lg:self-start" aria-label={label}>
        <Select label="" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t, label: meta!.get(t)?.name ?? t }))} />
        <div className="mt-1.5 flex gap-1.5 text-[11px]">
          {gameIdOf(team) && (
            <Link
              to={`/game_analysis/matchup_previews?tab=matchup&season=${season}&week=${week}&game=${gameIdOf(team)}`}
              className="flex-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-center font-medium text-[#002f6c] shadow-sm transition-colors hover:border-[#002f6c]/50"
              title={`Open this week's Matchup Preview for ${team}`}
            >
              Matchup preview →
            </Link>
          )}
          <Link
            to={`/game_analysis/scorecards_teams?season=${season}&team=${team}`}
            className="flex-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-center font-medium text-[#002f6c] shadow-sm transition-colors hover:border-[#002f6c]/50"
            title={`Open ${team}'s season scorecard`}
          >
            Scorecard →
          </Link>
        </div>
        <div className="mt-2">{GradesBox({ team })}</div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">{title(selectedStat)} by week</div>
          <div ref={trendRef} className="h-40 [@media(max-height:800px)]:h-32" />
        </div>
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">
            {isGradeStat(selectedStat)
              ? `${selectedStat} vs opponent — Wk${wk}`
              : `${title(selectedStat.endsWith("_allowed") ? `${selectedStat.slice(0, -8)} allowed vs opp off` : `${selectedStat} vs opp allowed`)} — Wk${wk}`}
          </div>
          <div className="flex gap-2">
            <div ref={mainRef} className="h-56 flex-[3] [@media(max-height:800px)]:h-40" />
            <div ref={rankRef} className="h-56 flex-1 [@media(max-height:800px)]:h-40" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-mt-3 space-y-3">
      {/* Sticky under the navbar (~53px) so season/week stay reachable while
          scrolling the long stat column. Kept tight so the sticky side
          columns fit fully in the viewport. */}
      <div className="sticky top-[53px] z-30 -mx-4 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 bg-slate-50/90 px-4 pb-2 pt-1 backdrop-blur">
        <h1 title="Want the full detail behind one of these teams? See Team Scorecard." className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Team Comparison</h1>
        <div className="flex gap-4">
          <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {TeamColumn({ team: team1, setTeam: setTeam1, trendRef: trend1Ref, mainRef: m1MainRef, rankRef: m1RankRef, label: "Team 1" })}

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-center gap-10">
            {[team1, team2].map((t, i) => (
              <div key={t} className="flex items-center gap-10">
                {i === 1 && <div className="text-3xl font-light text-slate-400">VS</div>}
                <div className="text-center">
                  {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="mx-auto h-20" />}
                  <div className="mt-1 font-bold">{recordOf(t)}</div>
                </div>
              </div>
            ))}
          </div>
          <hr className="mb-4" />
          <div className="overflow-x-auto">
          <div className="min-w-[560px]">
          <div className="mb-3 flex items-center justify-center gap-4 text-xs text-slate-500">
            <div className="flex flex-1 items-center justify-end gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color(team1) }} />
              <span className="font-semibold">{team1}</span>
            </div>
            <div className="w-44 text-center text-[10px] uppercase tracking-wider text-slate-400">Last · Total · Avg — bar = league rank</div>
            <div className="flex flex-1 items-center justify-start gap-1.5">
              <span className="font-semibold">{team2}</span>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color(team2) }} />
            </div>
          </div>
          {Section({ name: "Overall", stats: ["points_margin", "turnover_margin", "epa_diff"] })}
          {Section({ name: "Offensive stats", stats: STAT_LIST, bg: "rgba(255,0,0,0.025)" })}
          {Section({ name: "Defensive stats", stats: STAT_LIST.map((s) => `${s}_allowed`), bg: "rgba(0,123,255,0.025)" })}
          </div>
          </div>
        </div>

        {TeamColumn({ team: team2, setTeam: setTeam2, trendRef: trend2Ref, mainRef: m2MainRef, rankRef: m2RankRef, label: "Team 2" })}
      </div>
    </div>
  );
}
