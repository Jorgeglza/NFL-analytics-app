// Port of team_comparison_page_3.py — 3-column head-to-head comparison with
// rank bars, expandable substats, grades boxes and side trend/matchup charts.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getTeamWeek, getTeamWeekRanks, getGrades, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { opponentLabel } from "../grading-model/shared";

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
}

export default function TeamComparison() {
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [week, setWeek] = useState("");
  const [team1, setTeam1] = useState("SF");
  const [team2, setTeam2] = useState("CIN");
  const [selectedStat, setSelectedStat] = useState("points_margin");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getGrades()]).then(([m, g]) => {
      setMeta(m);
      setGrades(g);
      const ss = [...new Set(g.map((r) => Number(r.Season)))].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setSeason(String(ss[0]));
    });
  }, []);

  useEffect(() => {
    if (!season) return;
    Promise.all([getTeamWeek(Number(season)), getTeamWeekRanks(Number(season))]).then(([tw, rk]) => {
      const reg = tw.filter((r) => r.game_type === "REG" || r.game_type == null);
      setTeamWeek(reg);
      setRanks(rk);
      const wks = [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b);
      if (wks.length) setWeek(String(wks[wks.length - 1]));
    });
  }, [season]);

  const weeks = useMemo(() => [...new Set(teamWeek.map((r) => Number(r.week)))].sort((a, b) => a - b), [teamWeek]);
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
      <div className="flex h-6 w-full overflow-hidden rounded">
        <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${w1 * 100}%`, background: color(team1) }} title={`${team1} Rank: ${r1 ?? "--"}`}>
          {r1 == null ? "--" : Math.round(r1)}
        </div>
        <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${(1 - w1) * 100}%`, background: color(team2) }} title={`${team2} Rank: ${r2 ?? "--"}`}>
          {r2 == null ? "--" : Math.round(r2)}
        </div>
      </div>
    );
  }

  function StatCells({ s, order }: { s: StatSummary; order: ("prev" | "total" | "avg")[] }) {
    const cell: Record<string, JSX.Element> = {
      prev: (
        <div key="prev" className="w-16 border border-[#a94442] bg-[#f9d6d5] px-1 py-1 text-center" title={s.prevOpp}>
          {fmtPrev(s.prev)}
        </div>
      ),
      avg: (
        <div key="avg" className="w-16 border border-[#31708f] bg-[#dceeff] px-1 py-1 text-center">
          {s.average == null ? "" : (Math.round(s.average * 10) / 10).toFixed(1)}
        </div>
      ),
      total: (
        <div key="total" className="w-[70px] border border-[#3c763d] bg-[#e2f4d6] px-1 py-1 text-center">
          {Math.trunc(s.total).toLocaleString()}
        </div>
      ),
    };
    return <div className="flex gap-1.5">{order.map((k) => cell[k])}</div>;
  }

  function StatRow({ stat, sub = false }: { stat: string; sub?: boolean }) {
    const s1 = summaryOf(team1, stat);
    const s2 = summaryOf(team2, stat);
    const subs = STAT_HIERARCHY[stat];
    return (
      <div className={`mb-3 flex items-center justify-center gap-4 ${sub ? "pl-4 text-[0.7rem] italic opacity-80" : "text-sm"}`}>
        <div className="flex flex-1 justify-end">
          <StatCells s={s1} order={["prev", "total", "avg"]} />
        </div>
        <div className="w-44 text-center">
          <div className="mb-0.5 flex items-center justify-center gap-1">
            <button className="cursor-pointer select-none font-bold hover:text-[#002f6c]" onClick={() => setSelectedStat(stat)} title="Click to chart this stat">
              {title(stat)}
            </button>
            {subs && !sub && (
              <button className="px-1 text-slate-500" onClick={() => setExpanded((e) => ({ ...e, [stat]: !e[stat] }))}>
                {expanded[stat] ? "–" : "+"}
              </button>
            )}
          </div>
          <RankBar stat={stat} />
        </div>
        <div className="flex flex-1 justify-start">
          <StatCells s={s2} order={["avg", "total", "prev"]} />
        </div>
      </div>
    );
  }

  function Section({ name, stats, bg }: { name: string; stats: string[]; bg?: string }) {
    return (
      <div className="relative mb-6 rounded-xl border border-slate-300 p-3 pt-4" style={{ background: bg }}>
        <div className="absolute -top-2.5 left-4 bg-white px-2 text-xs font-bold text-slate-500">{name}</div>
        {stats.map((st) => (
          <div key={st}>
            <StatRow stat={st} />
            {expanded[st] && (STAT_HIERARCHY[st] ?? []).map((sub) => <StatRow key={sub} stat={sub} sub />)}
          </div>
        ))}
      </div>
    );
  }

  // ---------- side charts ----------
  const trendOption = (team: string): EChartsOption | null => {
    const rows = (teamRows.get(team) ?? []).filter((r) => Number(r.week) <= wk && r[selectedStat] != null);
    if (!rows.length) return null;
    const xs = rows.map((r) => String(r.week));
    const ys = rows.map((r) => Number(r[selectedStat]));
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    const opps = rows.map((r) => opponentLabel(String(r.game_id ?? ""), team));
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
      yAxis: { type: "value", axisLabel: { fontSize: 9 } },
      series: [
        {
          type: "line",
          data: ys.map((v, i) => ({
            value: +v.toFixed(2),
            itemStyle: { color: Number(rows[i].win) === 1 ? "green" : "red" },
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
    const isAllowed = selectedStat.endsWith("_allowed");
    const base = isAllowed ? selectedStat.slice(0, -8) : selectedStat;
    const cols = new Set(Object.keys(teamWeek[0] ?? {}));
    const teamCol = selectedStat;
    const oppCol = isAllowed ? base : cols.has(`${base}_allowed`) ? `${base}_allowed` : base;

    const avgPrev = (t: string, col: string): [number | null, number | null] => {
      const rows = (teamRows.get(t) ?? []).filter((r) => Number(r.week) <= wk && r[col] != null);
      if (!rows.length) return [null, null];
      const vals = rows.map((r) => Number(r[col]));
      return [vals.reduce((a, b) => a + b, 0) / vals.length, vals[vals.length - 1]];
    };
    const toInt = (v: number | null) => (v == null ? null : Math.round(v));
    const [tAvg, tPrev] = avgPrev(team, teamCol);
    const [oAvg, oPrev] = avgPrev(opp, oppCol);
    const tLabel = isAllowed ? `${team} (Allowed)` : team;
    const oLabel = isAllowed ? opp : oppCol.endsWith("_allowed") ? `${opp} (Allowed)` : opp;
    const tRank = rankOf(team, teamCol);
    const oRank = rankOf(opp, oppCol);

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

  const trend1 = useMemo(() => trendOption(team1), [teamRows, team1, selectedStat, wk]);
  const trend2 = useMemo(() => trendOption(team2), [teamRows, team2, selectedStat, wk]);
  const m1 = useMemo(() => matchupOptions(team1, team2), [teamRows, ranks, team1, team2, selectedStat, wk]);
  const m2 = useMemo(() => matchupOptions(team2, team1), [teamRows, ranks, team1, team2, selectedStat, wk]);

  const trend1Ref = useECharts(trend1);
  const trend2Ref = useECharts(trend2);
  const m1MainRef = useECharts(m1?.main ?? null);
  const m1RankRef = useECharts(m1?.rank ?? null);
  const m2MainRef = useECharts(m2?.main ?? null);
  const m2RankRef = useECharts(m2?.rank ?? null);

  if (!meta) return <Loading />;

  function GradesBox({ team }: { team: string }) {
    const [ovr, off, def] = gradesOf(team);
    return (
      <div className="relative mb-3 rounded-xl border border-slate-800 bg-white p-3">
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-xs font-semibold">Grades</div>
        <div className="flex gap-2">
          {[["Ovr", ovr], ["Off", off], ["Def", def]].map(([l, v]) => (
            <div key={l} className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-center">
              <div className="text-[0.7rem] text-slate-500">{l}</div>
              <div className="text-lg font-bold">{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function TeamColumn({ team, setTeam, trendRef, mainRef, rankRef, label }: {
    team: string;
    setTeam: (t: string) => void;
    trendRef: React.RefObject<HTMLDivElement>;
    mainRef: React.RefObject<HTMLDivElement>;
    rankRef: React.RefObject<HTMLDivElement>;
    label: string;
  }) {
    return (
      <div className="w-full lg:w-1/4">
        <h2 className="mb-2 text-center text-sm font-semibold text-slate-600">{label}</h2>
        <Select label="" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t, label: meta!.get(t)?.name ?? t }))} />
        <div className="mt-3">
          <GradesBox team={team} />
        </div>
        <div className="rounded-xl border bg-white p-2 shadow-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">{title(selectedStat)} by week</div>
          <div ref={trendRef} className="h-44" />
        </div>
        <div className="mt-3 rounded-xl border bg-white p-2 shadow-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">
            {title(selectedStat.endsWith("_allowed") ? `${selectedStat.slice(0, -8)} allowed vs opp off` : `${selectedStat} vs opp allowed`)} — Wk{wk}
          </div>
          <div className="flex gap-2">
            <div ref={mainRef} className="h-64 flex-[3]" />
            <div ref={rankRef} className="h-64 flex-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#002f6c]">Team Comparison</h1>
        <div className="flex gap-4">
          <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <TeamColumn team={team1} setTeam={setTeam1} trendRef={trend1Ref} mainRef={m1MainRef} rankRef={m1RankRef} label="Team 1" />

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
          <div className="mb-3 flex items-center justify-center gap-4 text-xs font-bold text-slate-600">
            <div className="flex flex-1 justify-end gap-1.5">
              <div className="w-16 text-center">Prev</div>
              <div className="w-[70px] text-center">Total</div>
              <div className="w-16 text-center">Avg</div>
            </div>
            <div className="w-44" />
            <div className="flex flex-1 justify-start gap-1.5">
              <div className="w-16 text-center">Avg</div>
              <div className="w-[70px] text-center">Total</div>
              <div className="w-16 text-center">Prev</div>
            </div>
          </div>
          <Section name="Overall" stats={["points_margin", "turnover_margin", "epa_diff"]} />
          <Section name="Offensive stats" stats={STAT_LIST} bg="rgba(255,0,0,0.025)" />
          <Section name="Defensive stats" stats={STAT_LIST.map((s) => `${s}_allowed`)} bg="rgba(0,123,255,0.025)" />
          </div>
          </div>
        </div>

        <TeamColumn team={team2} setTeam={setTeam2} trendRef={trend2Ref} mainRef={m2MainRef} rankRef={m2RankRef} label="Team 2" />
      </div>
    </div>
  );
}
