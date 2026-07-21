// Team season scorecard — full Session-5 rework of the old donut/sparkline port
// (audit §5): unambiguous per-game/total labeling, league-average and league-rank
// context on every stat, disclosed playstyle metrics, grades with ranks, and a
// season-journey chart (weekly margin + grade evolution). Data unchanged:
// team_week + team_week_ranks + grades.json, regular season only.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getTeamWeek, getTeamWeekRanks, getGrades, getMeta, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { Card } from "../../components/ui";
import { opponentLabel } from "../grading-model/shared";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";

const OFF_ACCENT = "#c0392b";
const DEF_ACCENT = "#2980b9";

// [label, column, decimals for per-game display]
const OFF_STATS: [string, string, number][] = [
  ["Points", "points", 1],
  ["Total Yards", "total_yards", 0],
  ["Passing Yards", "passing_yards", 0],
  ["Rushing Yards", "rushing_yards", 0],
  ["Passing TDs", "passing_tds", 1],
  ["Rushing TDs", "rushing_tds", 1],
  ["Turnovers", "turnovers", 1],
];

interface SeasonStat {
  total: number;
  perGame: number;
  games: number;
}

function statOf(rows: Row[], col: string): SeasonStat | null {
  const vals = rows.map((r) => (r[col] == null ? null : Number(r[col]))).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  return { total, perGame: total / vals.length, games: vals.length };
}

const fmt = (v: number, d: number) => (d === 0 ? String(Math.round(v)) : v.toFixed(d));

interface SparkPoint {
  week: number;
  opp: string;
  value: number | null;
  win: boolean;
}

/** Weekly sparkline with a dashed league-average line and green win dots. */
function StatSpark({ pts, lg, color }: { pts: SparkPoint[]; lg: number | null; color: string }) {
  const values = pts.map((p) => p.value);
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 2, right: 2, top: 4, bottom: 4 },
      xAxis: { type: "category", data: pts.map((p) => `W${p.week}`), show: false },
      yAxis: { type: "value", show: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const p = pts[i];
          return `W${p.week} vs ${p.opp}<br/>${p.value == null ? "—" : p.value.toFixed(1)}${lg != null ? ` (league avg ${lg.toFixed(1)})` : ""}`;
        },
      },
      series: [
        { type: "line", data: values, symbol: "none", lineStyle: { color, width: 2 }, connectNulls: true },
        ...(lg != null
          ? [{ type: "line" as const, data: values.map(() => lg), symbol: "none", lineStyle: { color: "#94a3b8", width: 1, type: "dashed" as const }, tooltip: { show: false }, silent: true }]
          : []),
        {
          type: "scatter",
          symbolSize: 5,
          data: values.map((v, i) => (pts[i].win ? v : null)),
          itemStyle: { color: "#3C9A5F" },
          tooltip: { show: false },
        },
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [values.map((v) => v ?? "").join(","), lg, color],
  );
  const ref = useECharts(option);
  return <div ref={ref} className="h-11 min-w-0 flex-1" />;
}

/** One stat line: label + rank chip · per-game · total · league avg · sparkline. */
function StatRow({
  label,
  s,
  lg,
  rank,
  nTeams,
  decimals,
  accent,
  pts,
}: {
  label: string;
  s: SeasonStat | null;
  lg: number | null;
  rank: number | null;
  nTeams: number;
  decimals: number;
  accent: string;
  pts: SparkPoint[];
}) {
  if (!s) return null;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 shrink-0">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {rank != null && (
          <span
            className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-bold text-white ${rank <= Math.ceil(nTeams / 3) ? "bg-[#3C9A5F]" : rank > nTeams - Math.ceil(nTeams / 3) ? "bg-[#C8102E]" : "bg-slate-400"}`}
            title={`League rank #${rank} of ${nTeams} (season-to-date). Ranks already account for direction — #1 is always best.`}
          >
            #{rank}
          </span>
        )}
      </div>
      <div className="w-16 shrink-0 text-right">
        <div className="text-base font-bold tabular-nums text-slate-900">{fmt(s.perGame, decimals)}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">per game</div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-600">{Math.round(s.total).toLocaleString()}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">total ({s.games} gm)</div>
      </div>
      <div className="w-14 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-400">{lg == null ? "—" : fmt(lg, decimals)}</div>
        <div className="text-[9px] font-medium uppercase tracking-wider text-slate-400">lg avg/gm</div>
      </div>
      <StatSpark pts={pts} lg={lg} color={accent} />
    </div>
  );
}

/** Two-way share bar with a dashed league-average marker, on-bar percentages,
 *  and a league rank chip (#1 = highest first-side share — a style spectrum,
 *  not good/bad). Metric named in the label. */
