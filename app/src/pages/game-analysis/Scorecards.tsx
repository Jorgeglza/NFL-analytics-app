// Port of scorecards_teams_page_4.py — team playstyle donuts + stat sparkline cards.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getTeamWeek, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { getMeta } from "../../lib/data/loader";

const STAT_MAP: Record<string, [string, string, string][]> = {
  Points: [
    ["Points", "points", "#f39c12"],
    ["Passing EPA", "passing_epa", "#f39c12"],
  ],
  Passing: [
    ["Pass Yds/Gm", "passing_yards", "#3498db"],
    ["Comp/Gm", "completions", "#3498db"],
    ["Air Yards", "passing_air_yards", "#3498db"],
  ],
  Rushing: [
    ["Rush Yds", "rushing_yards", "#e74c3c"],
    ["Rush TDs", "rushing_tds", "#e74c3c"],
    ["Rush 1st Downs", "rushing_first_downs", "#e74c3c"],
  ],
  Touchdowns: [
    ["Pass TDs", "passing_tds", "#2980b9"],
    ["Rush TDs", "rushing_tds", "#c0392b"],
    ["ST TDs", "special_teams_tds", "#8e44ad"],
  ],
};

function Sparkline({ weeks, values, color, wins }: { weeks: number[]; values: (number | null)[]; color: string; wins: (number | null)[] }) {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: "category", data: weeks.map(String), show: false },
    yAxis: { type: "value", show: false },
    series: [
      { type: "line", data: values, symbol: "none", lineStyle: { color, width: 2 } },
      {
        type: "scatter",
        symbolSize: 6,
        itemStyle: { color: "green" },
        data: values.map((v, i) => (Number(wins[i]) === 1 ? v : null)),
      },
    ],
  }), [weeks.join(","), values.join(","), color]);
  const ref = useECharts(option);
  return <div ref={ref} className="h-[50px]" />;
}

function Donut({ values, labels, colors }: { values: number[]; labels: string[]; colors: string[] }) {
  const total = values.reduce((a, b) => a + b, 0);
  const option = useMemo<EChartsOption>(() => ({
    legend: { bottom: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 10 } },
    tooltip: {
      formatter: (p: unknown) => {
        const q = p as { name: string; value: number; percent: number };
        return `${q.name}: ${q.value} (${q.percent.toFixed(1)}%)`;
      },
    },
    graphic: [{ type: "text", left: "center", top: "middle", style: { text: String(Math.round(total)), fontSize: 20, fontWeight: "bold" } }],
    series: [
      {
        type: "pie",
        radius: ["50%", "75%"],
        label: { show: true, position: "inside", formatter: (p: { percent?: number }) => `${Math.round(p.percent ?? 0)}%`, fontSize: 11 },
        data: values.map((v, i) => ({ value: Math.round(v), name: labels[i], itemStyle: { color: colors[i] } })),
      },
    ],
  }), [values.join(","), labels.join(",")]);
  const ref = useECharts(option);
  return <div ref={ref} className="h-[220px] flex-1" />;
}

