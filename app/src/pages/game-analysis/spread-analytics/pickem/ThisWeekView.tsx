// Pick'em Recommendations — "This Week" sub-view. Single filter: a REG-season
// week NUMBER, aggregated across every season in the dataset (not a
// season+week pair like the other pickem views). Three sections: how the
// spread has behaved for this week number over the years, how the app's full
// model set has behaved on this week's games (card grid paginated by season,
// newest first — reuses the Matchup Previews game-card/dot-strip design), and
// whether the selected week's actual results correlate with each prior
// week's (expected to fade the further back you go).
import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { EChartsOption, CustomSeriesOption, CustomSeriesRenderItemAPI, CustomSeriesRenderItemReturn } from "echarts";
import {
  getSchedule,
  getGrades,
  getPredictiveModelGames,
  getPredictiveModelUpcoming,
  getPredictiveModelUpcomingMeta,
  getTeamWeek,
  type Row,
  type PredictiveModelUpcomingMeta,
} from "../../../../lib/data/loader";
import { Card, Kpi, tableWrapCls, theadCls, trCls, stickyColCls, stickyColHeadCls, scrollHintCls, ScrollHint } from "../../../../components/ui";
import { Select } from "../../../../components/filters/Select";
import { Loading, ErrorRetry, Empty } from "../../../../components/Loading";
import { useECharts } from "../../../../components/charts/useECharts";
import { buildHistogramBins, sturgesBinCount, type HistogramBins } from "../../../../components/charts/histogram";
import { percentile, sampleStd } from "../../../../lib/logic/contributions";
import { pearsonCorrelation, correlationRead } from "../../../../lib/logic/weekHistory";
import { getTeamMetaMap, type TeamMeta } from "../../../../lib/team/meta";
import { TeamLogoLink } from "../../../../components/team/TeamLogoLink";
import { InfoDot } from "../../../../components/InfoDot";
import { ModelDotStrip, disagreementOf } from "../../previews/ModelDotStrip";
import { GameModelsPopover } from "../../previews/GameModelsPopover";
import TeamMomentumDetail from "./TeamMomentumDetail";
import { classify, type Game } from "../WinTypesTab";
import WinTypeDetailModal from "../WinTypeDetailModal";
import {
  computeAgreementMatrix,
  computeAllAgreeStat,
  computePairwiseResolution,
  computeTossUpAccuracy,
  bestTossUpModel,
  categorizeGame,
  pairKey,
  AXIS_KEYS,
  AXIS_LABELS,
  type AxisKey,
  type GameCategory,
  type AllAgreeStat,
  type PairwiseResolution,
  type TossUpAccuracy,
} from "../../previews/modelAgreement";
import {
  buildHist,
  buildGradesIndex,
  buildTeamWeekIndex,
  buildScheduleEloIndex,
  buildPredictiveIndex,
  probBundle,
  resultWinner,
  pickWinner,
  kickoffMs,
  MODEL_KEYS,
  MODEL_COLORS,
  darkenColor,
  lightenColor,
  type MetricKey,
  type ProbBundle,
} from "../../previews/engine";

const DISAGREEMENT_LOW = 0.1; // pp gap below this = "low" (models mostly agree)
const DISAGREEMENT_HIGH = 0.25; // pp gap above this = "high" (models split hard)

function bucketOfDisagreement(spread: number): "Low (<10pp)" | "Medium (10–25pp)" | "High (>25pp)" {
  if (spread < DISAGREEMENT_LOW) return "Low (<10pp)";
  if (spread <= DISAGREEMENT_HIGH) return "Medium (10–25pp)";
  return "High (>25pp)";
}
const DISAGREEMENT_BUCKETS = ["Low (<10pp)", "Medium (10–25pp)", "High (>25pp)"] as const;

const stepBtnCls =
  "grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-150 hover:text-slate-900 active:scale-90 disabled:opacity-30 disabled:hover:text-slate-500 disabled:active:scale-100";

interface GameModelRow {
  g: Row;
  season: number;
  home: string;
  away: string;
  bundle: ProbBundle;
  nModels: number; // how many non-consensus models had a value for this game
  disagreement: number; // max - min across available models (0 if nModels < 2)
  winner: "home" | "away" | null;
  underdogWon: boolean | null;
}

/** A nicer-looking value-axis histogram bar: gradient fill + rounded top
 * corners. Scoped locally rather than changing the shared
 * `histogramBarSeries()` in components/charts/histogram.ts, which
 * WeeklyTab.tsx/ConfidenceTab.tsx also rely on for their current look. */
function prettyHistogramSeries(bins: HistogramBins, name = "Games"): CustomSeriesOption {
  const { lo, width, counts } = bins;
  const data = counts.map((c, i) => [lo + i * width, lo + (i + 1) * width, c]);
  return {
    name,
    type: "custom",
    renderItem: (_params: unknown, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
      const yValue = api.value(2) as number;
      const start = api.coord([api.value(0) as number, yValue]);
      const size = api.size!([(api.value(1) as number) - (api.value(0) as number), yValue]) as number[];
      const pad = size[0] * 0.08;
      return {
        type: "rect",
        shape: { x: start[0] + pad, y: start[1], width: Math.max(1, size[0] - pad * 2), height: size[1], r: [5, 5, 0, 0] },
        style: api.style(),
      };
    },
    itemStyle: {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "#2459A7" },
        { offset: 1, color: "#9db6e8" },
      ]),
    },
    encode: { x: [0, 1], y: 2, tooltip: [0, 1, 2] },
    data,
  } as CustomSeriesOption;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
/** Linear-interpolate between two hex colors — used to shade the "similar weeks"
 * box plot from green (closest match) to red (least similar of the shown set). */
function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgbTuple(hexA);
  const b = hexToRgbTuple(hexB);
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** Mini version of ModelDotStrip's visual language for an *aggregate* stat:
 * each model's average confidence (probability assigned to whichever side
 * it picked, so always 50–100%) across every game in the selected week,
 * pooled over all seasons. Home/away position isn't meaningful once pooled
 * across many different matchups, so this reframes the same track as
 * "Toss-up → Lock" instead. */