function SplitBar({
  label,
  a,
  b,
  la,
  lb,
  aName,
  bName,
  accent,
  rank,
  nTeams,
}: {
  label: string;
  a: number;
  b: number;
  la: number;
  lb: number;
  aName: string;
  bName: string;
  accent: string;
  rank: number | null;
  nTeams: number;
}) {
  if (!(a + b) || !(la + lb)) return null;
  const pct = (a / (a + b)) * 100;
  const lgPct = (la / (la + lb)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-600">{label}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-400">
          {rank != null && (
            <span
              className="rounded-full bg-slate-600 px-1.5 py-px text-[10px] font-bold text-white"
              title={`League rank by ${aName.toLowerCase()} share — #1 = most ${aName.toLowerCase()}-heavy of ${nTeams} teams`}
            >
              #{rank} {aName.toLowerCase()}-heavy
            </span>
          )}
          <span title="Difference vs the league-average share">
            {pct >= lgPct ? "+" : ""}
            {(pct - lgPct).toFixed(1)} pts vs lg
          </span>
        </span>
      </div>
      <div
        className="relative flex h-5 overflow-hidden rounded-full bg-slate-200"
        title={`${aName}: ${Math.round(a)} (${pct.toFixed(1)}%) · ${bName}: ${Math.round(b)} (${(100 - pct).toFixed(1)}%) — dashed marker = league-average ${aName.toLowerCase()} share (${lgPct.toFixed(1)}%)`}
      >
        <div className="flex h-full items-center justify-center rounded-l-full text-[10px] font-bold text-white" style={{ width: `${pct}%`, background: accent }}>
          {pct >= 14 && `${aName} ${pct.toFixed(0)}%`}
        </div>
        <div className="flex h-full flex-1 items-center justify-center text-[10px] font-bold text-slate-600">
          {100 - pct >= 14 && `${bName} ${(100 - pct).toFixed(0)}%`}
        </div>
        <div className="absolute top-0 h-full border-l-2 border-dashed border-slate-700/70" style={{ left: `${lgPct}%` }} />
      </div>
    </div>
  );
}

