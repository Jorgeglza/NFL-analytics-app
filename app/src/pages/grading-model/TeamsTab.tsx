// Port of teams_tab.py — weekly stacked contributions, top drivers, waterfall,
// drivers stats table, and per-stat trend chart.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getTeamWeek, type Row, type ContribParams } from "../../lib/data/loader";
import type { TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { weekContributions, type GradeType } from "../../lib/logic/contributions";
import { buildStatGroups, statLabel } from "../player-analysis/statPicker";
import { teamPalette, opponentLabel } from "./shared";

const GRADE_OPTS: GradeType[] = ["Overall Grade", "Offensive Grade", "Defensive Grade"];

export default function TeamsTab({
  grades,
  meta,
  contribParams,
  season,
  onSeasonChange,
  team,
  onTeamChange,
}: {
  grades: Row[];
  meta: Map<string, TeamMeta>;
  contribParams: ContribParams;
  season: string;
  onSeasonChange: (v: string) => void;
  team: string;
  onTeamChange: (v: string) => void;
}) {
  const seasons = useMemo(() => [...new Set(grades.map((r) => Number(r.Season)))].sort((a, b) => b - a), [grades]);
  const teams = useMemo(() => [...new Set(grades.map((r) => String(r.Team)))].sort(), [grades]);

  const sel = season || String(seasons[0] ?? "");
  const [gradeType, setGradeType] = useState<GradeType>("Overall Grade");
  const [topN, setTopN] = useState(7);
  const [throughWeek, setThroughWeek] = useState<number | null>(null);
  const [teamWeek, setTeamWeek] = useState<Row[]>([]);

  useEffect(() => {
    if (sel) getTeamWeek(Number(sel)).then(setTeamWeek);
  }, [sel]);

  const teamGrades = useMemo(
    () =>
      grades
        .filter((r) => String(r.Season) === sel && String(r.Team) === team)
        .sort((a, b) => Number(a.Week) - Number(b.Week)),
    [grades, sel, team],
  );
  const weeks = teamGrades.map((r) => Number(r.Week));
  const maxWeek = weeks.length ? Math.max(...weeks) : 1;
  const tw = throughWeek != null && weeks.includes(throughWeek) ? throughWeek : maxWeek;

  const params = contribParams[gradeType];
  const teamMeta = meta.get(team);
  const color1 = teamMeta?.color ?? "#333333";
  const color2 = teamMeta?.color2 ?? "#777777";

  const twRowOf = useMemo(() => {
    const m = new Map<number, Row>();
    for (const r of teamWeek) if (String(r.team) === team) m.set(Number(r.week), r);
    return m;
  }, [teamWeek, team]);

  // per-week contributions for all weeks of the season (all features, sorted)
  const contribsByWeek = useMemo(() => {
    if (!params) return new Map<number, ReturnType<typeof weekContributions>>();
    const m = new Map<number, ReturnType<typeof weekContributions>>();
    for (const wk of weeks) {
      const row = twRowOf.get(wk);
      if (row) m.set(wk, weekContributions(row, params));
    }
    return m;
  }, [params, weeks.join(","), twRowOf]);

  // ---- Weekly stacked contributions (top-N per week, scaled to grade) ----
  const stackedOption = useMemo<EChartsOption | null>(() => {
    if (!teamGrades.length || !params) return null;
    const weekMaps: Map<string, number>[] = [];
    const union = new Set<string>();
    const gradeVals: number[] = [];
    for (const g of teamGrades) {
      const wk = Number(g.Week);
      const grade = Number(g[gradeType]);
      gradeVals.push(grade);
      const contribs = contribsByWeek.get(wk);
      const m = new Map<string, number>();
      if (contribs && Number.isFinite(grade)) {
        const top = contribs.slice(0, topN);
        const sumTop = top.reduce((s, c) => s + c.contribution, 0);
        const scale = sumTop > 1e-12 ? grade / sumTop : 0;
        for (const c of top) {
          m.set(c.feature, c.contribution * scale);
          union.add(c.feature);
        }
      }
      weekMaps.push(m);
    }
    const feats = [...union];
    const totals = new Map<string, number>();
    for (const m of weekMaps) for (const [f, v] of m) totals.set(f, (totals.get(f) ?? 0) + v);
    feats.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    const colors = teamPalette(feats.length, color1, color2);
    const avg = gradeVals.filter(Number.isFinite).reduce((a, b) => a + b, 0) / (gradeVals.filter(Number.isFinite).length || 1);

    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { seriesName: string; name: string; value: number };
          return `${q.seriesName.replace(/_/g, " ")}<br/>Week ${q.name}: ${Number(q.value).toFixed(2)}`;
        },
      },
      xAxis: { type: "category", data: weeks.map(String), name: "Week", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", min: 0, max: 105, name: "Grade" },
      series: [
        ...feats.map((f, i) => ({
          name: f,
          type: "bar" as const,
          stack: "c",
          itemStyle: { color: colors[i] },
          data: weekMaps.map((m) => +(m.get(f) ?? 0).toFixed(3)),
        })),
        {
          name: "Season Avg",
          type: "line" as const,
          data: weeks.map(() => +avg.toFixed(2)),
          symbol: "none",
          lineStyle: { type: "dashed" as const, color: "gray", width: 2 },
          tooltip: { show: false },
        },
        {
          name: "Grade",
          type: "line" as const,
          data: gradeVals.map((g) => +g.toFixed(1)),
          symbol: "none",
          lineStyle: { opacity: 0 },
          label: { show: true, position: "top", fontSize: 12, formatter: (p: { value?: unknown }) => `${Math.round(Number(p.value))}` },
          tooltip: { show: false },
        },
      ],
    } as EChartsOption;
  }, [teamGrades, params, contribsByWeek, topN, gradeType, color1, color2, weeks.join(",")]);

  // ---- windowed aggregates (weeks <= through week) ----
  const windowAgg = useMemo(() => {
    const inScope = teamGrades.filter((g) => Number(g.Week) <= tw);
    const meanSigned = new Map<string, number>(); // sum of signed
    const scaledSum = new Map<string, number>();
    const rawByWeek = new Map<number, Map<string, number>>();
    let usedWeeks = 0;
    let cnt = 0;
    for (const g of inScope) {
      const wk = Number(g.Week);
      const contribs = contribsByWeek.get(wk);
      if (!contribs) continue;
      cnt++;
      for (const c of contribs) meanSigned.set(c.feature, (meanSigned.get(c.feature) ?? 0) + c.signed);
      const grade = Number(g[gradeType]);
      const rawTotal = contribs.reduce((s, c) => s + c.contribution, 0);
      rawByWeek.set(wk, new Map(contribs.map((c) => [c.feature, c.raw])));
      if (Number.isFinite(grade) && rawTotal > 1e-12) {
        const scale = grade / rawTotal;
        for (const c of contribs) scaledSum.set(c.feature, (scaledSum.get(c.feature) ?? 0) + c.contribution * scale);
        usedWeeks++;
      }
    }
    // weeks the team actually has a grade for (byes/missing data excluded) —
    // drives the averaging divisor, unchanged from before.
    const playedWeeks = inScope.map((g) => Number(g.Week));
    // full week range for display, so a bye week gets its own labeled column
    // instead of silently vanishing from the table (audit: "W10 absent for DAL").
    const rangeStart = weeks[0] ?? 1;
    const displayWeeks: number[] = [];
    for (let w = rangeStart; w <= tw; w++) displayWeeks.push(w);
    const playedSet = new Set(playedWeeks);
    const byeWeeks = new Set(displayWeeks.filter((w) => !playedSet.has(w)));
    return { meanSigned, cnt, scaledSum, usedWeeks, rawByWeek, weeksInScope: playedWeeks, displayWeeks, byeWeeks };
  }, [teamGrades, tw, contribsByWeek, gradeType, weeks.join(",")]);

  // ---- Top Drivers (mean signed contribution) ----
  const driversOption = useMemo<EChartsOption | null>(() => {
    const { meanSigned, cnt } = windowAgg;
    if (!cnt || !meanSigned.size) return null;
    const rows = [...meanSigned.entries()]
      .map(([f, s]) => ({ f, mean: s / cnt }))
      .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))
      .slice(0, topN)
      .reverse();
    return {
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { name: string; value: number };
          return `${q.name}<br/>Mean signed contrib: ${Number(q.value).toFixed(4)}`;
        },
      },
      xAxis: { type: "value", name: "Mean Signed Contribution" },
      yAxis: { type: "category", data: rows.map((r) => r.f.replace(/_/g, " ")), axisLabel: { fontSize: 10 } },
      series: [{ type: "bar", data: rows.map((r) => +r.mean.toFixed(4)), itemStyle: { color: color1 } }],
    } as EChartsOption;
  }, [windowAgg, topN, color1]);

  // ---- Waterfall (average scaled contributions) ----
  const waterfallOption = useMemo<EChartsOption | null>(() => {
    const { scaledSum, usedWeeks } = windowAgg;
    if (!usedWeeks || !scaledSum.size) return null;
    const mean = [...scaledSum.entries()].map(([f, v]) => ({ f, v: v / usedWeeks }));
    const target = mean.reduce((s, m) => s + m.v, 0);
    mean.sort((a, b) => b.v - a.v);
    const top = mean.slice(0, topN);
    const other = Math.max(0, target - top.reduce((s, m) => s + m.v, 0));
    const steps = [...top.map((m) => ({ name: m.f.replace(/_/g, " "), v: m.v })), ...(other > 1e-12 ? [{ name: "Other", v: other }] : [])];
    const cats = [...steps.map((s) => s.name), "Avg Grade"];
    let cum = 0;
    const base: number[] = [];
    const vals: number[] = [];
    for (const s of steps) {
      base.push(cum);
      vals.push(s.v);
      cum += s.v;
    }
    base.push(0);
    vals.push(target);
    return {
      grid: { left: 10, right: 10, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { name: string; dataIndex: number; seriesName: string };
          return `${q.name}: ${vals[q.dataIndex].toFixed(2)}`;
        },
      },
      xAxis: { type: "category", data: cats, axisLabel: { rotate: -45, fontSize: 10 } },
      yAxis: { type: "value", name: "Points toward Average Grade" },
      series: [
        { type: "bar", stack: "wf", itemStyle: { color: "transparent" }, tooltip: { show: false }, data: base },
        {
          type: "bar",
          stack: "wf",
          data: vals.map((v, i) => ({
            value: +v.toFixed(2),
            itemStyle: { color: i === vals.length - 1 ? color2 : color1 },
          })),
          label: { show: true, position: "top", fontSize: 9, formatter: (p: { value?: unknown }) => Number(p.value).toFixed(1) },
        },
      ],
    } as EChartsOption;
  }, [windowAgg, topN, color1, color2]);

  // ---- Drivers stats table ----
  const driversTable = useMemo(() => {
    const { scaledSum, usedWeeks, rawByWeek, weeksInScope, displayWeeks, byeWeeks } = windowAgg;
    if (!usedWeeks || !scaledSum.size) return null;
    // avg scaled contribution over ALL weeks in scope (missing = 0), like the old np.mean over weeks_in_scope
    const nWeeks = weeksInScope.length || 1;
    const avgScaled = new Map([...scaledSum.entries()].map(([f, v]) => [f, v / nWeeks]));
    const top = [...avgScaled.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    return {
      weeks: displayWeeks,
      byeWeeks,
      rows: top.map(([f, avgCont]) => {
        const raws = displayWeeks.map((wk) => (byeWeeks.has(wk) ? null : rawByWeek.get(wk)?.get(f) ?? null));
        const clean = raws.filter((v): v is number => v != null && Number.isFinite(v));
        return {
          feature: f.replace(/_/g, " "),
          raws,
          avg: clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null,
          avgCont,
        };
      }),
    };
  }, [windowAgg, topN]);

  // ---- Stat trend chart ----
  const statOptions = useMemo(() => {
    if (!teamWeek.length) return [];
    const cols = Object.keys(teamWeek[0]).filter((c) => typeof teamWeek[0][c] === "number" || teamWeek.some((r) => typeof r[c] === "number"));
    const set = new Set(cols);
    return cols
      .filter((c) => !c.endsWith("_allowed") && set.has(`${c}_allowed`) && c !== "season" && c !== "week")
      .sort();
  }, [teamWeek]);
  const statGroups = useMemo(() => buildStatGroups(statOptions, "offense"), [statOptions]);
  const [stat, setStat] = useState("passing_epa");
  const selStat = statOptions.includes(stat) ? stat : statOptions[0] ?? "";

  const statOption = useMemo<EChartsOption | null>(() => {
    if (!selStat) return null;
    const rows = teamWeek
      .filter((r) => String(r.team) === team)
      .sort((a, b) => Number(a.week) - Number(b.week));
    if (!rows.length) return null;
    const xs = rows.map((r) => String(r.week));
    const main = rows.map((r) => (r[selStat] == null ? null : +Number(r[selStat]).toFixed(3)));
    const allowedCol = `${selStat}_allowed`;
    const allowed = rows.map((r) => (r[allowedCol] == null ? null : +Number(r[allowedCol]).toFixed(3)));
    const mean = (arr: (number | null)[]) => {
      const v = arr.filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const avgMain = mean(main);
    const avgAllowed = mean(allowed);
    const opps = rows.map((r) => opponentLabel(String(r.game_id ?? ""), team));
    const title = statLabel(selStat);
    return {
      grid: { left: 10, right: 15, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const ps = params as { seriesName: string; value: number | null; dataIndex: number }[];
          const idx = ps[0]?.dataIndex ?? 0;
          return [`Week ${xs[idx]} — Opponent: ${opps[idx] || "—"}`, ...ps.filter((p) => p.value != null).map((p) => `${p.seriesName}: ${Number(p.value).toFixed(2)}`)].join("<br/>");
        },
      },
      xAxis: { type: "category", data: xs, name: "Week", nameLocation: "middle", nameGap: 26 },
      yAxis: { type: "value", name: title },
      series: [
        { name: title, type: "line", data: main, lineStyle: { width: 3, color: color1 }, itemStyle: { color: color1 }, symbolSize: 8 },
        ...(avgMain != null ? [{ name: `Avg (${title})`, type: "line" as const, data: xs.map(() => +avgMain.toFixed(3)), symbol: "none", lineStyle: { type: "dotted" as const, color: "red", width: 1.5 }, tooltip: { show: false } }] : []),
        { name: `${title} Allowed`, type: "line", data: allowed, lineStyle: { width: 3, color: color2 }, itemStyle: { color: color2 }, symbolSize: 8 },
        ...(avgAllowed != null ? [{ name: `Avg (${title} Allowed)`, type: "line" as const, data: xs.map(() => +avgAllowed.toFixed(3)), symbol: "none", lineStyle: { type: "dotted" as const, color: "blue", width: 1.5 }, tooltip: { show: false } }] : []),
      ],
    } as EChartsOption;
  }, [teamWeek, team, selStat, color1, color2]);

  const stackedRef = useECharts(stackedOption);
  const driversRef = useECharts(driversOption);
  const waterfallRef = useECharts(waterfallOption);
  const statRef = useECharts(statOption);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Select label="Season" value={sel} onChange={onSeasonChange} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Team" value={team} onChange={onTeamChange} options={teams.map((t) => ({ value: t, label: meta.get(t)?.name ?? t }))} />
        <div className="flex gap-2">
          {GRADE_OPTS.map((g) => (
            <button key={g} onClick={() => setGradeType(g)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${gradeType === g ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
              {g.replace(" Grade", "")}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Through week: {tw}
          <input type="range" min={weeks[0] ?? 1} max={maxWeek} step={1} value={tw} onChange={(e) => setThroughWeek(Number(e.target.value))} className="w-48" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Top N drivers: {topN}
          <input type="range" min={3} max={12} step={1} value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="w-48" />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">
          {meta.get(team)?.name ?? team} – {gradeType} Contributions by Week ({sel})
        </h3>
        <div ref={stackedRef} className="h-[520px]" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Top Drivers (Average, Weeks 1–{tw})</h3>
          <div ref={driversRef} className="h-[420px]" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Grade Waterfall (Average, Weeks 1–{tw})</h3>
          <div ref={waterfallRef} className="h-[420px]" />
        </div>
      </div>

      {driversTable && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Top Drivers – Actual Stats</h3>
          <p className="mb-2 text-xs text-slate-500">
            Top {topN} drivers ranked by average contribution. Each week's cell is the raw stat that game.{" "}
            <b className="text-slate-700">Avg (raw)</b> is that stat's mean across played weeks — a real-world number (yards, EPA, etc.).{" "}
            <b className="text-slate-700">Avg. contrib. (pts)</b> is a different unit: how many of the 0–100 grade's points that stat contributed on average, once weighted and scaled. A stat can average high in raw terms but contribute little to the grade, or vice versa.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2 py-2">Feature</th>
                  {driversTable.weeks.map((w) => (
                    <th key={w} className="px-2 py-2 text-right">W{w}</th>
                  ))}
                  <th className="bg-slate-200/70 px-2 py-2 text-right" title="Mean raw stat value across played weeks">Avg (raw)</th>
                  <th className="bg-slate-200/70 px-2 py-2 text-right" title="Mean scaled contribution toward the 0–100 grade">Avg. contrib. (pts)</th>
                </tr>
              </thead>
              <tbody>
                {driversTable.rows.map((r) => (
                  <tr key={r.feature} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-semibold">{r.feature}</td>
                    {r.raws.map((v, i) => {
                      const wk = driversTable.weeks[i];
                      if (driversTable.byeWeeks.has(wk)) return <td key={i} className="px-2 py-1.5 text-right italic text-slate-400">Bye</td>;
                      return <td key={i} className="px-2 py-1.5 text-right">{v == null ? "—" : v.toFixed(2)}</td>;
                    })}
                    <td className="bg-slate-100/70 px-2 py-1.5 text-right">{r.avg == null ? "—" : r.avg.toFixed(2)}</td>
                    <td className="bg-slate-100/70 px-2 py-1.5 text-right">{r.avgCont.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-end gap-4">
          <Select label="Select Stat" value={selStat} onChange={setStat} groups={statGroups} />
        </div>
        <div ref={statRef} className="h-[520px]" />
      </div>
    </div>
  );
}