function AvgConfidenceStrip({ avg }: { avg: Partial<Record<MetricKey, number>> }) {
  const entries = MODEL_KEYS.filter(([k]) => avg[k] != null);
  if (!entries.length) return null;
  return (
    <div className="relative mt-5 h-6 w-full max-w-lg rounded-full bg-slate-100">
      <span className="absolute -top-4 left-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">Toss-up</span>
      <span className="absolute -top-4 right-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">Lock</span>
      {entries.map(([k, lbl]) => {
        const conf = avg[k]!;
        const pos = Math.max(0, Math.min(1, (conf - 0.5) / 0.5)) * 100;
        return (
          <span
            key={k}
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${pos}%`, background: MODEL_COLORS[k] }}
            title={`${lbl}: ${Math.round(conf * 100)}% avg. confidence`}
          />
        );
      })}
    </div>
  );
}

/** 8×8 heatmap (7 models + "Actual") — cell (A, B) = the % of this week's
 * games where A and B picked the same side. The Actual row/column is just
 * that model's straight-up accuracy, so this single matrix answers both
 * "how do the models compare to each other" and "how does each compare to
 * the real winner." Modeled on ModelPickerTab.tsx's heatmap shape (category
 * axes, hidden visualMap) — but color comes from the visualMap's own
 * `inRange`/`outOfRange`, not an `itemStyle.color` callback: ECharts'
 * heatmap series always colors cells via the visualMap that targets it
 * (required — omitting visualMap entirely throws "Heatmap must use with
 * visualMap"), and an itemStyle color callback does NOT override that,
 * confirmed live on both this chart and, it turns out, the already-shipped
 * ModelPickerTab.tsx heatmap (its "no data" cells and 100%-accuracy cells
 * both render the same washed-out yellow — a pre-existing bug there, out of
 * scope to fix here). Routing color through `inRange`/`outOfRange` instead
 * is the combination that actually renders correctly. */
function buildAgreementChartOption(cells: { a: AxisKey; b: AxisKey; pct: number | null; n: number }[]): EChartsOption {
  const labels = AXIS_KEYS.map((k) => AXIS_LABELS[k]);
  const idx = new Map(AXIS_KEYS.map((k, i) => [k, i]));
  const nByCell = new Map<string, number>();
  for (const c of cells) nByCell.set(`${idx.get(c.a)},${idx.get(c.b)}`, c.n);
  // A `null` value (the diagonal, or a pair with zero overlapping games) is
  // ECharts' own "no data" convention for a heatmap cell — it renders blank
  // rather than picking up the visualMap's in-range coloring at all, which
  // is more reliable than trying to push it out of the visualMap's domain
  // (a -1 sentinel below `min` still got clamped into the in-range red end
  // rather than triggering `outOfRange`, confirmed live).
  const data: [number, number, number | null][] = cells.map((c) => [idx.get(c.a)!, idx.get(c.b)!, c.pct == null ? null : Math.round(c.pct * 100)]);
  return {
    grid: { left: 90, right: 10, top: 10, bottom: 60, containLabel: false },
    tooltip: {
      formatter: (p: unknown) => {
        const { value } = p as { value: [number, number, number | null] };
        const [xi, yi, pct] = value;
        if (pct == null) return labels[xi];
        const n = nByCell.get(`${xi},${yi}`) ?? 0;
        return `${labels[xi]} vs ${labels[yi]}<br/>Agree ${pct}% of games (n=${n})`;
      },
    },
    xAxis: { type: "category", data: labels, splitArea: { show: false }, axisLabel: { rotate: 45, fontSize: 9 }, axisTick: { show: false } },
    yAxis: { type: "category", data: labels, splitArea: { show: false }, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
    visualMap: {
      show: false,
      min: 0,
      max: 100,
      // Diverging red→amber→green, amber landing at the domain midpoint
      // (50% — "no better than a coin flip on this pair") since `continuous`
      // spaces an inRange color array evenly across [min, max].
      inRange: { color: ["#c8102e", "#fad34e", "#2ca25f"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: true, fontSize: 9, formatter: (p: { value: [number, number, number | null] }) => (p.value[2] == null ? "" : String(p.value[2])) },
        itemStyle: { borderColor: "#fff", borderWidth: 1, color: "#f1f5f9" },
      },
    ],
  } as EChartsOption;
}

const PROB_BIN = 4; // percentage points
const SPREAD_BIN = 1; // points
const TOOLTIP_GAME_CAP = 8;

interface ProbSpreadGame {
  season: number;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  winner: "home" | "away" | null;
  correct: boolean | null; // null until graded
}

type ProbSpreadStatus = "correct" | "wrong" | "unplayed";

interface ProbSpreadPoint {
  x: number; // binned P(home wins), 0-100
  y: number; // binned spread_line, home perspective
  count: number;
  status: ProbSpreadStatus; // precedence correct > wrong > unplayed — see buildProbSpreadPoints
  games: ProbSpreadGame[];
}

/** Bins each visible model's (P(home wins), spread) pairs to a coarse grid
 * so near-identical games collapse into one marker instead of silently
 * overplotting — `count` then drives marker size, so overlap reads as
 * "more games here" rather than disappearing. A bin's `status` is a
 * deliberate simplification: one marker can represent several games (some
 * graded, some not, some right, some wrong), so it collapses them to
 * whichever outcome is most decision-relevant — a correct pick anywhere in
 * the bin wins, else a wrong pick, else it's treated as unplayed — rather
 * than tracking each game's outcome individually. Hovering lists them all. */
function buildProbSpreadPoints(rows: { bundle: ProbBundle; winner: "home" | "away" | null; g: Row; season: number }[], key: MetricKey): ProbSpreadPoint[] {
  const bins = new Map<string, ProbSpreadPoint>();
  for (const row of rows) {
    const p = row.bundle[key][1];
    if (p == null || row.g.spread_line == null) continue;
    const x = Math.round((p * 100) / PROB_BIN) * PROB_BIN;
    const y = Math.round(Number(row.g.spread_line) / SPREAD_BIN) * SPREAD_BIN;
    const k = `${x}|${y}`;
    const cur = bins.get(k) ?? { x, y, count: 0, status: "unplayed" as ProbSpreadStatus, games: [] };
    cur.count++;
    const predictedSide = pickWinner([1 - p, p]);
    const correct = row.winner == null ? null : predictedSide === row.winner;
    if (correct) cur.status = "correct";
    else if (correct === false && cur.status !== "correct") cur.status = "wrong";
    cur.games.push({
      season: row.season,
      away: String(row.g.away_team),
      home: String(row.g.home_team),
      awayScore: row.g.away_score == null ? null : Number(row.g.away_score),
      homeScore: row.g.home_score == null ? null : Number(row.g.home_score),
      winner: row.winner,
      correct,
    });
    bins.set(k, cur);
  }
  return [...bins.values()];
}

function gameTooltipLine(g: ProbSpreadGame): string {
  const prefix = `${g.season} ${g.away} @ ${g.home}`;
  if (g.winner == null || g.awayScore == null || g.homeScore == null) return `${prefix} — not yet played`;
  const winnerTeam = g.winner === "home" ? g.home : g.away;
  const mark = g.correct == null ? "" : g.correct ? " ✓" : " ✗";
  return `${prefix} — ${g.awayScore}-${g.homeScore}, ${winnerTeam} won${mark}`;
}

const scatterSymbolSize = (_val: unknown, params: { data: { count: number } }) => 7 + Math.min(params.data.count - 1, 8) * 2.5;

function probSpreadSeriesData(points: ProbSpreadPoint[]) {
  return points.map((p) => ({ value: [p.x, p.y], count: p.count, games: p.games }));
}

/** Up to three scatter series per currently-visible model, split by
 * `status` (a model with no wrong picks yet just skips that series).
 * Toggled-off models are simply not included, so the pill row above the
 * chart doubles as its legend with no separate selectedMode/legend state
 * to keep in sync. Color/opacity — not a border — carries the outcome:
 * darker + fully opaque = correct, a lighter tint = wrong, the model's
 * normal color at baseline opacity = not yet played. */
function buildProbSpreadChartOption(pointsByModel: [MetricKey, ProbSpreadPoint[]][]): EChartsOption | null {
  if (!pointsByModel.length) return null;
  const baseOpacity = (params: { data: { count: number } }) => Math.min(1, 0.45 + (params.data.count - 1) * 0.12);
  const byStatus = (status: ProbSpreadStatus) =>
    pointsByModel
      .map(([key, points]) => [key, points.filter((p) => p.status === status)] as [MetricKey, ProbSpreadPoint[]])
      .filter(([, points]) => points.length > 0);
  const seriesFor = (status: ProbSpreadStatus) =>
    byStatus(status).map(([key, points]) => ({
      name: MODEL_KEYS.find(([k]) => k === key)?.[1] ?? key,
      type: "scatter" as const,
      data: probSpreadSeriesData(points),
      symbolSize: scatterSymbolSize,
      itemStyle:
        status === "correct"
          ? { color: darkenColor(MODEL_COLORS[key], 0.35), opacity: 1 }
          : status === "wrong"
            ? { color: lightenColor(MODEL_COLORS[key], 0.45), opacity: 0.85 }
            : { color: MODEL_COLORS[key], opacity: baseOpacity },
    }));
  // Draw order matters: unplayed, then wrong, then correct last, so that
  // wherever multiple models' dots overlap the same bin, a correct pick
  // from *any* model always wins the pixel instead of being hidden under
  // another model's unplayed/wrong dot drawn later in the array.
  // Correct picks get a second, reinforcing cue on top of the darker fill:
  // a dark-green ring, drawn as its own silent/non-tooltip overlay series
  // (not a per-item border on the fill series) so it can't be erased by a
  // later-drawn model's dot the way the original border implementation was.
  const outlineSeries = byStatus("correct").map(([key, points]) => ({
    name: MODEL_KEYS.find(([k]) => k === key)?.[1] ?? key,
    type: "scatter" as const,
    data: probSpreadSeriesData(points),
    symbolSize: scatterSymbolSize,
    silent: true,
    tooltip: { show: false },
    z: 10,
    itemStyle: { color: "transparent", borderColor: "#065f46", borderWidth: 2 },
  }));
  const series = [...seriesFor("unplayed"), ...seriesFor("wrong"), ...seriesFor("correct"), ...outlineSeries];
  return {
    grid: { left: 48, right: 16, top: 16, bottom: 44, containLabel: true },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const { seriesName, value, data } = p as { seriesName: string; value: [number, number]; data: { count: number; games: ProbSpreadGame[] } };
        const shown = data.games.slice(0, TOOLTIP_GAME_CAP).map(gameTooltipLine).join("<br/>");
        const extra = data.games.length > TOOLTIP_GAME_CAP ? `<br/>+${data.games.length - TOOLTIP_GAME_CAP} more` : "";
        return `${seriesName} — P(home) ≈ ${value[0]}%, spread ≈ ${value[1]} · ${data.count} game${data.count === 1 ? "" : "s"}<br/>${shown}${extra}`;
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "Model probability — P(home wins)",
      nameLocation: "middle",
      nameGap: 28,
      axisLabel: { formatter: "{value}%" },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    yAxis: {
      type: "value",
      name: "Spread (home perspective)",
      nameLocation: "middle",
      nameGap: 34,
      nameRotate: 90,
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: series.map((s, i) => ({
      ...s,
      markLine:
        i === 0
          ? {
              symbol: "none",
              lineStyle: { type: "dashed", color: "#94a3b8" },
              label: { show: false },
              data: [{ xAxis: 50 }, { yAxis: 0 }],
            }
          : undefined,
    })),
  } as EChartsOption;
}

const ANNOTATION_MIN_N = 5;

// Short forms for the badge itself (space is tight) — the hover title still
// spells out the full MODEL_KEYS label.
const SHORT_LABEL: Record<MetricKey, string> = {
  consensus: "Avg",
  ml: "ML Fair",
  blend: "Market",
  predictive: "Predictive",
  elo: "Elo",
  pyth: "Pythag.",
  trend: "Trend",
};

interface RowAnnotationInfo {
  tone: "agree" | "tossup" | "disagree" | "unknown";
  /** Top line: icon + who/what this badge is about. */
  line1: string;
  /** Bottom line: the win% for this specific split/category, plus the
   * historical sample size it's based on — visible on every card, not just
   * in the hover title. */
  line2: string;
  title: string;
  muted: boolean;
}

/** "Listening recommendation" for one game: given which situation it falls
 * into (all-agree / a specific pair disagreeing / a toss-up), what history
 * actually says about that exact situation — not a static per-model
 * comparison, but conditional accuracy sliced by situation type. */
function buildAnnotation(
  category: GameCategory,
  ctx: {
    allAgreeStat: { winRate: number | null; n: number };
    pairwiseResolution: Map<string, { a: MetricKey; b: MetricKey; accA: number | null; accB: number | null; n: number; better: MetricKey | null }>;
    tossUpAccuracy: Map<MetricKey, { acc: number | null; n: number }>;
    bestTossUp: MetricKey | null;
  },
): RowAnnotationInfo {
  const label = (k: MetricKey) => MODEL_KEYS.find(([mk]) => mk === k)?.[1] ?? k;

  if (category.kind === "all-agree") {
    const { winRate, n } = ctx.allAgreeStat;
    const pct = winRate != null ? Math.round(winRate * 100) : null;
    return {
      tone: "agree",
      line1: "🤝 All agree",
      line2: pct != null ? `${pct}% (n=${n})` : "no history yet",
      title:
        pct != null
          ? `All models agree here — right ${pct}% of the time historically (n=${n}).`
          : "All models agree here — not enough graded history yet.",
      muted: n < ANNOTATION_MIN_N,
    };
  }

  if (category.kind === "toss-up") {
    if (!ctx.bestTossUp) {
      return { tone: "tossup", line1: "🪙 Toss-up", line2: "no history yet", title: "Toss-up game — not enough history yet to say which model does best here.", muted: true };
    }
    const { acc, n } = ctx.tossUpAccuracy.get(ctx.bestTossUp) ?? { acc: null, n: 0 };
    const pct = acc != null ? Math.round(acc * 100) : null;
    return {
      tone: "tossup",
      line1: `🪙 ${SHORT_LABEL[ctx.bestTossUp]}`,
      line2: pct != null ? `${pct}% (n=${n})` : "no history yet",
      title: `Toss-up game (all models near 50/50) — ${label(ctx.bestTossUp)} has been the most accurate model in these spots (${pct}%, n=${n}).`,
      muted: n < ANNOTATION_MIN_N,
    };
  }

  if (category.kind === "disagree") {
    const res = ctx.pairwiseResolution.get(pairKey(category.a, category.b));
    if (!res || res.n === 0) {
      return {
        tone: "disagree",
        line1: `⚡ ${SHORT_LABEL[category.a]}/${SHORT_LABEL[category.b]}`,
        line2: "no history yet",
        title: `${label(category.a)} and ${label(category.b)} disagree here — not enough history yet.`,
        muted: true,
      };
    }
    const pctA = res.accA != null ? Math.round(res.accA * 100) : null;
    const pctB = res.accB != null ? Math.round(res.accB * 100) : null;
    if (!res.better) {
      return {
        tone: "disagree",
        line1: `⚡ ${SHORT_LABEL[category.a]}/${SHORT_LABEL[category.b]}`,
        line2: `${pctA}% vs ${pctB}% (n=${res.n})`,
        title: `${label(category.a)} and ${label(category.b)} disagree here — no clear edge historically (${pctA}% vs ${pctB}%, n=${res.n}).`,
        muted: res.n < ANNOTATION_MIN_N,
      };
    }
    const winPct = res.better === category.a ? pctA : pctB;
    return {
      tone: "disagree",
      line1: `⚡ ${SHORT_LABEL[res.better]}`,
      line2: `${winPct}% (n=${res.n})`,
      title: `${label(category.a)} and ${label(category.b)} disagree here — ${label(res.better)} has been right more often when these two split (${pctA}% vs ${pctB}%, n=${res.n}).`,
      muted: res.n < ANNOTATION_MIN_N,
    };
  }

  return { tone: "unknown", line1: "—", line2: "", title: "Not enough model data for this game.", muted: true };
}

const ANNOTATION_TONE_CLS: Record<RowAnnotationInfo["tone"], string> = {
  agree: "border-emerald-200 bg-emerald-50 text-emerald-700",
  tossup: "border-amber-200 bg-amber-50 text-amber-700",
  disagree: "border-sky-200 bg-sky-50 text-sky-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-400",
};

function RowAnnotation({ annotation }: { annotation: RowAnnotationInfo }) {
  return (
    <div
      className={`w-24 shrink-0 rounded-lg border px-1.5 py-1 text-center leading-tight sm:w-28 ${ANNOTATION_TONE_CLS[annotation.tone]} ${annotation.muted ? "opacity-50" : ""}`}
      title={annotation.title}
    >
      <div className="truncate text-[10px] font-bold">{annotation.line1}</div>
      <div className="truncate text-[9px]">{annotation.line2}</div>
    </div>
  );
}

/** Simplified per-game row for easy side-by-side comparison across a whole
 * season's slate: just the dot-strip (every model, all at once) flanked by
 * the two team logos — no probability bar, no pick badge, no date/text
 * clutter. All rows share the same track width so dot positions line up
 * vertically from one game to the next. The winning team's logo still gets
 * a colored ring, independent of any single model's pick. A "listening
 * recommendation" badge on the right shows which situation this game falls
 * into (all-agree / a pair disagreeing / a toss-up) and what history says
 * about it. */
function DotStripRow({
  g,
  bundle,
  teamMeta,
  annotation,
  category,
  allAgreeStat,
  pairwiseResolution,
  tossUpAccuracy,
}: {
  g: Row;
  bundle: ProbBundle;
  teamMeta: Map<string, TeamMeta>;
  annotation: RowAnnotationInfo;
  category: GameCategory;
  allAgreeStat: AllAgreeStat;
  pairwiseResolution: Map<string, PairwiseResolution>;
  tossUpAccuracy: Map<MetricKey, TossUpAccuracy>;
}) {
  const away = String(g.away_team);
  const home = String(g.home_team);
  const actual = resultWinner(g);
  const played = g.home_score != null && g.away_score != null;
  const absSpread = g.spread_line == null ? null : Math.abs(Number(g.spread_line));
  const isBlowoutSpread = absSpread != null && absSpread > 6;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const logo = (team: string, isWinner: boolean) => {
    const src = teamMeta.get(team)?.logo;
    const ringColor = teamMeta.get(team)?.color ?? "#16a34a";
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 text-center sm:w-16">
        <span className="inline-block rounded-full" style={isWinner ? { boxShadow: `0 0 0 3px ${ringColor}, 0 0 0 5px white` } : undefined}>
          {src ? (
            <TeamLogoLink to={`/game_analysis/team_comparison?team1=${away}&team2=${home}`} logo={src} alt={team} imgClassName="h-8 w-8 object-contain" title={`Compare ${away} vs ${home}`} />
          ) : (
            <div className="font-bold">{team}</div>
          )}
        </span>
        <span className={`text-[10px] font-semibold ${isWinner ? "text-slate-900" : "text-slate-400"}`}>{team}</span>
      </div>
    );
  };

  return (
    <div
      className={`relative rounded-2xl bg-white shadow-sm ${isBlowoutSpread ? "border-2 border-violet-500" : "border border-slate-200"}`}
      title={isBlowoutSpread ? `Spread ${absSpread!.toFixed(1)} — a wide (>6pt) line.` : undefined}
    >
      <div className="relative flex items-center gap-3 px-3 py-3">
        {absSpread != null && (
          <span
            className={`absolute -top-2 left-4 rounded-full border px-2 text-[9px] font-bold leading-[15px] ${
              isBlowoutSpread ? "border-violet-500 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-400"
            }`}
          >
            Spread {absSpread.toFixed(1)}
          </span>
        )}
        {logo(away, played && actual === "away")}
        <div className="min-w-0 flex-1">
          <ModelDotStrip bundle={bundle} away={away} home={home} actual={actual} showEndLabels={false} />
        </div>
        {logo(home, played && actual === "home")}
        <RowAnnotation annotation={annotation} />
      </div>
      {/* Sole trigger for the popup, as a full-width footer strip in normal document
          flow — not a small absolutely-positioned corner icon. That corner-icon design
          proved unreliable to tap in practice (on top of the whole-row click it replaced,
          which was unreliable for the same reason: too small/ambiguous a target next to
          the logos/dots/badge that swallow most clicks for their own behavior). A full-width
          bar in normal flow can't be missed and can't be affected by any positioning quirk. */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          // Must stop propagation: GameModelsPopover attaches a document-level "click
          // outside to close" listener the instant it mounts, and React can flush that
          // effect synchronously enough, for a real (non-synthetic) click, that the very
          // click which opens it is still bubbling toward `document` when the listener
          // attaches — so without this it re-closes itself immediately on every real
          // click. Same reason DotPopover/InfoDot's triggers stop propagation too.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-full touch-manipulation items-center justify-center gap-1 rounded-b-2xl border-t border-slate-100 bg-slate-50 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-[#002f6c]"
      >
        Compare all 7 models {open ? "▴" : "▾"}
      </button>
      {open && (
        <GameModelsPopover
          bundle={bundle}
          away={away}
          home={home}
          actual={actual}
          annotation={annotation}
          category={category}
          allAgreeStat={allAgreeStat}
          pairwiseResolution={pairwiseResolution}
          tossUpAccuracy={tossUpAccuracy}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function ThisWeekView() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [predGames, setPredGames] = useState<Row[]>([]);
  const [predUpcoming, setPredUpcoming] = useState<Row[]>([]);
  const [upcomingMeta, setUpcomingMeta] = useState<PredictiveModelUpcomingMeta | null>(null);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]>>(new Map());
  const [teamMeta, setTeamMeta] = useState<Map<string, TeamMeta>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamWeekLoaded, setTeamWeekLoaded] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [primary, setPrimary] = useState<MetricKey>("consensus");
  const [sortMode, setSortMode] = useState<"time" | "confidence" | "disagree">("time");
  const [selectedGraphSeasons, setSelectedGraphSeasons] = useState<Set<number>>(new Set());
  const [visibleModels, setVisibleModels] = useState<Set<MetricKey>>(new Set(MODEL_KEYS.map(([k]) => k)));
  const [selectedMomentumTeam, setSelectedMomentumTeam] = useState<string | null>(null);
  const [spreadMode, setSpreadMode] = useState<"abs" | "raw">("raw");

  useEffect(() => {
    setLoadError(null);
    Promise.all([getSchedule(), getGrades(), getPredictiveModelGames(), getPredictiveModelUpcoming(), getPredictiveModelUpcomingMeta()])
      .then(([sch, gr, pg, pu, meta]) => {
        setSchedule(sch);
        setGrades(gr);
        setPredGames(pg);
        setPredUpcoming(pu);
        setUpcomingMeta(meta);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    getTeamMetaMap().then(setTeamMeta);
  }, [retryTick]);

  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => a - b), [reg]);

  // team_week is one file per season — fetch every season once the season
  // list is known. loader.ts caches by path, so this is cheap on re-runs.
  useEffect(() => {
    if (!seasons.length) return;
    setTeamWeekLoaded(false);
    Promise.all(seasons.map((s) => getTeamWeek(s).then((rows) => [s, rows] as const)))
      .then((pairs) => {
        setTeamWeekBySeason(new Map(pairs));
        setTeamWeekLoaded(true);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons.join(",")]);

  const weekOptions = useMemo(() => [...new Set(reg.map((r) => Number(r.week)))].sort((a, b) => a - b), [reg]);

  useEffect(() => {
    if (selectedWeek || !weekOptions.length) return;
    if (upcomingMeta?.week != null && upcomingMeta.n_games > 0 && weekOptions.includes(upcomingMeta.week)) {
      setSelectedWeek(String(upcomingMeta.week));
    } else {
      setSelectedWeek(String(weekOptions[0]));
    }
  }, [selectedWeek, weekOptions, upcomingMeta]);

  const selectedWeekNum = Number(selectedWeek);
  const weekSchedRows = useMemo(() => reg.filter((r) => Number(r.week) === selectedWeekNum), [reg, selectedWeekNum]);
  const seasonsCoveredThisWeek = useMemo(() => new Set(weekSchedRows.map((r) => r.season)).size, [weekSchedRows]);

  // ---------- shared prediction engine indices (reused from Matchup Previews) ----------
  const hist = useMemo(() => buildHist(reg), [reg]);
  const gradesIdx = useMemo(() => buildGradesIndex(grades), [grades]);
  const twIdx = useMemo(() => buildTeamWeekIndex(teamWeekBySeason), [teamWeekBySeason]);
  const eloIdx = useMemo(() => buildScheduleEloIndex(reg), [reg]);
  const predIdx = useMemo(() => buildPredictiveIndex([...predGames, ...predUpcoming]), [predGames, predUpcoming]);

  // ---------- Section 1: spread distribution across the years ----------
  const spreads = useMemo(
    () => weekSchedRows.map((r) => (r.spread_line == null ? null : Number(r.spread_line))).filter((v): v is number => v != null && Number.isFinite(v)),
    [weekSchedRows],
  );
  const absSpreads = useMemo(() => spreads.map(Math.abs), [spreads]);
  const spreadStats = useMemo(() => {
    if (!absSpreads.length) return null;
    const mean = absSpreads.reduce((a, b) => a + b, 0) / absSpreads.length;
    const std = sampleStd(absSpreads);
    const q1 = percentile(absSpreads, 25);
    const med = percentile(absSpreads, 50);
    const q3 = percentile(absSpreads, 75);
    return { n: absSpreads.length, mean, std, med, iqr: q3 - q1, min: Math.min(...absSpreads), max: Math.max(...absSpreads) };
  }, [absSpreads]);

  const spreadHistOption = useMemo<EChartsOption | null>(() => {
    if (spreads.length < 2) return null;
    const bins = buildHistogramBins(spreads, sturgesBinCount(spreads.length));
    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const med = percentile(spreads, 50);
    return {
      grid: { left: 44, right: 10, top: 20, bottom: 44, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const arr = (Array.isArray(p) ? p : [p]) as { value?: unknown }[];
          const bar = arr.find((it) => Array.isArray(it.value)) as { value: number[] } | undefined;
          if (!bar) return "";
          const [lo, hi, count] = bar.value;
          return `Spread ${lo.toFixed(1)} to ${hi.toFixed(1)}<br/>${count} game${count === 1 ? "" : "s"}`;
        },
      },
      xAxis: { type: "value", min: bins.lo, max: bins.hi, name: "Spread (home perspective)", nameLocation: "middle", nameGap: 26, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      yAxis: { type: "value", name: "Games", nameLocation: "middle", nameGap: 30, nameRotate: 90, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      series: [
        prettyHistogramSeries(bins, "Games"),
        {
          name: "Mean",
          type: "line",
          data: [],
          markLine: { symbol: "none", lineStyle: { type: "solid", color: "#002f6c", width: 2 }, label: { formatter: "Mean", color: "#002f6c", fontWeight: "bold" }, data: [{ xAxis: mean }] },
        },
        {
          name: "Median",
          type: "line",
          data: [],
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#E87722", width: 2 }, label: { formatter: "Median", color: "#E87722", fontWeight: "bold" }, data: [{ xAxis: med }] },
        },
      ],
    } as EChartsOption;
  }, [spreads]);

  // Raw spread (home perspective) or |spread| — shared by the season box plot
  // and the similar-weeks box plot below.
  const spreadValue = (raw: number) => (spreadMode === "abs" ? Math.abs(raw) : raw);
  const boxStatsFromValues = (vals: number[]): number[] => {
    const v = [...vals].sort((a, b) => a - b);
    return [Math.min(...v), percentile(v, 25), percentile(v, 50), percentile(v, 75), Math.max(...v)];
  };
  const isAbsMode = spreadMode === "abs";
  // Spread is home-perspective: negative = home favored, positive = home
  // underdog (away favored) — so in raw mode the *min* (most negative) is
  // the biggest home favorite and the *max* is the biggest road favorite.
  const boxMinLabel = isAbsMode ? "Min |Spread| (closest matchup)" : "Min (biggest home favorite)";
  const boxMaxLabel = isAbsMode ? "Max |Spread| (biggest blowout)" : "Max (biggest road favorite)";
  const boxYAxisName = isAbsMode ? "|Spread|" : "Spread (home perspective)";
  // Top-to-bottom in the tooltip matches top-to-bottom in the box's whisker —
  // Max first, Min last — instead of the old Min-first order that read
  // backwards against what's drawn on screen. Reads `v` as the plain
  // [min, Q1, median, Q3, max] stats tuple we computed — never echarts'
  // own `params.data`/`params.value`, which for a category-axis boxplot
  // series silently prepends the category index as an extra leading
  // dimension and would shift every field by one if indexed directly.
  const boxTooltipLines = (v: number[]) =>
    `${boxMaxLabel}: ${v[4].toFixed(1)}<br/>Q3: ${v[3].toFixed(1)}<br/>Median: ${v[2].toFixed(1)}<br/>Q1: ${v[1].toFixed(1)}<br/>${boxMinLabel}: ${v[0].toFixed(1)}`;

  const bySeasonRows = useMemo(() => {
    const m = new Map<number, Row[]>();
    for (const r of weekSchedRows) {
      if (r.spread_line == null || !Number.isFinite(Number(r.spread_line))) continue;
      const s = Number(r.season);
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(r);
    }
    return m;
  }, [weekSchedRows]);

  const spreadBoxOption = useMemo<EChartsOption | null>(() => {
    const seasonsSorted = [...bySeasonRows.keys()].sort((a, b) => a - b);
    if (!seasonsSorted.length) return null;
    const data = seasonsSorted.map((s) => boxStatsFromValues(bySeasonRows.get(s)!.map((r) => spreadValue(Number(r.spread_line)))));
    return {
      grid: { left: 44, right: 10, top: 20, bottom: 44, containLabel: true },
      xAxis: { type: "category", data: seasonsSorted.map(String), name: "Season", nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", name: boxYAxisName, nameLocation: "middle", nameGap: 30, nameRotate: 90, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      tooltip: {
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const { dataIndex, name } = param as { dataIndex: number; name: string };
          return `Season ${name}<br/>${boxTooltipLines(data[dataIndex])}`;
        },
      },
      series: [{ type: "boxplot", data, itemStyle: { color: "rgba(36,89,167,0.35)", borderColor: "#2459A7", borderWidth: 1.5 } }],
    } as EChartsOption;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySeasonRows, spreadMode]);

  // ---------- Section 1b: auto-detected similar weeks ----------
  // Every (season, week) combo's spread distribution, ranked by how close its
  // [mean, median, IQR] is to the currently selected week's aggregate — a
  // normalized-Euclidean distance so mean/median/IQR (different natural
  // scales) contribute comparably. The stats basis follows the raw/|abs|
  // toggle: |spread| in abs mode judges pure competitiveness (ignores which
  // side was favored), raw signed spread in raw mode also matches on
  // direction (a week of big home favorites isn't "similar" to one of
  // equally lopsided away favorites).
  const MIN_GAMES_FOR_COMPARISON = 4;
  const similarityTarget = useMemo(() => {
    const vals = spreadMode === "abs" ? absSpreads : spreads;
    if (!vals.length) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const med = percentile(vals, 50);
    const iqr = percentile(vals, 75) - percentile(vals, 25);
    return { mean, med, iqr };
  }, [spreadMode, absSpreads, spreads]);

  const similarWeeks = useMemo(() => {
    if (!similarityTarget) return [];
    const bySW = new Map<string, { season: number; week: number; rows: Row[] }>();
    for (const r of reg) {
      if (r.spread_line == null || !Number.isFinite(Number(r.spread_line))) continue;
      const season = Number(r.season);
      const week = Number(r.week);
      if (!Number.isFinite(season) || !Number.isFinite(week)) continue;
      const key = `${season}-${week}`;
      if (!bySW.has(key)) bySW.set(key, { season, week, rows: [] });
      bySW.get(key)!.rows.push(r);
    }
    type Cand = { season: number; week: number; rows: Row[]; raws: number[]; mean: number; med: number; iqr: number };
    const candidates: Cand[] = [];
    for (const { season, week, rows } of bySW.values()) {
      if (rows.length < MIN_GAMES_FOR_COMPARISON) continue;
      const raws = rows.map((r) => Number(r.spread_line));
      const vals = spreadMode === "abs" ? raws.map((x) => Math.abs(x)) : raws;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const med = percentile(vals, 50);
      const iqr = percentile(vals, 75) - percentile(vals, 25);
      candidates.push({ season, week, rows, raws, mean, med, iqr });
    }
    if (candidates.length < 2) return [];

    const dims: (keyof Pick<Cand, "mean" | "med" | "iqr">)[] = ["mean", "med", "iqr"];
    const stds = dims.map((d) => sampleStd(candidates.map((c) => c[d])) || 1);
    const target = similarityTarget;

    const scored = candidates
      .map((c) => {
        const dist = Math.sqrt(dims.reduce((sum, d, i) => sum + ((c[d] - target[d]) / stds[i]) ** 2, 0));
        return { ...c, dist };
      })
      .sort((a, b) => a.dist - b.dist);

    const top = scored.slice(0, 3);
    for (let i = 3; i < Math.min(5, scored.length); i++) {
      if (scored[i].dist <= top[2].dist * 1.25) top.push(scored[i]);
      else break;
    }
    return top;
  }, [reg, similarityTarget, spreadMode]);

  const similarWeeksBoxOption = useMemo<EChartsOption | null>(() => {
    if (!similarWeeks.length) return null;
    const currentVals = weekSchedRows
      .map((r) => (r.spread_line == null ? null : Number(r.spread_line)))
      .filter((v): v is number => v != null && Number.isFinite(v))
      .map(spreadValue);
    if (!currentVals.length) return null;

    const categories = ["This week", ...similarWeeks.map((c) => `S${c.season} Wk${c.week}`)];
    const dataArr = [boxStatsFromValues(currentVals), ...similarWeeks.map((c) => boxStatsFromValues(c.raws.map(spreadValue)))];
    const GREEN = "#3C9A5F";
    const RED = "#C8102E";
    const n = similarWeeks.length;
    const colors = ["#2459A7", ...similarWeeks.map((_, i) => lerpColor(GREEN, RED, n <= 1 ? 0 : i / (n - 1)))];
    const rankLabels = ["This week", "Closest match", "2nd closest", "3rd closest", "4th closest", "5th closest"];

    return {
      grid: { left: 44, right: 10, top: 20, bottom: 56, containLabel: true },
      xAxis: { type: "category", data: categories, name: "Week", nameLocation: "middle", nameGap: 40, axisLabel: { rotate: categories.length > 4 ? 20 : 0 } },
      yAxis: { type: "value", name: boxYAxisName, nameLocation: "middle", nameGap: 30, nameRotate: 90, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      tooltip: {
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const idx = (param as { dataIndex: number }).dataIndex;
          return `${rankLabels[idx] ?? categories[idx]}<br/>${boxTooltipLines(dataArr[idx])}`;
        },
      },
      series: [
        {
          type: "boxplot",
          data: dataArr.map((d, i) => ({ value: d, itemStyle: { color: colors[i], opacity: 0.35, borderColor: colors[i], borderWidth: 1.5 } })),
        },
      ],
    } as EChartsOption;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarWeeks, weekSchedRows, spreadMode]);

  const spreadHistRef = useECharts(spreadHistOption);

  // Click a box in either box plot -> open the same game-details popup Win
  // Types uses for its stacked-bar segments. Refs (not plain closures) hold
  // the click->games mapping since useECharts only registers onInit once at
  // mount, while the underlying rows change every time `selectedWeek` does.
  const [gamesModal, setGamesModal] = useState<{ label: string; games: Game[] } | null>(null);

  const seasonBoxEntriesRef = useRef<{ label: string; rows: Row[] }[]>([]);
  seasonBoxEntriesRef.current = [...bySeasonRows.keys()]
    .sort((a, b) => a - b)
    .map((s) => ({ label: `Season ${s}`, rows: bySeasonRows.get(s)! }));

  const similarBoxEntriesRef = useRef<{ label: string; rows: Row[] }[]>([]);
  similarBoxEntriesRef.current = [
    { label: "This week", rows: weekSchedRows },
    ...similarWeeks.map((c) => ({ label: `Season ${c.season}, Week ${c.week}`, rows: c.rows })),
  ];

  const spreadBoxRef = useECharts(spreadBoxOption, {
    onInit: (chart) => {
      chart.on("click", (p: { dataIndex?: number }) => {
        if (p.dataIndex == null) return;
        const entry = seasonBoxEntriesRef.current[p.dataIndex];
        if (!entry) return;
        setGamesModal({ label: entry.label, games: entry.rows.map((r) => classify(r, "week")) });
      });
    },
  });
  const similarWeeksBoxRef = useECharts(similarWeeksBoxOption, {
    onInit: (chart) => {
      chart.on("click", (p: { dataIndex?: number }) => {
        if (p.dataIndex == null) return;
        const entry = similarBoxEntriesRef.current[p.dataIndex];
        if (!entry) return;
        setGamesModal({ label: entry.label, games: entry.rows.map((r) => classify(r, "week")) });
      });
    },
  });

  // ---------- Section 2: all models' behavior for this week's games ----------
  const gameModelRows = useMemo<GameModelRow[]>(() => {
    return weekSchedRows.map((g) => {
      const season = Number(g.season);
      const week = Number(g.week);
      // Always fed a real schedule.json row (has game_id/moneylines/spread) —
      // this is also what makes the live/upcoming week's card show correct
      // Elo and ML-Fair values instead of "—" (previously this view sourced
      // the live week's rows from predictive_model/upcoming.json, which
      // lacks game_id and moneylines entirely).
      const bundle = probBundle(g, season, week, hist, gradesIdx, twIdx, eloIdx, predIdx);
      const nModels = MODEL_KEYS.filter(([k]) => k !== "consensus" && bundle[k][1] != null).length;
      const winner = resultWinner(g);
      const marketHome = bundle.blend[1];
      const underdogWon = winner == null || marketHome == null ? null : marketHome < 0.5 ? winner === "away" : winner === "home";
      return {
        g,
        season,
        home: String(g.home_team),
        away: String(g.away_team),
        bundle,
        nModels,
        disagreement: disagreementOf(bundle),
        winner,
        underdogWon,
      };
    });
  }, [weekSchedRows, hist, gradesIdx, twIdx, eloIdx, predIdx]);

  const section2Kpis = useMemo(() => {
    const withModels = gameModelRows.filter((g) => g.nModels >= 2);
    const nExcluded = gameModelRows.length - withModels.length;
    const avgDisagreement = withModels.length ? withModels.reduce((s, g) => s + g.disagreement, 0) / withModels.length : null;
    const allAgree = withModels.filter((g) => {
      const vals = MODEL_KEYS.filter(([k]) => k !== "consensus")
        .map(([k]) => g.bundle[k][1])
        .filter((p): p is number => p != null);
      return vals.every((p) => p > 0.5) || vals.every((p) => p < 0.5);
    }).length;
    const underdogGames = gameModelRows.filter((g) => g.underdogWon != null);
    const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
    return { n: gameModelRows.length, nExcluded, avgDisagreement, allAgreeRate: withModels.length ? allAgree / withModels.length : null, underdogWinRate };
  }, [gameModelRows]);

  const avgConfidenceByModel = useMemo(() => {
    const out: Partial<Record<MetricKey, number>> = {};
    for (const [key] of MODEL_KEYS) {
      const vals: number[] = [];
      for (const g of gameModelRows) {
        const p = g.bundle[key][1];
        if (p != null) vals.push(Math.max(p, 1 - p));
      }
      if (vals.length) out[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  }, [gameModelRows]);

  const agreementChartOption = useMemo<EChartsOption | null>(() => {
    if (!gameModelRows.length) return null;
    return buildAgreementChartOption(computeAgreementMatrix(gameModelRows));
  }, [gameModelRows]);
  const agreementChartRef = useECharts(agreementChartOption);

  // "Listening recommendations" — three conditional-accuracy stats behind
  // the per-row annotation badges: what history says once you already know
  // which *situation* a game falls into (all-agree / a specific pair
  // splitting / a toss-up), rather than a static per-model comparison.
  const allAgreeStat = useMemo(() => computeAllAgreeStat(gameModelRows), [gameModelRows]);
  const pairwiseResolution = useMemo(() => computePairwiseResolution(gameModelRows), [gameModelRows]);
  const tossUpAccuracy = useMemo(() => computeTossUpAccuracy(gameModelRows), [gameModelRows]);
  const bestTossUp = useMemo(() => bestTossUpModel(tossUpAccuracy), [tossUpAccuracy]);

  // Per-model accuracy across every historical game this week (all seasons) —
  // doubles as the primary-model picker for the card grid below, same pattern
  // as Matchup Previews' WeekPreviewTab.
  const modelAcc = useMemo(() => {
    return MODEL_KEYS.map(([k, lbl]) => {
      let c = 0;
      let n = 0;
      for (const r of gameModelRows) {
        if (r.winner == null) continue;
        const p = r.bundle[k][1];
        if (p == null) continue;
        n++;
        if ((p > 0.5 ? "home" : "away") === r.winner) c++;
      }
      return { key: k, label: lbl, correct: c, total: n };
    });
  }, [gameModelRows]);
  const anyCompleted = modelAcc.some((m) => m.total > 0);

  const disagreementBuckets = useMemo(() => {
    return DISAGREEMENT_BUCKETS.map((label) => {
      const rows = gameModelRows.filter((g) => g.nModels >= 2 && bucketOfDisagreement(g.disagreement) === label);
      const underdogGames = rows.filter((g) => g.underdogWon != null);
      const underdogWinRate = underdogGames.length ? underdogGames.filter((g) => g.underdogWon).length / underdogGames.length : null;
      const acc: Partial<Record<MetricKey, number>> = {};
      for (const [key] of MODEL_KEYS) {
        const withPredAndResult = rows.filter((g) => g.bundle[key][1] != null && g.winner != null);
        if (!withPredAndResult.length) continue;
        const correct = withPredAndResult.filter((g) => (g.bundle[key][1]! > 0.5 ? "home" : "away") === g.winner).length;
        acc[key] = correct / withPredAndResult.length;
      }
      return { label, n: rows.length, underdogWinRate, modelAcc: acc };
    });
  }, [gameModelRows]);

  // Season pager for the card grid — newest season first ("starting with
  // last season"), independent of the week-number filter above.
  const seasonsForWeek = useMemo(() => [...new Set(weekSchedRows.map((r) => Number(r.season)))].sort((a, b) => b - a), [weekSchedRows]);
  useEffect(() => {
    if (selectedSeason && seasonsForWeek.includes(Number(selectedSeason))) return;
    if (seasonsForWeek.length) setSelectedSeason(String(seasonsForWeek[0]));
  }, [seasonsForWeek, selectedSeason]);
  const seasonIdx = seasonsForWeek.indexOf(Number(selectedSeason));
  const stepSeason = (dir: -1 | 1) => {
    // seasonsForWeek is sorted newest-first, so "older" moves the index forward.
    const next = seasonsForWeek[seasonIdx + dir];
    if (next != null) setSelectedSeason(String(next));
  };

  // Probability-vs-spread scatter's own season selection — starts on just
  // the currently-paginated season (seeded once, not kept in sync with the
  // pager afterward) so the chart opens clean; the season chips below it
  // are how you "add more seasons to see how they contribute."
  useEffect(() => {
    if (selectedGraphSeasons.size > 0) return;
    if (seasonsForWeek.length) setSelectedGraphSeasons(new Set([seasonsForWeek[0]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once only
  }, [seasonsForWeek]);
  const toggleGraphSeason = (season: number) => {
    setSelectedGraphSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  };
  const toggleVisibleModel = (key: MetricKey) => {
    setVisibleModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const probSpreadRows = useMemo(
    () => gameModelRows.filter((r) => selectedGraphSeasons.has(r.season)),
    [gameModelRows, selectedGraphSeasons],
  );
  const probSpreadChartOption = useMemo(() => {
    const pointsByModel: [MetricKey, ProbSpreadPoint[]][] = MODEL_KEYS.map(([key]) => key)
      .filter((key) => visibleModels.has(key))
      .map((key) => [key, buildProbSpreadPoints(probSpreadRows, key)]);
    return buildProbSpreadChartOption(pointsByModel);
  }, [probSpreadRows, visibleModels]);
  const probSpreadChartRef = useECharts(probSpreadChartOption);

  const annotationCtx = useMemo(
    () => ({ allAgreeStat, pairwiseResolution, tossUpAccuracy, bestTossUp }),
    [allAgreeStat, pairwiseResolution, tossUpAccuracy, bestTossUp],
  );

  const cardsForSeason = useMemo(() => {
    const rows = gameModelRows
      .filter((r) => r.season === Number(selectedSeason))
      .map((r) => {
        const [pL, pR] = r.bundle[primary];
        const conf = pL != null && pR != null ? Math.max(pL, pR) : -1;
        const category = categorizeGame(r.bundle);
        const annotation = buildAnnotation(category, annotationCtx);
        return { ...r, conf, annotation, category };
      });
    const byTime = (a: (typeof rows)[number], b: (typeof rows)[number]) => kickoffMs(a.g) - kickoffMs(b.g) || String(a.g.game_id).localeCompare(String(b.g.game_id));
    if (sortMode === "confidence") rows.sort((a, b) => b.conf - a.conf || byTime(a, b));
    else if (sortMode === "disagree") rows.sort((a, b) => b.disagreement - a.disagreement || byTime(a, b));
    else rows.sort(byTime);
    return rows;
  }, [gameModelRows, selectedSeason, primary, sortMode, annotationCtx]);

  // ---------- Section 3: correlation vs every prior week ----------
  const pairsForWeeks = useMemo(() => {
    return (w: number, target: number): { xs: number[]; ys: number[] } => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const season of seasons) {
        const rows = teamWeekBySeason.get(season) ?? [];
        const wRows = rows.filter((r) => Number(r.week) === w);
        const targetByTeam = new Map(rows.filter((r) => Number(r.week) === target).map((r) => [String(r.team), r]));
        for (const wr of wRows) {
          const tr = targetByTeam.get(String(wr.team));
          if (wr.win == null || !tr || tr.win == null) continue;
          xs.push(Number(wr.win));
          ys.push(Number(tr.win));
        }
      }
      return { xs, ys };
    };
  }, [seasons, teamWeekBySeason]);

  const priorWeekCorr = useMemo(() => {
    if (!teamWeekLoaded || selectedWeekNum <= 1) return [];
    const out: { week: number; lag: number; r: number | null; n: number }[] = [];
    for (let w = selectedWeekNum - 1; w >= 1; w--) {
      const { xs, ys } = pairsForWeeks(w, selectedWeekNum);
      out.push({ week: w, lag: selectedWeekNum - w, r: pearsonCorrelation(xs, ys), n: xs.length });
    }
    return out.reverse(); // chronological, week 1 first
  }, [teamWeekLoaded, selectedWeekNum, pairsForWeeks]);

  const strongestPrior = useMemo(() => {
    const withR = priorWeekCorr.filter((p) => p.r != null);
    if (!withR.length) return null;
    return withR.reduce((best, cur) => (Math.abs(cur.r!) > Math.abs(best.r!) ? cur : best));
  }, [priorWeekCorr]);

  const lastPriorBreakdown = useMemo(() => {
    if (selectedWeekNum <= 1) return null;
    const { xs, ys } = pairsForWeeks(selectedWeekNum - 1, selectedWeekNum);
    if (!xs.length) return null;
    const afterWin = ys.filter((_, i) => xs[i] === 1);
    const afterLoss = ys.filter((_, i) => xs[i] === 0);
    const rate = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return {
      priorWeek: selectedWeekNum - 1,
      n: xs.length,
      baseline: rate(ys),
      afterWin: rate(afterWin),
      afterLoss: rate(afterLoss),
      nAfterWin: afterWin.length,
      nAfterLoss: afterLoss.length,
    };
  }, [selectedWeekNum, pairsForWeeks]);

  // Per-team momentum: does THIS team's result the prior week swing its
  // result this week, more or less than the pooled breakdown above?
  const momentumByTeam = useMemo(() => {
    if (selectedWeekNum <= 1) return [];
    const w = selectedWeekNum - 1;
    const byTeam = new Map<string, { afterWin: number[]; afterLoss: number[] }>();
    for (const season of seasons) {
      const rows = teamWeekBySeason.get(season) ?? [];
      const wRows = rows.filter((r) => Number(r.week) === w);
      const targetByTeam = new Map(rows.filter((r) => Number(r.week) === selectedWeekNum).map((r) => [String(r.team), r]));
      for (const wr of wRows) {
        const team = String(wr.team);
        const tr = targetByTeam.get(team);
        if (wr.win == null || !tr || tr.win == null) continue;
        if (!byTeam.has(team)) byTeam.set(team, { afterWin: [], afterLoss: [] });
        const rec = byTeam.get(team)!;
        (Number(wr.win) === 1 ? rec.afterWin : rec.afterLoss).push(Number(tr.win));
      }
    }
    const rate = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return [...byTeam.entries()]
      .map(([team, rec]) => {
        const afterWinRate = rate(rec.afterWin);
        const afterLossRate = rate(rec.afterLoss);
        const swing = afterWinRate != null && afterLossRate != null ? afterWinRate - afterLossRate : null;
        return { team, afterWinRate, afterLossRate, swing, nWin: rec.afterWin.length, nLoss: rec.afterLoss.length };
      })
      .sort((a, b) => Math.abs(b.swing ?? -1) - Math.abs(a.swing ?? -1));
  }, [selectedWeekNum, seasons, teamWeekBySeason]);

  const corrChartOption = useMemo<EChartsOption | null>(() => {
    if (!priorWeekCorr.length) return null;
    const posGrad = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "#2459A7" },
      { offset: 1, color: "#8fabdc" },
    ]);
    const negGrad = new echarts.graphic.LinearGradient(0, 1, 0, 0, [
      { offset: 0, color: "#C8102E" },
      { offset: 1, color: "#e79aa6" },
    ]);
    return {
      grid: { left: 48, right: 16, top: 20, bottom: 44, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (p: unknown) => {
          const param = Array.isArray(p) ? p[0] : p;
          const idx = (param as { dataIndex: number }).dataIndex;
          const row = priorWeekCorr[idx];
          return `Week ${row.week} (${row.lag} back)<br/>r = ${row.r != null ? row.r.toFixed(2) : "—"}<br/>n = ${row.n}`;
        },
      },
      xAxis: { type: "category", data: priorWeekCorr.map((p) => `Wk ${p.week}`), name: "Prior week", nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", min: -1, max: 1, name: "r", nameLocation: "middle", nameGap: 30, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      series: [
        {
          type: "bar",
          barMaxWidth: 40,
          data: priorWeekCorr.map((p) => (p.r == null ? null : +p.r.toFixed(3))),
          itemStyle: { color: (params: { value: number }) => (params.value >= 0 ? posGrad : negGrad), borderRadius: [4, 4, 4, 4] },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [priorWeekCorr]);
  const corrChartRef = useECharts(corrChartOption);

  if (loadError) return <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!reg.length) return <Loading label="Loading schedule…" />;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Week" value={selectedWeek} onChange={setSelectedWeek} options={weekOptions.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <p className="max-w-md text-xs text-slate-500">
            Aggregates every REG-season Week {selectedWeek || "…"} across all {seasonsCoveredThisWeek || 0} seasons of data — not a specific
            season, a look at how this week number has historically played out.
          </p>
        </div>
      </Card>

      {!weekSchedRows.length ? (
        <Empty label="No games for this week yet." />
      ) : (
        <>
          {/* Section 1 */}
          <Card title="Spread distribution over the years" subtitle={`Week ${selectedWeek} across ${seasonsCoveredThisWeek} seasons`}>
            <div className="space-y-4">
              {spreadStats && (
                <div className="flex flex-wrap gap-3">
                  <Kpi label="Games" value={spreadStats.n} sub={`${seasonsCoveredThisWeek} seasons`} />
                  <Kpi label="Avg |Spread|" value={spreadStats.mean.toFixed(1)} />
                  <Kpi label="Median |Spread|" value={spreadStats.med.toFixed(1)} />
                  <Kpi label="Std Dev" value={spreadStats.std.toFixed(1)} />
                  <Kpi label="IQR" value={spreadStats.iqr.toFixed(1)} />
                  <Kpi label="Min / Max" value={`${spreadStats.min.toFixed(1)} / ${spreadStats.max.toFixed(1)}`} />
                </div>
              )}
              {seasonsCoveredThisWeek < 5 && (
                <p className="text-xs text-amber-600">Only {seasonsCoveredThisWeek} season(s) of data for this week — read with caution.</p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Box plots show</span>
                <div className="flex gap-2">
                  {([["abs", "|Spread|"], ["raw", "No change"]] as const).map(([m, lbl]) => (
                    <button
                      key={m}
                      onClick={() => setSpreadMode(m)}
                      className={`rounded-full px-3 py-1.5 text-sm ${spreadMode === m ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Histogram</h3>
                  <div ref={spreadHistRef} className="h-[340px]" />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Spread by season (box plot)</h3>
                  <div className="mb-1 text-[11px] text-slate-400">Click a box to see that season's games.</div>
                  <div ref={spreadBoxRef} className="h-[340px] cursor-pointer" />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Similar weeks (auto-detected)</h3>
                  {similarWeeksBoxOption ? (
                    <>
                      <div className="mb-1 text-[11px] text-slate-400">Click a box to see those games.</div>
                      <div ref={similarWeeksBoxRef} className="h-[340px] cursor-pointer" />
                    </>
                  ) : (
                    <div className="flex h-[340px] items-center justify-center text-center text-xs text-slate-400">
                      Not enough data yet to find comparable weeks.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {gamesModal && (
            <WinTypeDetailModal x="" xLabel={gamesModal.label} games={gamesModal.games} onClose={() => setGamesModal(null)} />
          )}

          {/* Section 2 */}
          <Card title="Model behavior for this week's games" subtitle="All models the app computes — production regression, market/ML fair, market-calibrated blend, Elo, Pythagorean, Trend Edge, and their consensus average.">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex flex-wrap gap-3">
                  <Kpi label="Games analyzed" value={section2Kpis.n} sub={section2Kpis.nExcluded ? `${section2Kpis.nExcluded} with <2 models` : undefined} />
                  <Kpi label="Avg. disagreement" value={section2Kpis.avgDisagreement != null ? `${(section2Kpis.avgDisagreement * 100).toFixed(1)}pp` : "—"} />
                  <Kpi label="All-models-agree rate" value={section2Kpis.allAgreeRate != null ? `${Math.round(section2Kpis.allAgreeRate * 100)}%` : "—"} />
                  <Kpi label="Underdog win rate" value={section2Kpis.underdogWinRate != null ? `${Math.round(section2Kpis.underdogWinRate * 100)}%` : "—"} sub="vs. market-calibrated favorite" />
                </div>
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Avg. confidence by model</span>
                  <AvgConfidenceStrip avg={avgConfidenceByModel} />
                </div>
                {agreementChartOption && (
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Model agreement — vs. each other &amp; the actual winner</span>
                    <div ref={agreementChartRef} className="mt-1" style={{ width: 260, height: 260 }} />
                  </div>
                )}
              </div>

              {anyCompleted && (
                <div className="flex flex-wrap gap-2">
                  {modelAcc.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setPrimary(m.key)}
                      className={`min-w-28 rounded-2xl border px-2.5 py-1.5 text-left shadow-sm transition-all ${primary === m.key ? "scale-[1.03] ring-2 ring-offset-1" : "opacity-60 hover:opacity-90"}`}
                      style={{
                        borderColor: `${MODEL_COLORS[m.key]}66`,
                        borderTop: `3px solid ${MODEL_COLORS[m.key]}`,
                        background: `${MODEL_COLORS[m.key]}14`,
                        ...(primary === m.key ? { ["--tw-ring-color" as string]: MODEL_COLORS[m.key] } : {}),
                      }}
                      title={`${m.label}: ${m.total ? `${m.correct}/${m.total} correct` : "no results yet"} — click to make it the card's primary model`}
                    >
                      <div className="truncate text-[10px] font-semibold" style={{ color: MODEL_COLORS[m.key] }}>
                        {m.label}
                      </div>
                      <div className="text-base font-bold leading-none tabular-nums text-slate-800">{m.total ? `${m.correct}/${m.total}` : "—"}</div>
                      <div className="text-[10px] text-slate-500">{m.total > 0 ? `${Math.round((100 * m.correct) / m.total)}%` : "no results yet"}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Card order</span>
                  <div className="flex gap-2">
                    {([["time", "Time"], ["confidence", "Highest prob"], ["disagree", "Disagreement"]] as const).map(([m, lbl]) => (
                      <button
                        key={m}
                        onClick={() => setSortMode(m)}
                        className={`rounded-full px-3 py-1.5 text-sm ${sortMode === m ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={stepBtnCls} onClick={() => stepSeason(1)} disabled={seasonIdx < 0 || seasonIdx >= seasonsForWeek.length - 1} title="Older season">
                    ‹
                  </button>
                  <Select label="Season" value={selectedSeason} onChange={setSelectedSeason} options={seasonsForWeek.map((s) => ({ value: String(s), label: String(s) }))} />
                  <button className={stepBtnCls} onClick={() => stepSeason(-1)} disabled={seasonIdx <= 0} title="Newer season">
                    ›
                  </button>
                  <span className="text-xs text-slate-400">
                    {cardsForSeason.length} game{cardsForSeason.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>
                  <span className="mr-1 rounded border border-emerald-200 bg-emerald-50 px-1 text-emerald-700">🤝</span>
                  All models agree — historical win rate of that side
                </span>
                <span>
                  <span className="mr-1 rounded border border-amber-200 bg-amber-50 px-1 text-amber-700">🪙</span>
                  Toss-up — best-performing model in these spots
                </span>
                <span>
                  <span className="mr-1 rounded border border-sky-200 bg-sky-50 px-1 text-sky-700">⚡</span>
                  Two models split — which one to trust here
                </span>
              </p>

              <div className="space-y-4">
                {cardsForSeason.map((r) => (
                  <DotStripRow
                    key={String(r.g.game_id)}
                    g={r.g}
                    bundle={r.bundle}
                    teamMeta={teamMeta}
                    annotation={r.annotation}
                    category={r.category}
                    allAgreeStat={allAgreeStat}
                    pairwiseResolution={pairwiseResolution}
                    tossUpAccuracy={tossUpAccuracy}
                  />
                ))}
                {!cardsForSeason.length && <div className="py-8 text-center text-sm text-slate-400">No games found for this season.</div>}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Does model disagreement predict upsets?</h3>
                <div className={tableWrapCls}>
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead className={theadCls}>
                      <tr>
                        <th className={`px-3 py-2 ${stickyColHeadCls}`}>Disagreement</th>
                        <th className="px-3 py-2 text-right">Games</th>
                        <th className="px-3 py-2 text-right">Underdog win rate</th>
                        {MODEL_KEYS.map(([key, label]) => (
                          <th key={key} className="px-3 py-2 text-right">
                            {label} acc.
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {disagreementBuckets.map((b) => (
                        <tr key={b.label} className={trCls}>
                          <td className={`px-3 py-1.5 font-semibold ${stickyColCls}`}>{b.label}</td>
                          <td className="px-3 py-1.5 text-right">{b.n}</td>
                          <td className="px-3 py-1.5 text-right">{b.underdogWinRate != null ? `${Math.round(b.underdogWinRate * 100)}%` : "—"}</td>
                          {MODEL_KEYS.map(([key]) => (
                            <td key={key} className="px-3 py-1.5 text-right">
                              {b.modelAcc[key] != null ? `${Math.round(b.modelAcc[key]! * 100)}%` : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className={scrollHintCls} />
                  <ScrollHint />
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-700">Model probability vs. spread</h3>
                <p className="mb-2 text-xs text-slate-500">
                  Each dot is one model's P(home wins) for a game at that spread. Dots grow where several games land in the same spot —
                  hover a dot to see which game(s), their score, and the winner. Color shows the outcome:{" "}
                  <span className="font-semibold text-slate-800">darker, solid</span> means the model correctly predicted the winner,{" "}
                  <span className="font-semibold text-slate-400">lighter</span> means it picked wrong, and the model's normal color means
                  the game hasn't been played yet. Correct picks also get a{" "}
                  <span className="font-semibold text-emerald-800">dark-green ring</span>.
                </p>

                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Seasons</span>
                  {seasonsForWeek.map((s) => {
                    const on = selectedGraphSeasons.has(s);
                    return (
                      <button
                        key={s}
                        onClick={() => toggleGraphSeason(s)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          on ? "border-[#002f6c] bg-[#002f6c] text-white" : "border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Models</span>
                  {MODEL_KEYS.map(([key, label]) => {
                    const on = visibleModels.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggleVisibleModel(key)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-all ${on ? "" : "opacity-40 grayscale"}`}
                        style={{ borderColor: `${MODEL_COLORS[key]}88`, background: `${MODEL_COLORS[key]}1a`, color: MODEL_COLORS[key] }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {probSpreadChartOption ? (
                  <div ref={probSpreadChartRef} className="h-[380px]" />
                ) : (
                  <Empty label="Select at least one season and one model to plot." />
                )}
              </div>
            </div>
          </Card>

          {/* Section 3 */}
          <Card title="Does a prior week predict this week?" subtitle="Per-team win/loss correlation between the selected week and every prior week, across seasons.">
            {selectedWeekNum <= 1 ? (
              <Empty label="Week 1 has no prior weeks to correlate against." />
            ) : (
              <div className="space-y-4">
                {strongestPrior && (
                  <div className="flex flex-wrap gap-3">
                    <Kpi
                      label="Strongest prior week"
                      value={`Wk ${strongestPrior.week}`}
                      sub={`r = ${strongestPrior.r!.toFixed(2)} · ${correlationRead(strongestPrior.r)} · n=${strongestPrior.n}`}
                    />
                  </div>
                )}
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-700">Correlation by prior week (win/loss)</h3>
                  <div ref={corrChartRef} className="h-[300px]" />
                </div>
                {lastPriorBreakdown && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-700">
                      Week {lastPriorBreakdown.priorWeek} result vs. Week {selectedWeek} result (n={lastPriorBreakdown.n} team-seasons)
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      <Kpi
                        label={`Win rate in Wk ${selectedWeek} after Wk ${lastPriorBreakdown.priorWeek} win`}
                        value={lastPriorBreakdown.afterWin != null ? `${Math.round(lastPriorBreakdown.afterWin * 100)}%` : "—"}
                        sub={`n=${lastPriorBreakdown.nAfterWin}`}
                      />
                      <Kpi
                        label={`Win rate in Wk ${selectedWeek} after Wk ${lastPriorBreakdown.priorWeek} loss`}
                        value={lastPriorBreakdown.afterLoss != null ? `${Math.round(lastPriorBreakdown.afterLoss * 100)}%` : "—"}
                        sub={`n=${lastPriorBreakdown.nAfterLoss}`}
                      />
                      <Kpi
                        label={`Baseline win rate in Wk ${selectedWeek}`}
                        value={lastPriorBreakdown.baseline != null ? `${Math.round(lastPriorBreakdown.baseline * 100)}%` : "—"}
                      />
                    </div>
                  </div>
                )}
                {momentumByTeam.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-slate-700">
                      Team record in Week {selectedWeek}, split by Week {lastPriorBreakdown?.priorWeek} result
                    </h3>
                    <p className="mb-2 max-w-2xl text-xs text-slate-500">
                      Not a live streak — a historical split, pooled across all {seasons.length} seasons of data: for each team, how often it won Week{" "}
                      {selectedWeek} in seasons where it had <span className="font-semibold text-slate-600">also won</span> Week{" "}
                      {lastPriorBreakdown?.priorWeek}, versus seasons where it had <span className="font-semibold text-slate-600">lost</span> Week{" "}
                      {lastPriorBreakdown?.priorWeek}. "Swing" is the gap between those two rates — a large swing means this team's Week{" "}
                      {lastPriorBreakdown?.priorWeek} result has historically been a strong signal for Week {selectedWeek}; a small one means it hasn't
                      mattered much. Click a team to see the exact seasons behind its numbers. Rows sorted by |swing|.
                    </p>
                    <div className={tableWrapCls}>
                      <table className="w-full border-separate border-spacing-0 text-xs">
                        <thead className={theadCls}>
                          <tr>
                            <th className={`px-3 py-2 ${stickyColHeadCls}`}>Team</th>
                            <th className="px-3 py-2 text-right">
                              After win
                              <InfoDot text={`Share of seasons where this team won both Week ${lastPriorBreakdown?.priorWeek} and Week ${selectedWeek}, out of every season it won Week ${lastPriorBreakdown?.priorWeek}.`} />
                            </th>
                            <th className="px-3 py-2 text-right">
                              After loss
                              <InfoDot text={`Share of seasons where this team lost Week ${lastPriorBreakdown?.priorWeek} but still won Week ${selectedWeek}, out of every season it lost Week ${lastPriorBreakdown?.priorWeek}.`} />
                            </th>
                            <th className="px-3 py-2 text-right">
                              Swing
                              <InfoDot text="After-win rate minus after-loss rate. Positive = winning the prior week correlates with winning this week; negative = the opposite (bounce-back tendency)." />
                            </th>
                            <th className="px-3 py-2 text-right">
                              n (W / L)
                              <InfoDot text="Sample size behind each rate: number of pooled seasons the team both won (W) or lost (L) the prior week and also has a result for this week. Small samples are noisy — read swing cautiously below ~10." />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {momentumByTeam.map((t) => {
                            const logo = teamMeta.get(t.team)?.logo;
                            return (
                              <tr key={t.team} className={trCls}>
                                <td className={`px-3 py-1.5 ${stickyColCls}`}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedMomentumTeam(t.team)}
                                    className="flex items-center gap-2 font-semibold text-[#002f6c] hover:underline"
                                  >
                                    {logo && <img src={logo} alt="" className="h-5 w-5 object-contain" />}
                                    {t.team}
                                  </button>
                                </td>
                                <td className="px-3 py-1.5 text-right">{t.afterWinRate != null ? `${Math.round(t.afterWinRate * 100)}%` : "—"}</td>
                                <td className="px-3 py-1.5 text-right">{t.afterLossRate != null ? `${Math.round(t.afterLossRate * 100)}%` : "—"}</td>
                                <td className="px-3 py-1.5 text-right font-semibold" style={t.swing != null ? { color: t.swing >= 0 ? "#166534" : "#991b1b" } : undefined}>
                                  {t.swing != null ? `${t.swing >= 0 ? "+" : ""}${Math.round(t.swing * 100)}pp` : "—"}
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-400">
                                  {t.nWin} / {t.nLoss}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className={scrollHintCls} />
                      <ScrollHint />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {selectedMomentumTeam &&
        (() => {
          const row = momentumByTeam.find((t) => t.team === selectedMomentumTeam);
          if (!row) return null;
          return (
            <TeamMomentumDetail
              row={row}
              meta={teamMeta.get(selectedMomentumTeam)}
              priorWeek={selectedWeekNum - 1}
              targetWeek={selectedWeekNum}
              teamWeekBySeason={teamWeekBySeason}
              reg={reg}
              onClose={() => setSelectedMomentumTeam(null)}
            />
          );
        })()}
    </div>
  );
}