export default function Scorecards() {
  const [searchParams] = useSearchParams();
  const { season, setSeason } = useSeasonWeek();
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [team, setTeam] = useState(searchParams.get("team") ?? "DAL");
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);
  const [ranks, setRanks] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);

  usePageTitle(`Team Scorecard: ${team}`);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getMeta(), getGrades()]).then(([m, mt, g]) => {
      setMeta(m);
      setGrades(g);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
    });
  }, []);

  // Deep-linked season (e.g. from Team Comparison) wins over the shared
  // season/week context, applied once per mount.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const s = searchParams.get("season");
    if (s) {
      deepLinkApplied.current = true;
      setSeason(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!season) return;
    Promise.all([getTeamWeek(Number(season)), getTeamWeekRanks(Number(season))]).then(([tw, rk]) => {
      setTeamWeek(tw.filter((r) => r.game_type === "REG" || r.game_type == null));
      setRanks(rk);
    });
  }, [season]);

  const teams = useMemo(() => [...new Set(teamWeek.map((r) => String(r.team)))].sort(), [teamWeek]);
  const df = useMemo(
    () => teamWeek.filter((r) => String(r.team) === team).sort((a, b) => Number(a.week) - Number(b.week)),
    [teamWeek, team],
  );
  const nTeams = teams.length;

  // League per-game averages: every team-week row of the season, equal weight.
  const leagueAvg = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (col: string): number | null => {
      if (!cache.has(col)) {
        const s = statOf(teamWeek, col);
        cache.set(col, s ? s.perGame : null);
      }
      return cache.get(col)!;
    };
  }, [teamWeek]);

  // Latest cumulative league rank for a column (season-to-date at the last played week).
  const lastWeek = useMemo(() => {
    const played = df.filter((r) => r.win != null).map((r) => Number(r.week));
    return played.length ? Math.max(...played) : null;
  }, [df]);
  const rankOf = useMemo(() => {
    const row = lastWeek == null ? undefined : ranks.find((r) => String(r.team) === team && Number(r.week) === lastWeek);
    return (col: string): number | null => {
      const v = row?.[`${col}_rank`];
      return v == null ? null : Math.round(Number(v));
    };
  }, [ranks, team, lastWeek]);

  const record = useMemo(() => {
    const played = df.filter((r) => r.win != null);
    const w = played.reduce((s, r) => s + Number(r.win), 0);
    return { wins: Math.round(w), losses: played.length - Math.round(w), games: played.length };
  }, [df]);

  // Season-average grades + league rank (same averaging as Team Comparison).
  const gradeInfo = useMemo(() => {
    const rows = grades.filter((r) => String(r.Season) === season);
    const byTeam = new Map<string, Row[]>();
    for (const r of rows) {
      const t = String(r.Team);
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(r);
    }
    const out: { key: string; label: string; value: number | null; rank: number | null }[] = [];
    for (const [key, label] of [["Overall Grade", "Overall"], ["Offensive Grade", "Offense"], ["Defensive Grade", "Defense"]] as const) {
      const avgs = [...byTeam.entries()]
        .map(([t, tr]) => ({ t, v: tr.reduce((s, r) => s + Number(r[key] ?? 0), 0) / tr.length }))
        .sort((a, b) => b.v - a.v);
      const mine = avgs.find((a) => a.t === team);
      out.push({ key, label, value: mine ? mine.v : null, rank: mine ? avgs.indexOf(mine) + 1 : null });
    }
    return { metrics: out, nGraded: byTeam.size };
  }, [grades, season, team]);

  const color = meta?.get(team)?.color ?? "#002f6c";

  // ---------- season journey: weekly points margin bars + overall grade line ----------
  const journeyOption = useMemo<EChartsOption | null>(() => {
    const played = df.filter((r) => r.win != null);
    if (!played.length) return null;
    const xs = played.map((r) => `W${r.week}`);
    const opps = played.map((r) => opponentLabel(String(r.game_id ?? ""), team));
    const margins = played.map((r) => (r.points_margin == null ? null : Number(r.points_margin)));
    const gradeByWeek = new Map(
      grades
        .filter((r) => String(r.Season) === season && String(r.Team) === team)
        .map((r) => [Number(r.Week), Number(r["Overall Grade"])]),
    );
    const gradeSeries = played.map((r) => gradeByWeek.get(Number(r.week)) ?? null);
    return {
      grid: { left: 10, right: 10, top: 34, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[];
          const i = arr[0]?.dataIndex ?? 0;
          const m = margins[i];
          const g = gradeSeries[i];
          return `${xs[i]} vs ${opps[i]}<br/>Margin: ${m == null ? "—" : (m > 0 ? "+" : "") + m}${m != null ? (m > 0 ? " (W)" : m < 0 ? " (L)" : " (T)") : ""}<br/>Overall grade: ${g == null ? "—" : Math.round(g)}`;
        },
      },
      xAxis: { type: "category", data: xs, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "Margin", axisLabel: { fontSize: 10 } },
        { type: "value", name: "Grade", min: 0, max: 100, axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: "Points margin",
          type: "bar",
          barMaxWidth: 26,
          data: margins.map((m) => ({
            value: m,
            itemStyle: { color: m != null && m > 0 ? "#3C9A5F" : m != null && m < 0 ? "#C8102E" : "#94a3b8", borderRadius: 3 },
          })),
        },
        {
          name: "Overall grade",
          type: "line",
          yAxisIndex: 1,
          data: gradeSeries,
          lineStyle: { color: "#002f6c", width: 2 },
          itemStyle: { color: "#002f6c" },
          symbolSize: 5,
        },
      ],
    } as EChartsOption;
  }, [df, grades, season, team]);
  const journeyRef = useECharts(journeyOption);

  // League rank of this team's a/(a+b) share for a metric pair (#1 = highest share).
  const shareRank = useMemo(() => {
    return (aCol: string, bCol: string): number | null => {
      const shares: { t: string; v: number }[] = [];
      for (const t of teams) {
        const rows = teamWeek.filter((r) => String(r.team) === t);
        const a = statOf(rows, aCol)?.total ?? 0;
        const b = statOf(rows, bCol)?.total ?? 0;
        if (a + b > 0) shares.push({ t, v: a / (a + b) });
      }
      shares.sort((x, y) => y.v - x.v);
      const i = shares.findIndex((s) => s.t === team);
      return i < 0 ? null : i + 1;
    };
  }, [teamWeek, teams, team]);

  // Sparkline points for a column (weeks in order, win flag + opponent for tooltips).
  const sparkPts = (col: string): SparkPoint[] =>
    df.map((r) => ({
      week: Number(r.week),
      opp: opponentLabel(String(r.game_id ?? ""), team),
      value: r[col] == null ? null : Number(r[col]),
      win: Number(r.win) === 1,
    }));

  if (!meta) return <Loading />;
  const tm = meta.get(team);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 title="For a league-wide statistical view, see Spread Win Percentage." className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Team Scorecard</h1>
        <div className="flex gap-4">
          <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t, label: meta.get(t)?.name ?? t }))} />
        </div>
      </div>

      {/* ---------- hero: identity + grades ---------- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ borderTop: `4px solid ${color}` }}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4">
          <div className="flex items-center gap-4">
            {tm?.logo && <img src={tm.logo} alt={team} className="h-16" />}
            <div>
              <div className="text-lg font-extrabold" style={{ color }}>{tm?.name ?? team}</div>
              <div className="text-sm text-slate-500">
                {season} regular season · <span className="font-bold text-slate-800">{record.wins}-{record.losses}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-6 text-center">
            {(
              [
                ["Points/Gm", statOf(df, "points"), rankOf("points"), 1],
                ["Allowed/Gm", statOf(df, "points_allowed"), rankOf("points_allowed"), 1],
              ] as const
            ).map(([l, s, rank, d]) => (
              <div key={l}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{l}</div>
                <div className="text-xl font-bold tabular-nums">{s ? fmt(s.perGame, d) : "—"}</div>
                {rank != null && <div className="text-[10px] font-semibold text-slate-400">#{rank} of {nTeams}</div>}
              </div>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {gradeInfo.metrics.map((g) => (
              <div key={g.key} className="w-20 rounded-xl border border-slate-200 px-2 py-1.5 text-center" title={`Model grade, season average. Rank #${g.rank ?? "—"} of ${gradeInfo.nGraded}.`}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{g.label}</div>
                <div className="text-lg font-bold tabular-nums">{g.value == null ? "—" : Math.round(g.value)}</div>
                <div className="text-[10px] font-semibold text-slate-400">{g.rank == null ? "" : `#${g.rank}`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- season journey ---------- */}
      <Card
        title="Season journey"
        subtitle="Weekly points margin (green = win, red = loss) with the model's overall grade overlaid (right axis)."
      >
        <div ref={journeyRef} className="h-[260px]" />
      </Card>

      {/* ---------- playstyle ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Offense style" subtitle="Pass vs rush share of season totals. Dashed marker = league-average pass share." accent={OFF_ACCENT}>
          <div className="space-y-4">
            {([
              ["Play volume (pass attempts vs carries)", "attempts", "carries"],
              ["First downs (passing vs rushing)", "passing_first_downs", "rushing_first_downs"],
              ["Yards (passing vs rushing)", "passing_yards", "rushing_yards"],
            ] as const).map(([label, aCol, bCol]) => (
              <SplitBar key={aCol} label={label} a={statOf(df, aCol)?.total ?? 0} b={statOf(df, bCol)?.total ?? 0} la={statOf(teamWeek, aCol)?.total ?? 0} lb={statOf(teamWeek, bCol)?.total ?? 0} aName="Pass" bName="Rush" accent={OFF_ACCENT} rank={shareRank(aCol, bCol)} nTeams={nTeams} />
            ))}
          </div>
        </Card>
        <Card title="Defense style" subtitle="What opponents do against this team, share of season totals. Dashed marker = league average." accent={DEF_ACCENT}>
          <div className="space-y-4">
            {([
              ["Play volume faced (pass vs rush)", "attempts_allowed", "carries_allowed"],
              ["First downs allowed (pass vs rush)", "passing_first_downs_allowed", "rushing_first_downs_allowed"],
              ["Yards allowed (pass vs rush)", "passing_yards_allowed", "rushing_yards_allowed"],
            ] as const).map(([label, aCol, bCol]) => (
              <SplitBar key={aCol} label={label} a={statOf(df, aCol)?.total ?? 0} b={statOf(df, bCol)?.total ?? 0} la={statOf(teamWeek, aCol)?.total ?? 0} lb={statOf(teamWeek, bCol)?.total ?? 0} aName="Pass" bName="Rush" accent={DEF_ACCENT} rank={shareRank(aCol, bCol)} nTeams={nTeams} />
            ))}
          </div>
        </Card>
      </div>

      {/* ---------- stat panels ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Offense"
          subtitle="Per-game average · season total · league average per game · weekly trend (dashed = league avg, green dot = win)."
          accent={OFF_ACCENT}
        >
          <div className="divide-y divide-slate-100">
            {OFF_STATS.map(([label, col, d]) => (
              <StatRow key={col} label={label} s={statOf(df, col)} lg={leagueAvg(col)} rank={rankOf(col)} nTeams={nTeams} decimals={d} accent={OFF_ACCENT} pts={sparkPts(col)} />
            ))}
          </div>
        </Card>
        <Card
          title="Defense (allowed)"
          subtitle="What this team gives up. Same columns; for defense, lower is better — the rank chips already account for that."
          accent={DEF_ACCENT}
        >
          <div className="divide-y divide-slate-100">
            {OFF_STATS.map(([label, col, d]) => (
              <StatRow key={col} label={`${label} allowed`} s={statOf(df, `${col}_allowed`)} lg={leagueAvg(`${col}_allowed`)} rank={rankOf(`${col}_allowed`)} nTeams={nTeams} decimals={d} accent={DEF_ACCENT} pts={sparkPts(`${col}_allowed`)} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
