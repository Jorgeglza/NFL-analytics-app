// Team Trends — new analytics (not a port). The trajectory behind Power
// Rankings: weekly grade/stat series for up to 3 teams across a season,
// instead of the single-week snapshots every other page shows.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getSchedule, getGrades, getTeamWeek, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { computePowerRankings, type PowerRankingRow } from "../../lib/logic/powerRankings";
import { METRICS, seriesFor } from "./team-trends/shared";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { PageHeader, tableWrapCls, theadCls, trCls } from "../../components/ui";

const NONE = "";
// Fallback only — real team colors (meta.color) are used whenever available.
const FALLBACK_COLORS = ["#002f6c", "#E87722", "#3C9A5F"];

export default function TeamTrends() {
  const [searchParams] = useSearchParams();
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [season, setSeason] = useState("");
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const [team1, setTeam1] = useState("DAL");
  const [team2, setTeam2] = useState("SF");
  const [team3, setTeam3] = useState(NONE);
  const deepLinkApplied = useRef(false);

  usePageTitle(season ? `Team Trends — ${season}` : "Team Trends");

  // Deep-linked from Power Rankings' "Compare" button (?team1=<team>) — applied
  // once per mount, same pattern as Game Picks/Team Comparison's URL params.
  // Only team2/team3 default to NONE here (not their usual DAL/SF preset) so
  // a Compare click starts on just the clicked team, letting the user pick
  // who to compare it against.
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const t1 = searchParams.get("team1");
    if (t1) {
      deepLinkApplied.current = true;
      setTeam1(t1);
      setTeam2(searchParams.get("team2") ?? NONE);
      setTeam3(searchParams.get("team3") ?? NONE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    Promise.all([getSchedule(), getTeamMetaMap()]).then(([s, m]) => {
      setSchedule(s);
      setMeta(m);
      if (!season) {
        const seasons = [...new Set(s.map((r) => Number(r.season)))].sort((a, b) => b - a);
        if (seasons.length) setSeason(String(seasons[0]));
      }
    });
    getGrades().then(setGrades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!season) return;
    getTeamWeek(Number(season)).then(setTeamWeek);
  }, [season]);

  const seasons = useMemo(() => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a), [schedule]);
  const teamOptions = useMemo(
    () =>
      [...new Set(schedule.filter((r) => String(r.season) === season).flatMap((r) => [String(r.home_team), String(r.away_team)]))]
        .sort()
        .map((t) => ({ value: t, label: meta?.get(t)?.name ?? t })),
    [schedule, season, meta],
  );
  const seasonWeeks = useMemo(
    () => [...new Set(schedule.filter((r) => String(r.season) === season && r.game_type === "REG").map((r) => Number(r.week)))].sort((a, b) => a - b),
    [schedule, season],
  );

  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];
  const teams = [team1, team2, team3].filter((t) => t !== NONE);

  // Composite/Elo/Pythagorean metrics (the Power Rankings signals) aren't
  // columns in any loaded frame — precompute them once per season so
  // switching the metric or teams doesn't re-run the ranking for every week.
  const powerRankingsByWeek = useMemo(() => {
    if (!season || !grades.length || !seasonWeeks.length) return new Map<number, PowerRankingRow[]>();
    return new Map(seasonWeeks.map((w) => [w, computePowerRankings(schedule, grades, Number(season), w)]));
  }, [schedule, grades, season, seasonWeeks]);

  const seriesByTeam = useMemo(() => {
    if (!season || !grades.length) return new Map<string, { week: number; value: number }[]>();
    if (metric.source === "team_week" && !teamWeek.length) return new Map<string, { week: number; value: number }[]>();
    const out = new Map<string, { week: number; value: number }[]>();
    for (const t of teams) out.set(t, seriesFor(metric, t, Number(season), grades, teamWeek, powerRankingsByWeek));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.join(","), metric, season, grades, teamWeek, powerRankingsByWeek]);

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (!teams.length) return null;
    const allWeeks = [...new Set([...seriesByTeam.values()].flatMap((s) => s.map((p) => p.week)))].sort((a, b) => a - b);
    if (!allWeeks.length) return null;

    const lineSeries = teams.map((t, i) => {
      const color = meta?.get(t)?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
      const byWeek = new Map((seriesByTeam.get(t) ?? []).map((p) => [p.week, p.value]));
      return {
        name: meta?.get(t)?.name ?? t,
        type: "line" as const,
        data: allWeeks.map((w) => byWeek.get(w) ?? null),
        connectNulls: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
      };
    });

    // Team logo at the last plotted point of each line — a small marker
    // series (categorical x-axis, null everywhere except the last index a
    // team has data), not part of the legend.
    const logoSeries = teams.flatMap((t) => {
      const logo = meta?.get(t)?.logo;
      if (!logo) return [];
      const byWeek = new Map((seriesByTeam.get(t) ?? []).map((p) => [p.week, p.value]));
      let lastIdx = -1;
      for (let i = 0; i < allWeeks.length; i++) if (byWeek.has(allWeeks[i])) lastIdx = i;
      if (lastIdx < 0) return [];
      return [
        {
          name: `${t}-logo`,
          type: "scatter" as const,
          data: allWeeks.map((w, i) => (i === lastIdx ? byWeek.get(w)! : null)),
          symbol: `image://${logo}`,
          symbolSize: 20,
          silent: true,
          legendHoverLink: false,
          tooltip: { show: false },
          z: 10,
        },
      ];
    });

    return {
      grid: { left: 10, right: 30, top: 30, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: allWeeks.map((w) => `Wk ${w}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: metric.label, axisLabel: { fontSize: 10 } },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 }, data: teams.map((t) => meta?.get(t)?.name ?? t) },
      series: [...lineSeries, ...logoSeries],
    } as EChartsOption;
  }, [teams, seriesByTeam, metric, meta]);
  const chartRef = useECharts(chartOption);

  if (!schedule.length || !grades.length || !meta) return <Loading label="Loading trends…" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Team Trends" subtitle="How each team got to where it is — weekly trajectory for up to 3 teams.">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Metric" value={metricKey} onChange={setMetricKey} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} />
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
        <Select label="Team 1" value={team1} onChange={setTeam1} options={teamOptions} />
        <Select label="Team 2" value={team2} onChange={setTeam2} options={[{ value: NONE, label: "— none —" }, ...teamOptions]} />
        <Select label="Team 3" value={team3} onChange={setTeam3} options={[{ value: NONE, label: "— none —" }, ...teamOptions]} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{metric.label} by week — {season}</h2>
        {chartOption ? <div ref={chartRef} className="h-80" /> : <div className="py-12 text-center text-sm text-slate-400">No data for the selected teams/metric.</div>}
      </div>

      <div className={tableWrapCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-3 py-2">Week</th>
              {teams.map((t) => (
                <th key={t} className="px-3 py-2">{meta.get(t)?.name ?? t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...new Set([...seriesByTeam.values()].flatMap((s) => s.map((p) => p.week)))]
              .sort((a, b) => a - b)
              .map((w) => (
                <tr key={w} className={trCls}>
                  <td className="px-3 py-2 font-semibold text-slate-700">Wk {w}</td>
                  {teams.map((t) => {
                    const v = (seriesByTeam.get(t) ?? []).find((p) => p.week === w)?.value;
                    return (
                      <td key={t} className="px-3 py-2 text-slate-600">{v == null ? "—" : v.toFixed(1)}</td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