export default function Scorecards() {
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState("");
  const [team, setTeam] = useState("DAL");
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);

  useEffect(() => {
    Promise.all([getTeamMetaMap(), getMeta()]).then(([m, mt]) => {
      setMeta(m);
      const ss = [...mt.seasons].sort((a, b) => b - a);
      setSeasons(ss);
      if (ss.length) setSeason(String(ss[0]));
    });
  }, []);

  useEffect(() => {
    if (season) getTeamWeek(Number(season)).then((tw) => setTeamWeek(tw.filter((r) => r.game_type === "REG" || r.game_type == null)));
  }, [season]);

  const teams = useMemo(() => [...new Set(teamWeek.map((r) => String(r.team)))].sort(), [teamWeek]);
  const df = useMemo(
    () => teamWeek.filter((r) => String(r.team) === team).sort((a, b) => Number(a.week) - Number(b.week)),
    [teamWeek, team],
  );
  const weeks = df.map((r) => Number(r.week));
  const wins = df.map((r) => (r.win == null ? null : Number(r.win)));

  const sum = (col: string) => df.reduce((s, r) => s + (r[col] == null ? 0 : Number(r[col])), 0);
  const record = useMemo(() => {
    const played = df.filter((r) => r.win != null);
    const w = played.reduce((s, r) => s + Number(r.win), 0);
    return `${Math.round(w)} - ${played.length - Math.round(w)}`;
  }, [df]);

  const cardValue = (col: string): string => {
    const vals = df.map((r) => (r[col] == null ? null : Number(r[col]))).filter((v): v is number => v != null);
    if (!vals.length) return "—";
    const allInt = vals.every((v) => Number.isInteger(v));
    return allInt ? String(vals.reduce((a, b) => a + b, 0)) : (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  function StatCard({ label, col, color }: { label: string; col: string; color: string }) {
    if (!df.length || df.every((r) => r[col] == null)) return null;
    return (
      <div className="w-40 rounded-xl border-2 bg-white p-2 text-center" style={{ borderColor: color }}>
        <div className="mb-1 text-xl font-bold">{cardValue(col)}</div>
        <Sparkline weeks={weeks} values={df.map((r) => (r[col] == null ? null : Number(r[col])))} color={color} wins={wins} />
        <div className="mt-1 text-xs text-slate-500">{label}</div>
      </div>
    );
  }

  function Section({ name, stats }: { name: string; stats: [string, string, string][] }) {
    return (
      <div>
        <div className="mb-2 mt-4 text-lg font-bold">{name}</div>
        <div className="flex flex-wrap gap-4">
          {stats.map(([label, col, color]) => (
            <StatCard key={label + col} label={label} col={col} color={color} />
          ))}
        </div>
      </div>
    );
  }

  if (!meta) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>;
  const tm = meta.get(team);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-800 bg-white p-4 lg:w-60">
          <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          <Select label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t, label: meta.get(t)?.name ?? t }))} />
          <div className="mt-2 text-center">
            {tm?.logo && <img src={tm.logo} alt={team} className="mx-auto h-16" />}
            <div className="mt-1 text-sm font-bold" style={{ color: tm?.color }}>{tm?.name}</div>
            <div className="text-xs font-semibold text-slate-600">Record: {record}</div>
          </div>
        </div>

        <div className="relative flex-1 rounded-xl border border-[#c0392b] bg-[rgba(231,76,60,0.05)] p-4 pt-5">
          <div className="absolute -top-3 left-4 px-1 text-sm font-semibold text-[#c0392b]">Offense Style</div>
          <div className="flex gap-4">
            <Donut values={[sum("attempts"), sum("carries")]} labels={["Pass Attempts", "Carries"]} colors={["#e74c3c", "#f5b7b1"]} />
            <Donut values={[sum("passing_first_downs"), sum("rushing_first_downs")]} labels={["Pass 1st Downs", "Rush 1st Downs"]} colors={["#c0392b", "#f1948a"]} />
          </div>
        </div>
        <div className="relative flex-1 rounded-xl border border-[#2980b9] bg-[rgba(52,152,219,0.05)] p-4 pt-5">
          <div className="absolute -top-3 left-4 px-1 text-sm font-semibold text-[#2980b9]">Defense Style</div>
          <div className="flex gap-4">
            <Donut values={[sum("attempts_allowed"), sum("carries_allowed")]} labels={["Pass Att. Allowed", "Carries Allowed"]} colors={["#3498db", "#aed6f1"]} />
            <Donut values={[sum("passing_first_downs_allowed"), sum("rushing_first_downs_allowed")]} labels={["Pass 1D Allowed", "Rush 1D Allowed"]} colors={["#2980b9", "#85c1e9"]} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="relative flex-1 rounded-xl border border-[#c0392b] bg-[rgba(231,76,60,0.05)] p-4">
          <div className="absolute -top-3 left-4 bg-white px-2 font-semibold text-[#c0392b]">Offense</div>
          {Object.entries(STAT_MAP).map(([name, stats]) => (
            <Section key={name} name={name} stats={stats} />
          ))}
        </div>
        <div className="relative flex-1 rounded-xl border border-[#2980b9] bg-[rgba(52,152,219,0.05)] p-4">
          <div className="absolute -top-3 left-4 bg-white px-2 font-semibold text-[#2980b9]">Defense</div>
          {Object.entries(STAT_MAP).map(([name, stats]) => (
            <Section
              key={name}
              name={`${name} Allowed`}
              stats={stats.map(([l, c, col]) => [l, `${c}_allowed`, col] as [string, string, string])}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
