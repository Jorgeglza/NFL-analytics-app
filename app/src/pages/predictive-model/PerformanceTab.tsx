// Explore predicted-vs-actual performance per game, filterable by season/team.
// Two modes, toggled by the "Points" / "%" control: Points explores the raw
// margin regression's continuous "how wrong" (its main advantage over a
// plain classifier — see docs/predictive-model-decision.md); % explores the
// derived win-probability surface and whether it's actually well-calibrated
// (does a 70% prediction happen ~70% of the time?), which is a different
// question from "did it pick the right team."
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, FilterGroup, Kpi, Segmented, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { WIN_TYPE_COLORS, type WinType } from "../../lib/logic/winType";
import {
  ALL_SEASONS,
  ALL_TEAMS,
  accuracyByWeek,
  accuracyOf,
  atsAccuracyOf,
  bestThreshold,
  buildMarginHeatmap,
  calibrationByWeek,
  calibrationBySeason,
  CATEGORY_ORDER,
  categoryCode,
  categoryOf,
  categoryStats,
  categoryStatsByWeek,
  FAVORITE_LOCATION_ORDER,
  favoriteLocationOf,
  favoriteLocationStats,
  favoriteLocationStatsByWeek,
  filterGames,
  isCellCorrect,
  isCorrect,
  isCorrectAtThreshold,
  matchupLabel,
  missComparison,
  pct,
  reliabilityBuckets,
  scoreLabel,
  seasonOptions,
  teamOptions,
  UNCATEGORIZED_CATEGORY,
  UNCATEGORIZED_COLOR,
  type Heatmap,
} from "./shared";

const CALIBRATION_TOLERANCE_PCT = 0.1; // >10pt gap between predicted and observed is "miscalibrated"

type Category = WinType | typeof UNCATEGORIZED_CATEGORY;
const colorOf = (c: Category) => (c === UNCATEGORIZED_CATEGORY ? UNCATEGORIZED_COLOR : WIN_TYPE_COLORS[c as WinType]);
const shortLabel = (c: Category) => (c === UNCATEGORIZED_CATEGORY ? "Tie / no spread" : c);

/** Blends a hex color toward white — used for the "wrong pick" segment of
 * the category bar so it reads as an obviously lighter tint of the same
 * category color, not an unrelated color. */
function lighten(hex: string, amount = 0.6): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

type Mode = "Points" | "%";
type Grouping = "Outcome" | "Pregame";

/** Small hover-only info marker — matches the app's existing convention of a
 * native `title` attribute for "nothing obvious until hovered" hints. */
function InfoDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 align-middle"
    >
      i
    </span>
  );
}

/** Shared heatmap chart-option builder for both the margin and probability
 * grids — same visual grammar (N-labeled cells, blue/red correctness
 * outline with ties going red, dashed diagonal/threshold reference). */
function heatmapOptionOf(heatmap: Heatmap, opts: { xName: string; yName: string; xGap: number; yGap: number; diagonal: boolean }): EChartsOption | null {
  if (!heatmap.cells.length) return null;
  const maxCellN = Math.max(1, ...heatmap.cells.map((c) => c.n));
  const series: EChartsOption["series"] = [
    {
      type: "heatmap",
      data: heatmap.cells.map((c) => ({
        value: [c.xi, c.yi, c.n],
        xi: c.xi,
        yi: c.yi,
        n: c.n,
        correctShare: c.correctShare,
        itemStyle: {
          borderColor: isCellCorrect(c.correctShare) ? "#2563eb" : "#dc2626",
          borderWidth: 2,
        },
        label: { show: true, formatter: () => String(c.n), fontSize: 9, fontWeight: "bold" as const },
      })),
      label: { show: true },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
      z: 2,
    },
  ];
  if (opts.diagonal) {
    const n = Math.min(heatmap.xLabels.length, heatmap.yLabels.length);
    series.push({
      type: "line",
      data: Array.from({ length: n }, (_, i) => [i, i]),
      lineStyle: { color: "#0f172a", type: "dashed", width: 2 },
      symbol: "none",
      silent: true,
      tooltip: { show: false },
      z: 3,
    });
  }
  return {
    grid: { left: 90, right: 20, top: 30, bottom: 70, containLabel: false },
    tooltip: {
      formatter: (p: unknown) => {
        const pt = p as { data: { xi: number; yi: number; n: number; correctShare: number | null } };
        const { xi, yi, n, correctShare } = pt.data;
        return `${opts.xName}: ${heatmap.xLabels[xi]}<br/>${opts.yName}: ${heatmap.yLabels[yi]}<br/>n=${n} — ${pct(correctShare)} correct`;
      },
    },
    xAxis: {
      type: "category",
      data: heatmap.xLabels,
      name: opts.xName,
      nameLocation: "middle",
      nameGap: opts.xGap,
      axisLabel: { rotate: 45, fontSize: 9 },
    },
    yAxis: {
      type: "category",
      data: heatmap.yLabels,
      name: opts.yName,
      nameLocation: "middle",
      nameGap: opts.yGap,
      nameRotate: 90,
      axisLabel: { fontSize: 9 },
    },
    visualMap: {
      min: 0,
      max: maxCellN,
      right: 0,
      top: "center",
      calculable: false,
      text: ["N", ""],
      inRange: { color: ["#eff6ff", "#bfdbfe", "#60a5fa", "#1d4ed8"] },
    },
    series,
  } as EChartsOption;
}

