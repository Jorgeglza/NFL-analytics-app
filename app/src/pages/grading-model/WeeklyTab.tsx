// Port of weekly_tab.py — one week across all teams: KPIs, histogram, box,
// ranked bar, off/def scatter, stats table.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import type { TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { percentile, sampleStd, type GradeType } from "../../lib/logic/contributions";
import { seasonRecords, weekGameInfo } from "./shared";
import { rankedBarOption, offDefScatterOption, type TeamPoint } from "./charts";

const GRADE_OPTS: GradeType[] = ["Overall Grade", "Offensive Grade", "Defensive Grade"];

export default function WeeklyTab({
  grades,
  schedule,
  meta,
}: {
  grades: Row[];
  schedule: Row[];
  meta: Map<string, TeamMeta>;
}) {
  const seasons = useMemo(() => [...new Set(grades.map((r) => Number(r.Season)))].sort((a, b) => b - a), [grades]);
  const [season, setSeason] = useState("");
  const sel = season || String(seasons[0] ?? "");
  const weeks = useMemo(
    () => [...new Set(grades.filter((r) => String(r.Season) === sel).map((r) => Number(r.Week)))].sort((a, b) => a - b),
    [grades, sel],
  );
  const [week, setWeek] = useState("");
  const selWeek = weeks.map(String).includes(week) ? week : String(weeks[weeks.length - 1] ?? "");
  const [gradeType, setGradeType] = useState<GradeType>("Overall Grade");

  const sub = useMemo(
    () => grades.filter((r) => String(r.Season) === sel && String(r.Week) === selWeek && r[gradeType] != null),
    [grades, sel, selWeek, gradeType],
  );

  const stats = useMemo(() => {
    const x = sub.map((r) => Number(r[gradeType]));
    if (!x.length) return null;
    const n = x.length;
    const mean = x.reduce((a, b) => a + b, 0) / n;
    const std = sampleStd(x);
    const q1 = percentile(x, 25);
    const med = percentile(x, 50);
    const q3 = percentile(x, 75);
    return { n, mean, std, q1, med, q3, iqr: q3 - q1, min: Math.min(...x), max: Math.max(...x) };
  }, [sub, gradeType]);

  const records = useMemo(() => seasonRecords(schedule, Number(sel)), [schedule, sel]);
  const wkInfo = useMemo(() => weekGameInfo(schedule, Number(sel), Number(selWeek)), [schedule, sel, selWeek]);

  const points: TeamPoint[] = useMemo(
    () =>
      sub.map((r) => ({
        team: String(r.Team),
        value: Number(r[gradeType]),
        off: Number(r["Offensive Grade"]),
        def: Number(r["Defensive Grade"]),
        record: records.get(String(r.Team)) ?? "0-0",
        extraLine: `Week ${selWeek}: ${wkInfo.get(String(r.Team))?.resultLine ?? "No game/score"}`,
        won: wkInfo.get(String(r.Team))?.won ?? false,
      })),
    [sub, gradeType, records, wkInfo, selWeek],
  );

  const histOption = useMemo<EChartsOption | null>(() => {
    if (!stats) return null;
    const x = sub.map((r) => Number(r[gradeType]));
    const nbins = Math.min(24, Math.max(5, Math.floor(x.length / 2)));
    const lo = stats.min;
    const hi = stats.max === lo ? lo + 1 : stats.max;
    const w = (hi - lo) / nbins;
    const counts = new Array(nbins).fill(0);
    for (const v of x) counts[Math.min(nbins - 1, Math.floor((v - lo) / w))]++;
    return {
      grid: { left: 10, right: 10, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: counts.map((_, i) => `${(lo + i * w).toFixed(1)}`), name: "Grade", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: "Teams" },
      series: [
        { name: "Teams", type: "bar", data: counts, barCategoryGap: "5%", itemStyle: { color: "#636EFA" } },
        {
          name: "Mean",
          type: "line",
          data: [],
          markLine: {
            symbol: "none",
            lineStyle: { type: "dashed" },
            label: { formatter: "Mean" },
            data: [{ xAxis: Math.min(nbins - 1, Math.max(0, Math.floor((stats.mean - lo) / w))) }],
          },
        },
        {
          name: "Median",
          type: "line",
          data: [],
          markLine: {
            symbol: "none",
            lineStyle: { type: "dotted" },
            label: { formatter: "Median" },
            data: [{ xAxis: Math.min(nbins - 1, Math.max(0, Math.floor((stats.med - lo) / w))) }],
          },
        },
      ],
    } as EChartsOption;
  }, [sub, stats, gradeType]);

  const boxOption = useMemo<EChartsOption | null>(() => {
    if (!stats) return null;
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: [gradeType] },
      yAxis: { type: "value", name: "Grade" },
      tooltip: {
        formatter: () =>
          `Min: ${stats.min.toFixed(1)}<br/>Q1: ${stats.q1.toFixed(1)}<br/>Median: ${stats.med.toFixed(1)}<br/>Mean: ${stats.mean.toFixed(1)}<br/>Q3: ${stats.q3.toFixed(1)}<br/>Max: ${stats.max.toFixed(1)}`,
      },
      series: [
        {
          type: "boxplot",
          data: [[stats.min, stats.q1, stats.med, stats.q3, stats.max]],
          itemStyle: { color: "rgba(99,110,250,0.4)", borderColor: "#636EFA" },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#444" }, label: { formatter: "mean" }, data: [{ yAxis: stats.mean }] },
        },
      ],
    } as EChartsOption;
  }, [stats, gradeType]);

  const rankOption = useMemo(() => (points.length ? rankedBarOption(points, meta, true) : null), [points, meta]);
  const odOption = useMemo(() => (points.length ? offDefScatterOption(points, meta) : null), [points, meta]);

  const histRef = useECharts(histOption);
  const boxRef = useECharts(boxOption);
  const rankRef = useECharts(rankOption);
  const odRef = useECharts(odOption);

  const tableRows = useMemo(() => {
    if (!stats) return [];
    const vals = points.map((p) => p.value);
    // rank(pct=True) = average rank / n
    const pct = (v: number) => {
      const below = vals.filter((x) => x < v).length;
      const eq = vals.filter((x) => x === v).length;
      return ((below + (eq + 1) / 2) / vals.length) * 100;
    };
    return points
      .map((p) => ({
        team: p.team,
        grade: p.value,
        rank: vals.filter((x) => x > p.value).length + 1,
        z: stats.std > 1e-12 ? (p.value - stats.mean) / stats.std : 0,
        pct: pct(p.value),
      }))
      .sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team));
  }, [points, stats]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: String(w) }))} />
        <div className="flex gap-2">
          {GRADE_OPTS.map((g) => (
            <button key={g} onClick={() => setGradeType(g)} className={`rounded-full px-3 py-1.5 text-sm ${gradeType === g ? "bg-[#002f6c] text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
              {g.replace(" Grade", "")}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Teams", String(stats.n)],
            ["Mean", stats.mean.toFixed(1)],
            ["Median", stats.med.toFixed(1)],
            ["Std Dev", stats.std.toFixed(1)],
            ["IQR", stats.iqr.toFixed(1)],
            ["Min / Max", `${stats.min.toFixed(1)} / ${stats.max.toFixed(1)}`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">{l}</div>
              <div className="text-xl font-bold text-slate-900">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{gradeType} – Histogram (Season {sel}, Week {selWeek})</h3>
          <div ref={histRef} className="h-[380px]" />
        </div>
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{gradeType} – Box Plot</h3>
          <div ref={boxRef} className="h-[380px]" />
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">{gradeType} – Team Ranking (Season {sel}, Week {selWeek})</h3>
        <div ref={rankRef} className="h-[600px]" />
      </div>
      <div className="rounded-xl border bg-white p-3 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">📊 Offense vs Defense Grade – Season {sel}, Week {selWeek}</h3>
        <div ref={odRef} className="h-[700px]" />
      </div>

      <div className="rounded-xl border bg-white p-3 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2 text-right">Grade</th>
                <th className="px-3 py-2 text-right">Rank</th>
                <th className="px-3 py-2 text-right">Z</th>
                <th className="px-3 py-2 text-right">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.team} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-semibold">{r.team}</td>
                  <td className="px-3 py-1.5 text-right">{r.grade.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right">{r.rank}</td>
                  <td className="px-3 py-1.5 text-right">{r.z.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right">{r.pct.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