export default function PerformanceTab({ games }: { games: Row[] }) {
  const [season, setSeason] = useState(ALL_SEASONS);
  const [team, setTeam] = useState(ALL_TEAMS);
  const [mode, setMode] = useState<Mode>("Points");
  const [grouping, setGrouping] = useState<Grouping>("Outcome");
  // Decision cutoff (% home win probability) for the granular chart's
  // section only — dragged directly on the chart. Scoped here rather than
  // touching accuracyOf/isCorrect globally: the top KPI row and Points-mode
  // charts keep the standard 50% definition of "correct."
  const [thresholdPct, setThresholdPct] = useState(50);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(new Set(CATEGORY_ORDER));
  const toggleCategory = (c: Category) =>
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const seasons = useMemo(() => seasonOptions(games), [games]);
  const teams = useMemo(() => teamOptions(games), [games]);
  const filtered = useMemo(() => filterGames(games, season, team), [games, season, team]);

  const acc = accuracyOf(filtered);
  const ats = atsAccuracyOf(filtered);
  const correctFn = useCallback((g: Row) => isCorrectAtThreshold(g, thresholdPct), [thresholdPct]);
  const catStats = useMemo(() => categoryStats(filtered, correctFn), [filtered, correctFn]);
  const favStats = useMemo(() => favoriteLocationStats(filtered, correctFn), [filtered, correctFn]);
  // Single pooled number for the cutoff readout — same graded subset as the
  // granular chart itself (ungraded games have no home_win_prob to compare
  // against a threshold), so this always matches "sum of the chips below."
  const accAtThreshold = useMemo(() => {
    const graded = filtered.filter((g) => g.home_win_prob !== null);
    if (!graded.length) return null;
    return { acc: graded.filter(correctFn).length / graded.length, n: graded.length };
  }, [filtered, correctFn]);
  // The cutoff that would have maximized pooled accuracy on the games
  // currently in view — a quick "how good could this get" reference point,
  // not a recommendation to actually pick games this way (see the tooltip).
  const optimalThreshold = useMemo(() => bestThreshold(filtered), [filtered]);
  // "Outcome" (default) crosses the spread's favorite with the actual
  // winner (4 buckets, only knowable post-game); "Pregame" groups by
  // favorite location alone (2 buckets, knowable before kickoff) — for
  // isolating pre-game model accuracy without outcome leakage in the
  // grouping itself.
  const activeCatOrder = grouping === "Outcome" ? CATEGORY_ORDER : FAVORITE_LOCATION_ORDER;
  const activeCategoryOf = grouping === "Outcome" ? categoryOf : favoriteLocationOf;
  const activeCatStats = grouping === "Outcome" ? catStats : favStats;

  // --- Points mode: predicted vs. actual margin ---
  const scatterOption = useMemo<EChartsOption | null>(() => {
    if (!filtered.length) return null;
    const points = filtered.map((g) => ({
      value: [Number(g.predicted_margin), Number(g.actual_margin)] as [number, number],
      name: `${g.season} wk${g.week} ${matchupLabel(g)}`,
      correct: isCorrect(g),
      winProb: g.home_win_prob === null ? null : Number(g.home_win_prob),
    }));
    const maxAbs = Math.max(30, ...points.map((p) => Math.max(Math.abs(p.value[0]), Math.abs(p.value[1])))) * 1.05;
    const tooltipFormatter = (p: unknown) => {
      const pt = p as { data: { name: string; value: [number, number]; winProb: number | null } };
      const winProbLine = pt.data.winProb !== null ? `<br/>predicted home win prob ${pct(pt.data.winProb)}` : "";
      return `${pt.data.name}<br/>predicted ${pt.data.value[0].toFixed(1)} vs actual ${pt.data.value[1].toFixed(1)}${winProbLine}`;
    };
    return {
      // Generous, explicit padding (rather than relying only on containLabel)
      // so both axis titles have guaranteed room and never get clipped.
      grid: { left: 60, right: 30, top: 40, bottom: 60, containLabel: false },
      legend: { top: 0, data: ["Correct pick", "Wrong pick"] },
      tooltip: { formatter: tooltipFormatter },
      xAxis: {
        type: "value",
        name: "Predicted margin (home − away, pts)",
        nameLocation: "middle",
        nameGap: 32,
        min: -maxAbs,
        max: maxAbs,
      },
      yAxis: {
        type: "value",
        name: "Actual margin (home − away, pts)",
        nameLocation: "middle",
        nameGap: 42,
        nameRotate: 90,
        min: -maxAbs,
        max: maxAbs,
      },
      series: [
        {
          type: "line",
          data: [
            [-maxAbs, -maxAbs],
            [maxAbs, maxAbs],
          ],
          name: "Perfect prediction",
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          z: 1,
        },
        {
          name: "Correct pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#2563eb", opacity: 0.55 },
          data: points.filter((p) => p.correct),
          z: 2,
        },
        {
          name: "Wrong pick",
          type: "scatter",
          symbolSize: 6,
          itemStyle: { color: "#dc2626", opacity: 0.55 },
          data: points.filter((p) => !p.correct),
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [filtered]);
  const scatterRef = useECharts(scatterOption);

  // --- % mode: reliability diagram — the standard "is this probability
  // itself accurate" chart (bins predicted probability, plots mean
  // predicted vs. observed rate per bin against the perfect-calibration
  // diagonal). Bubble size = N in that bin. This replaces an earlier
  // jittered predicted-vs-binary-outcome scatter, which was much noisier
  // to read than the margin scatter it sat next to — a reliability diagram
  // is the neat, purpose-built equivalent for a probability surface. */
  const reliability = useMemo(() => reliabilityBuckets(filtered, 10), [filtered]);
  const reliabilityOption = useMemo<EChartsOption | null>(() => {
    if (!reliability.length) return null;
    const maxN = Math.max(1, ...reliability.map((b) => b.n));
    const points = reliability.map((b) => ({
      value: [b.meanPredicted * 100, b.observedRate * 100] as [number, number],
      n: b.n,
      binLo: b.binLo * 100,
      binHi: b.binHi * 100,
      wellCalibrated: Math.abs(b.meanPredicted - b.observedRate) <= CALIBRATION_TOLERANCE_PCT,
    }));
    const sizeOf = (_value: unknown, params: { data: { n: number } }) => 10 + 30 * Math.sqrt(params.data.n / maxN);
    return {
      grid: { left: 60, right: 30, top: 40, bottom: 60, containLabel: false },
      legend: { top: 0, data: ["Well-calibrated bucket", "Miscalibrated bucket"] },
      tooltip: {
        formatter: (p: unknown) => {
          const pt = p as { data: { binLo: number; binHi: number; n: number; value: [number, number] } };
          return `Predicted ${pt.data.binLo.toFixed(0)}-${pt.data.binHi.toFixed(0)}% bucket (n=${pt.data.n})<br/>Avg predicted ${pt.data.value[0].toFixed(1)}%<br/>Observed win rate ${pt.data.value[1].toFixed(1)}%`;
        },
      },
      xAxis: { type: "value", name: "Mean predicted win probability", nameLocation: "middle", nameGap: 32, min: 0, max: 100 },
      yAxis: { type: "value", name: "Observed win rate", nameLocation: "middle", nameGap: 42, nameRotate: 90, min: 0, max: 100 },
      series: [
        {
          type: "line",
          name: "Perfect calibration",
          data: [
            [0, 0],
            [100, 100],
          ],
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          z: 1,
        },
        {
          name: "Well-calibrated bucket",
          type: "scatter",
          itemStyle: { color: "#2563eb", opacity: 0.75 },
          data: points.filter((p) => p.wellCalibrated),
          symbolSize: sizeOf,
          z: 2,
        },
        {
          name: "Miscalibrated bucket",
          type: "scatter",
          itemStyle: { color: "#dc2626", opacity: 0.75 },
          data: points.filter((p) => !p.wellCalibrated),
          symbolSize: sizeOf,
          z: 2,
        },
      ],
    } as EChartsOption;
  }, [reliability]);
  const reliabilityRef = useECharts(reliabilityOption);

  // Granular per-game view: the reliability diagram above is bucketed (10
  // games' worth of confidence collapse into one dot); this plots every
  // individual game's predicted probability against its actual margin
  // (continuous, so no jitter hack needed — unlike a binary-outcome axis),
  // colored by the same home/away favorite/underdog categories used
  // everywhere else in the app (Game Picks, Win Types, Spread Win %) so this
  // reads consistently with the rest of the deployment rather than
  // introducing a new color language just for this page.
  const granularOption = useMemo<EChartsOption | null>(() => {
    const graded = filtered.filter((g) => g.home_win_prob !== null);
    if (!graded.length) return null;
    type Pt = {
      value: [number, number];
      name: string;
      score: string | null;
      category: Category;
      correct: boolean;
      predictedMargin: number;
      symbolSize: number;
      itemStyle: { borderColor: string; borderWidth: number };
    };
    const byType = new Map<Category, Pt[]>();
    graded.forEach((g) => {
      const key = activeCategoryOf(g);
      const correct = correctFn(g);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push({
        value: [Number(g.home_win_prob) * 100, Number(g.actual_margin)],
        name: `${g.season} wk${g.week} ${matchupLabel(g)}`,
        score: scoreLabel(g),
        category: key,
        correct,
        predictedMargin: Number(g.predicted_margin),
        // Correct picks get a bold dark outline and sit slightly larger so
        // they visibly stand out over wrong picks — otherwise the fill
        // color only tells you the matchup type, not who actually won.
        symbolSize: correct ? 10 : 6,
        itemStyle: { borderColor: correct ? "#0f172a" : "transparent", borderWidth: correct ? 2 : 0 },
      });
    });
    // Draw wrong picks first, correct picks last, so a correct pick's bold
    // outline never gets hidden underneath an overlapping wrong one.
    byType.forEach((pts) => pts.sort((a, b) => Number(a.correct) - Number(b.correct)));
    const maxAbsMargin = Math.max(20, ...graded.map((g) => Math.abs(Number(g.actual_margin)))) * 1.05;
    const tooltipFormatter = (p: unknown) => {
      const pt = (p as { data: Pt }).data;
      // Line 1: matchup (predicted winner bold, actual winner green).
      // Line 2: category code (colored by category, bold + green when correct) + score.
      // Line 3: predicted home win probability.
      // Line 4: predicted vs. actual margin, abbreviated onto one line.
      const codeStyle = pt.correct ? "font-weight:700;color:#059669;" : `color:${colorOf(pt.category)};font-weight:600;`;
      const codeAndScore = pt.score !== null
        ? `<span style="${codeStyle}">${categoryCode(pt.category)}</span>, ${pt.score}`
        : `<span style="${codeStyle}">${categoryCode(pt.category)}</span>`;
      const predSign = pt.predictedMargin >= 0 ? "+" : "";
      return (
        `${pt.name}` +
        `<br/>${codeAndScore}` +
        `<br/>predicted home win prob ${pt.value[0].toFixed(0)}%` +
        `<br/>Pred ${predSign}${pt.predictedMargin.toFixed(1)} pts | Act ${pt.value[1].toFixed(1)} pts`
      );
    };
    // The category KPI row above doubles as the legend/filter (per request),
    // so no chart legend here — only active categories get a series at all.
    const orderedKeys = activeCatOrder.filter((k) => byType.has(k) && activeCategories.has(k));
    return {
      grid: { left: 60, right: 30, top: 10, bottom: 60, containLabel: false },
      tooltip: { formatter: tooltipFormatter },
      xAxis: { type: "value", name: "Predicted home win probability (%)", nameLocation: "middle", nameGap: 32, min: 0, max: 100 },
      yAxis: { type: "value", name: "Actual margin (home − away, pts)", nameLocation: "middle", nameGap: 42, nameRotate: 90, min: -maxAbsMargin, max: maxAbsMargin },
      series: [
        {
          id: "threshold-line",
          type: "line",
          data: [[thresholdPct, -maxAbsMargin], [thresholdPct, maxAbsMargin]],
          lineStyle: { color: "#0f172a", type: "solid", width: 2 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          label: {
            show: true,
            formatter: () => `${thresholdPct.toFixed(0)}% cutoff`,
            position: "insideEndTop",
            fontSize: 10,
            fontWeight: "bold" as const,
            color: "#0f172a",
          },
          z: 3,
        },
        {
          type: "line",
          data: [[0, 0], [100, 0]],
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          z: 1,
        },
        ...orderedKeys.map((key) => ({
          name: key,
          type: "scatter" as const,
          itemStyle: { color: colorOf(key), opacity: 0.8 },
          data: byType.get(key) ?? [],
          z: 2,
        })),
      ],
    } as EChartsOption;
  }, [filtered, activeCategories, grouping, activeCategoryOf, activeCatOrder, correctFn, thresholdPct]);
  const granularChartRef = useRef<ECharts | null>(null);
  const granularRef = useECharts(granularOption, {
    onInit: (chart) => {
      granularChartRef.current = chart;
    },
  });

  // Lets the cutoff line itself be dragged left/right instead of only set
  // via the reset button — grabbed via raw zrender mouse events (rather
  // than an ECharts `graphic` element) so hit-testing always uses the
  // chart's live pixel coordinates, which stays correct across resizes
  // without any manual pixel math. Re-attached whenever the % section
  // mounts (the chart div only exists once `mode === "%"`).
  const thresholdRef = useRef(thresholdPct);
  thresholdRef.current = thresholdPct;
  useEffect(() => {
    if (mode !== "%") return;
    const chart = granularChartRef.current;
    if (!chart) return;
    const zr = chart.getZr();
    const hitTestPx = 8;
    let dragging = false;

    const pixelXOfThreshold = () => chart.convertToPixel({ gridIndex: 0 }, [thresholdRef.current, 0])[0];
    const isNearLine = (offsetX: number) => Math.abs(offsetX - pixelXOfThreshold()) <= hitTestPx;

    const onMouseDown = (params: { offsetX: number }) => {
      if (isNearLine(params.offsetX)) dragging = true;
    };
    const onMouseMove = (params: { offsetX: number }) => {
      if (dragging) {
        const value = chart.convertFromPixel({ gridIndex: 0 }, [params.offsetX, 0])[0];
        setThresholdPct(Math.max(0, Math.min(100, value)));
      }
      zr.setCursorStyle(dragging || isNearLine(params.offsetX) ? "ew-resize" : "default");
    };
    const onMouseUp = () => {
      dragging = false;
    };

    zr.on("mousedown", onMouseDown);
    zr.on("mousemove", onMouseMove);
    zr.on("mouseup", onMouseUp);
    zr.on("globalout", onMouseUp);
    return () => {
      zr.off("mousedown", onMouseDown);
      zr.off("mousemove", onMouseMove);
      zr.off("mouseup", onMouseUp);
      zr.off("globalout", onMouseUp);
    };
  }, [mode]);

  // Same categories, broken down by week — does the model do better/worse
  // on (say) home favorites as the season progresses, not just in aggregate.
  // Horizontal + grouped + stacked: y = week, x = N games. Each category
  // gets its own small stacked bar (correct = solid category color, wrong =
  // a lighter tint) grouped side by side within that week's row — same
  // "stack shows the split, color contrast shows the accuracy" idea as the
  // category KPI chips above, just broken out per week instead of pooled.
  const catByWeek = useMemo(
    () => (grouping === "Outcome" ? categoryStatsByWeek(filtered, correctFn) : favoriteLocationStatsByWeek(filtered, correctFn)),
    [filtered, grouping, correctFn],
  );
  const catByWeekOption = useMemo<EChartsOption | null>(() => {
    if (!catByWeek.length) return null;
    const activeOrdered = activeCatOrder.filter((c) => activeCategories.has(c));
    if (!activeOrdered.length) return null;
    const weekLabels = catByWeek.map((r) => `Wk${r.week}`);
    type CellDatum = { value: number; category: Category; correct: number; wrong: number; n: number };
    const series: EChartsOption["series"] = [];
    activeOrdered.forEach((category) => {
      const cellOf = (weekIdx: number) => catByWeek[weekIdx].stats.find((s) => s.category === category);
      series.push({
        name: `${category} — correct`,
        type: "bar",
        stack: `stack-${category}`,
        itemStyle: { color: colorOf(category) },
        data: weekLabels.map((_, i) => {
          const s = cellOf(i);
          return { value: s?.correct ?? 0, category, correct: s?.correct ?? 0, wrong: s?.wrong ?? 0, n: s?.n ?? 0 } as CellDatum;
        }),
        label: {
          show: true,
          position: "inside",
          rotate: 90,
          color: "#fff",
          fontSize: 9,
          fontWeight: "bold" as const,
          formatter: (p: unknown) => {
            const d = (p as { data: CellDatum }).data;
            // Skip the label entirely at 0% (no correct picks) — a rotated
            // "0%" on a razor-thin or empty segment is just clutter.
            return d.n && d.correct > 0 ? pct(d.correct / d.n, 0) : "";
          },
        },
      });
      series.push({
        name: `${category} — wrong`,
        type: "bar",
        stack: `stack-${category}`,
        itemStyle: { color: lighten(colorOf(category)) },
        data: weekLabels.map((_, i) => {
          const s = cellOf(i);
          return { value: s?.wrong ?? 0, category, correct: s?.correct ?? 0, wrong: s?.wrong ?? 0, n: s?.n ?? 0 } as CellDatum;
        }),
      });
    });
    return {
      grid: { left: 50, right: 20, top: 10, bottom: 60, containLabel: false },
      tooltip: {
        formatter: (p: unknown) => {
          const pt = p as { name: string; data: CellDatum };
          return `${pt.name} — ${pt.data.category}<br/>Correct: ${pt.data.correct}<br/>Wrong: ${pt.data.wrong}<br/>Accuracy: ${pct(pt.data.n ? pt.data.correct / pt.data.n : null)} (n=${pt.data.n})`;
        },
      },
      xAxis: { type: "category", data: weekLabels, name: "Week", nameLocation: "middle", nameGap: 32 },
      yAxis: { type: "value", name: "Games (N)", nameLocation: "middle", nameGap: 32 },
      series,
    } as EChartsOption;
  }, [catByWeek, activeCategories, activeCatOrder]);
  const catByWeekRef = useECharts(catByWeekOption);

  const bySeasonTable = useMemo(() => {
    const seasonsAsc = Array.from(new Set(filtered.map((g) => Number(g.season)))).sort((a, b) => a - b);
    return seasonsAsc.map((s) => {
      const rows = filtered.filter((g) => Number(g.season) === s);
      return { season: s, n: rows.length, acc: accuracyOf(rows), ats: atsAccuracyOf(rows) };
    });
  }, [filtered]);

  const calibSeasonTable = useMemo(() => calibrationBySeason(filtered), [filtered]);

  const weekly = useMemo(() => accuracyByWeek(filtered), [filtered]);
  const weeklyOption = useMemo<EChartsOption | null>(() => {
    if (!weekly.length) return null;
    return {
      grid: { left: 10, right: 20, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const r = weekly[arr[0].dataIndex];
          return `Week ${r.week}<br/>${pct(r.acc)} (n=${r.n})`;
        },
      },
      xAxis: { type: "category", data: weekly.map((r) => `Wk${r.week}`), name: "Week" },
      yAxis: { type: "value", name: "Accuracy", min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        {
          type: "bar",
          data: weekly.map((r) => r.acc),
          itemStyle: { color: "#002f6c" },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, label: { formatter: "50%" }, data: [{ yAxis: 0.5 }] },
        },
      ],
    } as EChartsOption;
  }, [weekly]);
  const weeklyRef = useECharts(weeklyOption);

  const calibWeekly = useMemo(() => calibrationByWeek(filtered), [filtered]);
  const calibWeeklyOption = useMemo<EChartsOption | null>(() => {
    if (!calibWeekly.length) return null;
    return {
      grid: { left: 10, right: 20, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const r = calibWeekly[arr[0].dataIndex];
          return `Week ${r.week}<br/>Predicted ${pct(r.avgPredicted)}<br/>Observed ${pct(r.observedRate)} (n=${r.n})`;
        },
      },
      xAxis: { type: "category", data: calibWeekly.map((r) => `Wk${r.week}`), name: "Week" },
      yAxis: { type: "value", name: "Win probability", min: 0, max: 1, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        { name: "Avg predicted", type: "line", data: calibWeekly.map((r) => r.avgPredicted), lineStyle: { color: "#002f6c", width: 3 }, symbolSize: 6 },
        { name: "Observed", type: "line", data: calibWeekly.map((r) => r.observedRate), lineStyle: { color: "#dc2626", type: "dashed" }, symbolSize: 6 },
      ],
    } as EChartsOption;
  }, [calibWeekly]);
  const calibWeeklyRef = useECharts(calibWeeklyOption);

  const heatmap = useMemo(() => buildMarginHeatmap(filtered, 5), [filtered]);
  const heatmapOption = useMemo(
    () => heatmapOptionOf(heatmap, { xName: "Predicted margin bucket (pts)", yName: "Actual margin bucket (pts)", xGap: 44, yGap: 65, diagonal: true }),
    [heatmap],
  );
  const heatmapRef = useECharts(heatmapOption);

  // Calibration gap by bucket — a diverging bar chart built from the same
  // reliability buckets as the diagram above: shows exactly which
  // confidence ranges the model over/under-states, which is the "%" mode's
  // equivalent of "what's different about the misses" (a badly miscalibrated
  // bucket is where the probability itself is misleading, whether or not
  // any individual pick in it happened to be right).
  const gapOption = useMemo<EChartsOption | null>(() => {
    if (!reliability.length) return null;
    const gaps = reliability.map((b) => (b.meanPredicted - b.observedRate) * 100);
    return {
      grid: { left: 60, right: 20, top: 20, bottom: 60, containLabel: false },
      tooltip: {
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number }[];
          const b = reliability[arr[0].dataIndex];
          const gap = (b.meanPredicted - b.observedRate) * 100;
          return `Predicted ${(b.binLo * 100).toFixed(0)}-${(b.binHi * 100).toFixed(0)}% bucket (n=${b.n})<br/>Avg predicted ${pct(b.meanPredicted)}<br/>Observed ${pct(b.observedRate)}<br/>Gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}pt`;
        },
      },
      xAxis: {
        type: "category",
        data: reliability.map((b) => `${(b.binLo * 100).toFixed(0)}-${(b.binHi * 100).toFixed(0)}%`),
        name: "Predicted win probability bucket",
        nameLocation: "middle",
        nameGap: 44,
        axisLabel: { rotate: 45, fontSize: 10 },
      },
      yAxis: { type: "value", name: "Predicted − observed (pts)", nameLocation: "middle", nameGap: 42 },
      series: [
        {
          type: "bar",
          data: gaps.map((g) => ({
            value: g,
            itemStyle: { color: Math.abs(g) > CALIBRATION_TOLERANCE_PCT * 100 ? "#dc2626" : "#2563eb" },
          })),
          markLine: { symbol: "none", lineStyle: { color: "#0f172a" }, data: [{ yAxis: 0 }], label: { show: false } },
        },
      ],
    } as EChartsOption;
  }, [reliability]);
  const gapRef = useECharts(gapOption);

  const miss = useMemo(() => missComparison(filtered), [filtered]);
  const [correctStats, wrongStats] = miss;

  return (
    <div className="space-y-4">
      <FilterGroup label="Filter">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Season</span>
          <select value={season} onChange={(e) => setSeason(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15">
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15">
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <Segmented label="View" options={[{ value: "Points" as Mode, label: "Points" }, { value: "%" as Mode, label: "%" }]} value={mode} onChange={setMode} />
      </FilterGroup>

      <div className="flex flex-wrap gap-3">
        <Kpi label="Games in view" value={filtered.length} />
        <Kpi label="Straight-up accuracy" value={pct(acc)} />
        <Kpi label="ATS accuracy" value={pct(ats.acc)} sub={`n=${ats.n}`} accent="#dc2626" />
      </div>

      {mode === "Points" ? (
        <Card
          title={
            <span className="inline-flex items-center">
              Predicted vs. actual margin
              <InfoDot text="Predicted margin: the model's estimate of home score minus away score, made before kickoff. Actual margin: the real final-score differential. A point on the dashed diagonal is a perfect prediction; the further above/below it, the further off the model's margin was — even on games it still picked correctly." />
            </span>
          }
          subtitle="Each dot is one game. On the dashed line = perfect prediction. Blue = correct winner call, red = wrong."
        >
          <div ref={scatterRef} className="h-[520px]" />
        </Card>
      ) : (
        <Card
          title={
            <span className="inline-flex items-center">
              Reliability diagram
              <InfoDot text="Games are grouped into 10 buckets by predicted home win probability. Each dot is one bucket: x = the average probability the model actually predicted for games in it, y = the share of those games the home team actually won. A dot on the dashed diagonal means that bucket is perfectly calibrated (e.g. among games predicted ~70%, the home team really did win ~70% of the time); further from the line = more over/under-confident. Dot size = how many games are in that bucket." />
            </span>
          }
          subtitle="Bucketed by predicted probability. On the dashed diagonal = perfectly calibrated. Blue = within 10pt of the diagonal, red = off by more."
        >
          <div ref={reliabilityRef} className="h-[480px]" />
        </Card>
      )}

      {mode === "%" && (
        <Card
          title={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center">
                {grouping === "Outcome"
                  ? "Predicted probability vs. actual margin — by matchup type"
                  : "Predicted probability vs. actual margin — by pre-game favorite"}
                <InfoDot
                  text={
                    (grouping === "Outcome"
                      ? "Every game individually (no bucketing) — x = predicted home win probability, y = the real final-score margin. The horizontal line marks an actual tie. Fill color matches Game Picks / Win Types / Spread Win % elsewhere in the app: which side was favored by the closing spread, crossed with who actually won. The bold dark outline is separate — it marks games the model picked correctly (predicted side matched the actual winner); no outline means it picked wrong."
                      : "Every game individually (no bucketing) — x = predicted home win probability, y = the real final-score margin. Fill color shows only which side the closing spread favored (home or away) — known before kickoff, unlike the matchup-type view, which also depends on who actually won. This isolates pre-game model accuracy by favorite location. The bold dark outline marks games the model picked correctly; no outline means it picked wrong.") +
                    " The solid vertical line is the decision cutoff — drag it to see how accuracy shifts if the model called a game for whichever side crosses that probability instead of a flat 50%. Only this chart, the chips below, and the weekly breakdown react to it; the KPI row above and the Points-mode charts always use 50%."
                  }
                />
              </span>
              <Segmented
                label="Group by"
                options={[
                  { value: "Outcome" as Grouping, label: "Matchup type" },
                  { value: "Pregame" as Grouping, label: "Pre-game only" },
                ]}
                value={grouping}
                onChange={setGrouping}
              />
            </div>
          }
          subtitle={
            grouping === "Outcome"
              ? "Each dot is one game, colored by home/away favorite/underdog (closing spread, same as Game Picks/Win Types). A bold outline = the model's pick was correct; no outline = wrong. Click a category below to show/hide it."
              : "Each dot is one game, colored only by which side (home or away) the closing spread favored — known before kickoff, with no dependency on the result. A bold outline = the model's pick was correct; no outline = wrong. Click a category below to show/hide it."
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-slate-600">
              Decision cutoff: <span className="font-semibold text-slate-800">{thresholdPct.toFixed(0)}%</span> predicted home win probability
            </span>
            <span className="text-xs font-medium text-slate-600">
              Success rate at this cutoff:{" "}
              <span className="font-semibold text-slate-800">{pct(accAtThreshold?.acc ?? null)}</span>
              {accAtThreshold && <span className="text-slate-400"> (n={accAtThreshold.n})</span>}
            </span>
            {Math.round(thresholdPct) !== 50 && (
              <button
                onClick={() => setThresholdPct(50)}
                className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Reset to 50%
              </button>
            )}
            {optimalThreshold && (
              <button
                onClick={() => setThresholdPct(optimalThreshold.thresholdPct)}
                title={`Sets the cutoff to ${optimalThreshold.thresholdPct.toFixed(1)}%, the highest pooled accuracy (${pct(optimalThreshold.acc)}) achievable on the games currently in view — the best case, not a recommendation for how to actually pick games.`}
                className="rounded-full border border-[#002f6c]/30 bg-[#002f6c]/5 px-2.5 py-1 text-[11px] font-medium text-[#002f6c] hover:bg-[#002f6c]/10"
              >
                Maximize accuracy
              </button>
            )}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {activeCatStats.map((s) => {
              const active = activeCategories.has(s.category);
              return (
                <button
                  key={s.category}
                  onClick={() => toggleCategory(s.category)}
                  title={s.category}
                  className={`flex min-w-32 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-opacity ${
                    active ? "border-slate-200 bg-white shadow-sm" : "border-slate-100 bg-slate-50 opacity-40"
                  }`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(s.category) }} />
                  <span className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-700">{shortLabel(s.category)}</div>
                    <div className="text-[11px] text-slate-500">{pct(s.acc)} · n={s.n}</div>
                  </span>
                </button>
              );
            })}
          </div>
          <div ref={granularRef} className="h-[480px]" />
          <div className="mt-4">
            <h4 className="mb-1 text-sm font-semibold text-slate-700">Games and accuracy by category, per week</h4>
            <p className="mb-2 text-xs text-slate-500">
              Each week's column groups one stacked bar per active category (toggle above to show/hide) — bar height = N games, the solid segment is correct picks, the lighter segment is wrong.
            </p>
            <div ref={catByWeekRef} className="h-[420px]" />
          </div>
        </Card>
      )}

      {mode === "Points" ? (
        <Card title="Accuracy by season (current filter)">
          <div className={`overflow-x-auto ${tableWrapCls}`}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-3 py-2">Season</th>
                  <th className="px-3 py-2 text-right">Games</th>
                  <th className="px-3 py-2 text-right">Straight-up</th>
                  <th className="px-3 py-2 text-right">ATS</th>
                </tr>
              </thead>
              <tbody>
                {bySeasonTable.map((r) => (
                  <tr key={r.season} className={trCls}>
                    <td className="px-3 py-1.5 font-medium">{r.season}</td>
                    <td className="px-3 py-1.5 text-right">{r.n}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{pct(r.acc)}</td>
                    <td className="px-3 py-1.5 text-right text-rose-600">{pct(r.ats.acc)}</td>
                  </tr>
                ))}
                {!bySeasonTable.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">No games match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Calibration by season (current filter)" subtitle="Avg predicted probability vs. the rate the home team actually won — the gap is over/under-confidence, not pick accuracy">
          <div className={`overflow-x-auto ${tableWrapCls}`}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-3 py-2">Season</th>
                  <th className="px-3 py-2 text-right">Games</th>
                  <th className="px-3 py-2 text-right">Avg predicted</th>
                  <th className="px-3 py-2 text-right">Observed</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {calibSeasonTable.map((r) => (
                  <tr key={String(r.season)} className={`${trCls} ${r.season === "pooled" ? "bg-slate-50/70 font-semibold" : ""}`}>
                    <td className="px-3 py-1.5 font-medium">{r.season}</td>
                    <td className="px-3 py-1.5 text-right">{r.n}</td>
                    <td className="px-3 py-1.5 text-right">{pct(r.avgPredicted)}</td>
                    <td className="px-3 py-1.5 text-right">{pct(r.observedRate)}</td>
                    <td className={`px-3 py-1.5 text-right ${Math.abs(r.avgPredicted - r.observedRate) > 0.08 ? "text-rose-600" : "text-slate-500"}`}>
                      {r.avgPredicted - r.observedRate >= 0 ? "+" : ""}{((r.avgPredicted - r.observedRate) * 100).toFixed(1)}pt
                    </td>
                  </tr>
                ))}
                {!calibSeasonTable.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">No games match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {mode === "Points" ? (
        <Card title="Accuracy by week" subtitle="How the model performs at each point in the season, pooled across the current filter">
          <div ref={weeklyRef} className="h-[320px]" />
        </Card>
      ) : (
        <Card title="Calibration by week" subtitle="Avg predicted probability vs. observed win rate, pooled across the current filter">
          <div ref={calibWeeklyRef} className="h-[320px]" />
        </Card>
      )}

      {mode === "Points" ? (
        <Card
          title="What's different about the misses?"
          subtitle="Predicted vs. actual margin, bucketed. Cell = N games in that bucket pair. Blue outline = majority correct, red outline = majority wrong. Dashed diagonal = predicted matched actual exactly."
        >
          <div ref={heatmapRef} className="h-[560px]" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-xs font-semibold text-slate-600">Correct picks (n={correctStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg |predicted margin|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsPredicted?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg margin error</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsError?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div className="text-xs font-semibold text-rose-700">Wrong picks (n={wrongStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg |predicted margin|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsPredicted?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
                <div className="flex justify-between"><dt>Avg margin error</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsError?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            If the misses cluster in low-confidence buckets and low average spread lines, the model is failing exactly
            where you'd expect — close, hard-to-call games — rather than missing in ways that suggest a deeper problem.
          </p>
        </Card>
      ) : (
        <Card
          title="Calibration gap by bucket"
          subtitle="Predicted minus observed win rate for each probability bucket — the direction and size of over/under-confidence. Blue = within 10pt (well-calibrated), red = off by more."
        >
          <div ref={gapRef} className="h-[380px]" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-xs font-semibold text-slate-600">Correct picks (n={correctStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg confidence (|prob − 50%|)</dt><dd className="font-medium text-slate-700">{correctStats?.avgConfidencePct !== null && correctStats?.avgConfidencePct !== undefined ? pct(correctStats.avgConfidencePct) : "--"}</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{correctStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div className="text-xs font-semibold text-rose-700">Wrong picks (n={wrongStats?.n ?? 0})</div>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Avg confidence (|prob − 50%|)</dt><dd className="font-medium text-slate-700">{wrongStats?.avgConfidencePct !== null && wrongStats?.avgConfidencePct !== undefined ? pct(wrongStats.avgConfidencePct) : "--"}</dd></div>
                <div className="flex justify-between"><dt>Avg |spread line|</dt><dd className="font-medium text-slate-700">{wrongStats?.avgAbsSpread?.toFixed(1) ?? "--"} pts</dd></div>
              </dl>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Lower average confidence on the wrong picks means the model at least "knew" those games were closer calls —
            it wasn't confidently wrong.
          </p>
        </Card>
      )}
    </div>
  );
}
