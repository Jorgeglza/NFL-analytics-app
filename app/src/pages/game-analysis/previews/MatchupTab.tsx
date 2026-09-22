// Port of matchup_previews_tab.py — single-game deep dive: snapshot, moneyline,
// spread pick engine, trend edge predictor, trends, recent form, H2H.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { Select } from "../../../components/filters/Select";
import { FilterGroup } from "../../../components/ui";
import { TeamLogoLink } from "../../../components/team/TeamLogoLink";
import { Modal } from "../../../components/Modal";
import { pythWinPct } from "../../../lib/logic/pythagorean";
import { useECharts } from "../../../components/charts/useECharts";
import { MIN_N_BUCKET, MARKET_BUCKET_W, ATS_WINDOW, homeCoverFairProb, vigLeanProbHome, atsTrendProbHome } from "../../../lib/logic/probBlend";
import { edgeComposite, EDGE_WEIGHTS } from "../../../lib/logic/edgeComposite";
import { impliedProb, fairProbs } from "../../../lib/logic/moneyline";
import { opponentLabel } from "../../grading-model/shared";
import { usePageTitle } from "../../../lib/hooks/usePageTitle";
import {
  favoriteSide,
  bucketLabel,
  marketRate,
  bucketWindow,
  atsRate,
  defaultWeekNearToday,
  kickoffMs,
  probBundle,
  pickWinner,
  MODEL_KEYS,
  MODEL_COLORS,
  buildScheduleEloHistoryIndex,
  alignedEloTimeline,
  alignedMarginTimeline,
  predictiveKey,
  topPredictiveDrivers,
  predictiveWindowFull,
  predictedMarginFromFeatures,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
  type EloIndex,
  type EloHistoryIndex,
  type EloTimelineSlot,
  type MarginTimelineSlot,
  type PredictiveIndex,
  type PredictiveCoverage,
  type PredictiveFeaturesIndex,
  type PredictiveDriver,
  type BucketWindowPoint,
  predictiveDisclaimer,
} from "./engine";
import type { EloRatingPoint } from "../../../lib/logic/elo";
import { labelFor } from "../../predictive-model/shared";
import { describeFeature } from "../../predictive-model/featureDescriptions";

const fmtMl = (ml: number | null) => (ml == null ? "—" : ml > 0 ? `+${Math.round(ml)}` : String(Math.round(ml)));
const pct1 = (p: number | null) => (p == null ? "—" : `${(100 * p).toFixed(1)}%`);
const fmtSigned = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
/** "-22.0 to -21.0" -> "-22 to -21" — drops the always-.0 decimals (bin size
 * is always whole points in practice) so the bucket range reads at a glance
 * instead of eating the label column. */
const shortBucketRange = (bucket: string | null): string | null => bucket == null ? null : bucket.replace(/\.0\b/g, "");

/** Horizontal probability bar (home-side share by convention) with a 50% tick.
 * Optionally overlays a 95% Wilson confidence bracket (two end-ticks + a
 * connecting line) at `ciLow`/`ciHigh` — the statistical-significance read
 * for *this exact* estimate (its own sample, not a neighborhood of other
 * buckets): a narrow bracket says trust the number, a wide one says it's
 * still thin even after any widening. Used by Market-calibrated's bucket-
 * history row; other callers simply don't pass ciLow/ciHigh. */
function ProbBar({
  label,
  p,
  color,
  note,
  partialWindow = false,
  labelWidthClass = "w-32",
  noteWidthClass = "w-20",
  ciLow,
  ciHigh,
}: {
  label: string;
  p: number | null;
  color: string;
  note?: string;
  /** Marks the % with a "*" — used only by the Predictive model's own probability, only on this
   *  (Matchup) tab, when this specific matchup's L3 rolling-window features didn't have a full
   *  3-game window on both sides yet (see `predictiveWindowFull` in engine.ts). */
  partialWindow?: boolean;
  /** Override the fixed label/note column widths for a row whose text runs longer
   *  than the other rows it sits above/below (e.g. Market-calibrated's bucket-history
   *  row, which carries a spread range plus a widened-bucket note). */
  labelWidthClass?: string;
  noteWidthClass?: string;
  /** 95% Wilson CI bounds (0-1, home-side probability) for this bar's own estimate. */
  ciLow?: number | null;
  ciHigh?: number | null;
}) {
  const hasCi = ciLow != null && ciHigh != null;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`${labelWidthClass} shrink-0 truncate text-slate-500`} title={label}>{label}</span>
      <div
        className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100"
        title={hasCi ? `95% confidence interval: ${Math.round(100 * ciLow)}–${Math.round(100 * ciHigh)}%` : undefined}
      >
        <div className="absolute inset-y-0 left-1/2 z-10 w-px bg-slate-300" />
        {p != null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, 100 * p))}%`, background: color, opacity: 0.85 }} />}
        {hasCi && (
          <div className="absolute inset-y-0 z-20" style={{ left: `${100 * ciLow}%`, width: `${100 * (ciHigh - ciLow)}%` }}>
            <div className="absolute inset-y-[3px] left-0 w-px bg-slate-700/60" />
            <div className="absolute inset-y-[3px] right-0 w-px bg-slate-700/60" />
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-700/60" />
          </div>
        )}
      </div>
      <span className="w-10 shrink-0 text-right font-bold tabular-nums">{p == null ? "—" : `${Math.round(100 * p)}%${partialWindow ? "*" : ""}`}</span>
      {note != null && <span className={`${noteWidthClass} shrink-0 truncate text-slate-400`} title={note}>{note}</span>}
    </div>
  );
}

/** Small stat tile for a secondary signal (vig lean / ATS trend) — a
 * headline probability, its actual weight in the final blend (the two
 * signals split whatever's left after bucket history's 85%, so weight
 * varies with which are available for this game — see probBlend.ts), and a
 * one-line "how we got there" detail. Kept deliberately tiny: these are
 * minor, low-standalone-accuracy inputs (see ModelsGuide) so they shouldn't
 * visually compete with bucket history above. */
function SignalKPI({ label, p, weightPct, detail }: { label: string; p: number | null; weightPct: number; detail: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[8px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="shrink-0 text-[8px] font-medium text-slate-400">{weightPct}% wt</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xs font-bold text-slate-700">{p == null ? "—" : `${Math.round(100 * p)}%`}</span>
        <span className="min-w-0 truncate text-[8px] text-slate-400" title={detail}>{detail}</span>
      </div>
    </div>
  );
}

const fmtVal = (v: number) => (Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(2));

/** One predictive-model concept's row, ranked by |contribution| (largest first — see
 *  `topPredictiveDrivers` in engine.ts, already sorted). Shows the actual home/away values (the
 *  real, tangible stat) and its exact impact on the predicted margin for THIS game, in points —
 *  colored by *which team's color* it favors (not a generic green/red), matching the Elo card's
 *  team-color convention elsewhere on this tab. Collinear families are pre-collapsed so this
 *  point value is safe to read at face value and actually varies from game to game, unlike a
 *  global importance percentage that's identical for every matchup. The bar is sized relative to
 *  the other shown drivers' impact (purely a visual scale, not a percentage of anything). Hover
 *  for the feature's plain-language description plus the exact numbers — see `describeFeature`
 *  (predictive-model/featureDescriptions). */
function ContribRow({
  r,
  away,
  home,
  awayColor,
  homeColor,
  maxAbsContrib,
}: {
  r: PredictiveDriver;
  away: string;
  home: string;
  awayColor: string;
  homeColor: string;
  maxAbsContrib: number;
}) {
  const towardHome = r.contrib >= 0;
  const team = towardHome ? home : away;
  const color = towardHome ? homeColor : awayColor;
  const barPct = maxAbsContrib > 0 ? Math.max(6, Math.min(100, (Math.abs(r.contrib) / maxAbsContrib) * 100)) : 6;
  const actual = r.home != null && r.away != null ? `${away} ${fmtVal(r.away)} vs ${home} ${fmtVal(r.home)}` : r.diff != null ? `Δ ${fmtVal(r.diff)}` : "";
  const combinedNote = r.familySize > 1 ? ` (combines ${r.familySize} related model inputs, e.g. its own squared/√ transform or a pass/rush split)` : "";
  const detail =
    `${describeFeature(r.feature)}${combinedNote}\n` +
    (actual ? `${actual}${r.diff != null ? ` (diff ${fmtVal(r.diff)})` : ""}\n` : "") +
    `${Math.abs(r.contrib).toFixed(1)} points of the predicted margin, toward ${team} — net of every other factor in the model`;
  return (
    <div className="flex items-center gap-2 text-[11px]" title={detail}>
      <span className="w-24 shrink-0 truncate text-slate-500">{labelFor(r.feature)}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: color, opacity: 0.85 }} />
      </div>
      <span className="w-14 shrink-0 text-right font-bold tabular-nums" style={{ color }}>
        {towardHome ? "+" : "−"}{Math.abs(r.contrib).toFixed(1)}
      </span>
      {actual && <span className="w-28 shrink-0 truncate text-[10px] text-slate-400">{actual}</span>}
    </div>
  );
}

const WIN_DOT = "#3C9A5F";
const LOSS_DOT = "#C8102E";

function seasonBoundaries(slots: EloTimelineSlot[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].season !== slots[i - 1].season) out.push(i);
  }
  return out;
}

/** Both teams' Elo history on one shared, visible Elo-points Y axis — so you can
 *  see how the two ratings stack up against each other and how each is moving.
 *  `slots` is a shared timeline (see `alignedEloTimeline` in engine.ts): each
 *  entry is a (season, week) at least one team played, so a week only one of
 *  them played (most commonly the other team's season having already ended
 *  while this one made the playoffs, or a plain bye week) correctly shows as a
 *  gap in the other team's line rather than silently sliding an older game up
 *  next to it. Each line is colored in its team's own color; each game gets a
 *  small dot, green for a win and red for a loss (subtle, mirrors
 *  trendOption's convention a few lines below in this file). Dotted divider =
 *  a new season.
 *
 *  Tooltip uses trigger:"axis" (forgiving — any x position across the whole
 *  chart fires it, unlike trigger:"item" which needs the cursor within a
 *  couple px of the thin line/dot itself) and picks whichever of the two
 *  teams' points is vertically closer to the cursor, via a live mouseY
 *  tracked through the chart's zrender instance and convertToPixel. */
function EloSpark({
  slots,
  awayColor,
  homeColor,
  awayLabel,
  homeLabel,
}: {
  slots: EloTimelineSlot[];
  awayColor: string;
  homeColor: string;
  awayLabel: string;
  homeLabel: string;
}) {
  const awayP = useMemo(() => slots.map((s) => s.away), [slots]);
  const homeP = useMemo(() => slots.map((s) => s.home), [slots]);
  const dividers = useMemo(() => seasonBoundaries(slots), [slots]);
  const resultWord = (w: boolean | null) =>
    w == null ? '<span style="color:#94a3b8">Tie</span>' : w ? `<span style="color:${WIN_DOT}">Win</span>` : `<span style="color:${LOSS_DOT}">Loss</span>`;
  const dotStyle = (p: EloRatingPoint | null) => (p?.win == null ? "#94a3b8" : p.win ? WIN_DOT : LOSS_DOT);
  // A single-week gap flanked by real games in the *same* season is an ordinary bye — fill it
  // in (interpolated, no dot) so the line reads through it. Anything else null'd out —
  // multi-week gaps, or a gap whose neighbors fall in different seasons — is a real break: the
  // team's season having ended while the other one kept playing (postseason), or is about to
  // start. This can't be a blanket `connectNulls: true` on the series: a whole postseason run of
  // nulls for the non-playoff team also has "real values on both sides" once the next season's
  // games are in view, which would wrongly bridge the entire gap between the two seasons.
  const eloSeriesData = (pts: (EloRatingPoint | null)[]) =>
    pts.map((p, i) => {
      if (p) return { value: +p.rating.toFixed(1), itemStyle: { color: dotStyle(p), opacity: 0.85 } };
      const prev = pts[i - 1];
      const next = pts[i + 1];
      if (prev && next && prev.season === next.season) {
        return { value: +((prev.rating + next.rating) / 2).toFixed(1), symbol: "none" };
      }
      return null;
    });
  // One team's tooltip line, ordered Elo → week/season → result — kept to a single
  // compact line (incl. the opponent's own rating that game) rather than a block.
  const fmtPoint = (label: string, color: string, pt: EloRatingPoint) => {
    const dot = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px"></span>`;
    const bull = '<span style="color:#cbd5e1;margin:0 4px">·</span>';
    return `<div style="white-space:nowrap">${dot}<b>${label} ${Math.round(pt.rating)}</b>${bull}Wk${pt.week} '${String(pt.season).slice(-2)}${bull}${resultWord(pt.win)} vs ${pt.opponent} <span style="color:#94a3b8">(${Math.round(pt.oppRating)})</span></div>`;
  };
  const chartRef = useRef<import("echarts").ECharts | null>(null);
  /** Tooltip content for game index `i`. `cursorY` is the real mouse pixel Y when
   *  known (from `position`) — with it, picks whichever line is closer, unless
   *  they're within 6px (visually merging), in which case both are shown. Without
   *  it (the `formatter` call, which runs before `position` and needs *some*
   *  non-empty content or ECharts skips showing the tooltip entirely), both teams
   *  are shown as the safe default. */
  const buildEloTip = (i: number, cursorY: number | null): string => {
    const a = awayP[i];
    const h = homeP[i];
    if (!a && !h) return "";
    if (!a) return fmtPoint(homeLabel, homeColor, h!);
    if (!h) return fmtPoint(awayLabel, awayColor, a);
    const sep = '<div style="margin:2px 0;border-top:1px solid #e2e8f0"></div>';
    const chart = chartRef.current;
    if (chart && cursorY != null) {
      const yA = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [i, a.rating])[1];
      const yH = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [i, h.rating])[1];
      if (Math.abs(yA - yH) > 6) {
        return Math.abs(yA - cursorY) <= Math.abs(yH - cursorY) ? fmtPoint(awayLabel, awayColor, a) : fmtPoint(homeLabel, homeColor, h);
      }
    }
    return fmtPoint(awayLabel, awayColor, a) + sep + fmtPoint(homeLabel, homeColor, h);
  };
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 30, right: 6, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: awayP.map((_, i) => String(i)), show: false },
      yAxis: {
        type: "value",
        // scale:true (+ explicit padded min/max) keeps the axis off zero — Elo
        // ratings only ever move in a ~1300-1750 band, so a zero baseline would
        // flatten every real difference between the two teams' lines.
        scale: true,
        min: (v: { min: number }) => Math.floor((v.min - 15) / 5) * 5,
        max: (v: { max: number }) => Math.ceil((v.max + 15) / 5) * 5,
        name: "Elo",
        nameTextStyle: { fontSize: 9, color: "#94a3b8" },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        padding: [6, 8],
        textStyle: { fontSize: 11 },
        axisPointer: { type: "line", label: { show: false }, lineStyle: { color: "#e2e8f0", width: 1 } },
        // formatter must return non-empty content up front — an empty string here
        // makes ECharts treat the hover as "nothing to show" and skip rendering the
        // tooltip box entirely (the axisPointer line still appears since that's a
        // separate component, which is exactly the "hover works, no info shown" bug).
        // So formatter renders a safe default (both teams, since it doesn't yet know
        // the real cursor Y), and `position` — which DOES receive the true cursor
        // point, synchronously, with no listener/race — refines it to a single
        // nearest-line pick when the two lines aren't close enough to merge.
        formatter: (ps: unknown) => {
          const i = (ps as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          return buildEloTip(i, null);
        },
        position: (point: unknown, params: unknown, dom: unknown) => {
          const pt2 = point as [number, number];
          const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          (dom as HTMLElement).innerHTML = buildEloTip(i, pt2[1]);
          return [pt2[0] + 12, pt2[1] - 12];
        },
      },
      series: [
        {
          type: "line",
          name: awayLabel,
          data: eloSeriesData(awayP),
          lineStyle: { color: awayColor, width: 2 },
          symbol: "circle",
          symbolSize: 3,
          // false: bye weeks are already filled in with a real (interpolated) value above,
          // so the line naturally runs through them without needing this — a remaining null
          // is a genuine break (postseason gap, or a season boundary) and must stay broken.
          connectNulls: false,
          markLine: dividers.length
            ? { symbol: "none", silent: true, label: { show: false }, lineStyle: { type: "dotted", color: "#cbd5e1", width: 1 }, data: dividers.map((i) => ({ xAxis: i - 0.5 })) }
            : undefined,
        },
        {
          type: "line",
          name: homeLabel,
          data: eloSeriesData(homeP),
          lineStyle: { color: homeColor, width: 2 },
          symbol: "circle",
          symbolSize: 3,
          connectNulls: false,
        },
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [awayP, homeP, dividers, awayColor, homeColor, awayLabel, homeLabel],
  );
  const ref = useECharts(option, {
    onInit: (chart) => {
      chartRef.current = chart;
    },
  });
  if (slots.length < 2) {
    return <div className="flex h-8 items-center text-[10px] italic text-slate-400">Not enough history yet</div>;
  }
  return <div ref={ref} className="h-24 w-full min-w-0" />;
}

/** "W1".."W18" for the regular season, then the round abbreviation for the postseason (weeks
 *  19-22, same numbering the schedule/Elo timeline already use). */
function weekLabel(week: number): string {
  const POST: Record<number, string> = { 19: "WC", 20: "DIV", 21: "CON", 22: "SB" };
  return POST[week] ?? `W${week}`;
}

/** Running (forward-filled) points for/against/margin through each slot, for the cumulative
 *  view — a bye week simply carries the prior total forward rather than breaking the line. */
function cumulativeMarginSeries(slots: MarginTimelineSlot[], side: "away" | "home") {
  let pf = 0;
  let pa = 0;
  return slots.map((s) => {
    const p = s[side];
    if (p) {
      pf += p.scored;
      pa += p.allowed;
    }
    return { pf, pa, margin: pf - pa };
  });
}

/** Points-margin chart for the Pythagorean card — toggles between two views of the exact same
 *  per-game data (see `alignedMarginTimeline`): "Per game" is a bar per team per played week,
 *  diverging from a zero baseline a bar chart includes by default (no `scale:true` needed the way
 *  Elo's line did); "Cumulative" is each team's running point margin as a line, since that's a
 *  continuously-evolving total (an Elo-like state) rather than a discrete per-game event. A week
 *  only one team played (an ordinary bye, or a first-round playoff bye) has no bar for that side
 *  in "Per game" — not a zero-height one — and simply carries its running total flat forward in
 *  "Cumulative". Bars/lines are colored by team; no separate win/loss dot (a bar's own direction,
 *  or a cumulative line's slope, already is the result). Tooltip lists whichever team(s) played
 *  that week — bars and lines here are both spatially unambiguous, so no Elo-style dual-line
 *  nearest-cursor logic is needed. */
function MarginBars({
  slots,
  awayColor,
  homeColor,
  awayLabel,
  homeLabel,
  mode,
}: {
  slots: MarginTimelineSlot[];
  awayColor: string;
  homeColor: string;
  awayLabel: string;
  homeLabel: string;
  mode: "game" | "cumulative";
}) {
  const resultWord = (w: boolean | null) =>
    w == null ? '<span style="color:#94a3b8">Tie</span>' : w ? `<span style="color:${WIN_DOT}">Win</span>` : `<span style="color:${LOSS_DOT}">Loss</span>`;
  const fmtGame = (label: string, color: string, p: NonNullable<MarginTimelineSlot["away"]>) => {
    const dot = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px"></span>`;
    const sign = p.margin >= 0 ? "+" : "";
    return `<div style="white-space:nowrap">${dot}<b>${label}</b> ${p.scored}-${p.allowed} (${sign}${p.margin}) vs ${p.opponent} · ${resultWord(p.win)}</div>`;
  };
  const fmtCumulative = (label: string, color: string, c: { pf: number; pa: number; margin: number }) => {
    const dot = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px"></span>`;
    const sign = c.margin >= 0 ? "+" : "";
    return `<div style="white-space:nowrap">${dot}<b>${label}</b> ${c.pf}-${c.pa} (${sign}${c.margin}) season to date</div>`;
  };
  const awayCum = useMemo(() => cumulativeMarginSeries(slots, "away"), [slots]);
  const homeCum = useMemo(() => cumulativeMarginSeries(slots, "home"), [slots]);
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 26, right: 6, top: 8, bottom: 16, containLabel: true },
      xAxis: { type: "category", data: slots.map((s) => weekLabel(s.week)), axisLabel: { fontSize: 9 }, axisTick: { show: false } },
      yAxis: { type: "value", name: "Margin", nameTextStyle: { fontSize: 9, color: "#94a3b8" }, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      tooltip: {
        trigger: "axis",
        confine: true,
        padding: [6, 8],
        textStyle: { fontSize: 11 },
        axisPointer: { type: mode === "game" ? "shadow" : "line" },
        formatter: (ps: unknown) => {
          const i = (ps as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const slot = slots[i];
          if (mode === "game") {
            const lines: string[] = [];
            if (slot.away) lines.push(fmtGame(awayLabel, awayColor, slot.away));
            if (slot.home) lines.push(fmtGame(homeLabel, homeColor, slot.home));
            return lines.join("");
          }
          return fmtCumulative(awayLabel, awayColor, awayCum[i]) + fmtCumulative(homeLabel, homeColor, homeCum[i]);
        },
      },
      series:
        mode === "game"
          ? [
              { type: "bar", name: awayLabel, data: slots.map((s) => (s.away ? { value: s.away.margin, itemStyle: { color: awayColor, opacity: 0.85 } } : null)) },
              { type: "bar", name: homeLabel, data: slots.map((s) => (s.home ? { value: s.home.margin, itemStyle: { color: homeColor, opacity: 0.85 } } : null)) },
            ]
          : [
              { type: "line", name: awayLabel, data: awayCum.map((c) => +c.margin.toFixed(0)), lineStyle: { color: awayColor, width: 2 }, itemStyle: { color: awayColor }, symbol: slots.length > 1 ? "none" : "circle", symbolSize: 5 },
              { type: "line", name: homeLabel, data: homeCum.map((c) => +c.margin.toFixed(0)), lineStyle: { color: homeColor, width: 2 }, itemStyle: { color: homeColor }, symbol: slots.length > 1 ? "none" : "circle", symbolSize: 5 },
            ],
    }),
    [slots, awayColor, homeColor, awayLabel, homeLabel, mode, awayCum, homeCum],
  );
  const ref = useECharts(option);
  if (slots.length < 1) {
    return <div className="flex h-8 items-center text-[10px] italic text-slate-400">Not enough games yet</div>;
  }
  return <div ref={ref} className="h-24 w-full min-w-0" />;
}

/** One model's breakdown card: pick header + how-it-got-there visual. */
function ModelBlock({
  color,
  title,
  pick,
  prob,
  children,
}: {
  color: string;
  title: string;
  pick: string | null;
  prob: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" style={{ borderTop: `3px solid ${color}` }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {title}
        </div>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: pick ? color : "#cbd5e1" }}>
          {pick ?? "—"}{prob != null && ` · ${Math.round(100 * prob)}%`}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export default function MatchupTab({
  schedule,
  ranks,
  meta,
  hist,
  gradesIdx,
  twIdx,
  eloIdx,
  predIdx,
  predictiveUnavailable = false,
  predictiveCoverage = null,
  predFeaturesIdx,
  initialSelection,
}: {
  schedule: Row[];
  ranks: Map<number, Row[]>; // season -> rank rows
  meta: Map<string, TeamMeta>;
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
  eloIdx: EloIndex;
  predIdx?: PredictiveIndex;
  predictiveUnavailable?: boolean;
  predictiveCoverage?: PredictiveCoverage | null;
  predFeaturesIdx?: PredictiveFeaturesIndex;
  /** Preselect a game (e.g. jumped here from a Week Preview card) — takes priority over URL params. */
  initialSelection?: { season: string; week: string; game: string } | null;
}) {
  const modelKeys = useMemo(() => (predictiveUnavailable ? MODEL_KEYS.filter(([k]) => k !== "predictive") : MODEL_KEYS), [predictiveUnavailable]);
  const [searchParams, setSearchParams] = useSearchParams();
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const [season, setSeason] = useState(initialSelection?.season ?? searchParams.get("season") ?? "");
  const sel = season || String(seasons[0] ?? "");
  const s = Number(sel);
  const weeks = useMemo(
    () => [...new Set(reg.filter((r) => Number(r.season) === s).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [reg, s],
  );
  const [week, setWeek] = useState(initialSelection?.week ?? searchParams.get("week") ?? "");
  const defWeek = useMemo(() => defaultWeekNearToday(reg, s) ?? weeks[weeks.length - 1], [reg, s, weeks]);
  const selWeek = weeks.map(String).includes(week) ? week : String(defWeek ?? "");
  // Commit the resolved week back into state once known, so switching Season keeps the
  // week # that was actually on screen (when it exists in the new season) instead of
  // always falling back to that season's default week — see WeekPreviewTab's identical fix.
  useEffect(() => {
    if (selWeek && selWeek !== week) setWeek(selWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when the resolved week itself changes
  }, [selWeek]);
  const w = Number(selWeek);
  const wkPlayed = Math.max(0, w - 1);

  const games = useMemo(
    () =>
      reg
        .filter((r) => Number(r.season) === s && Number(r.week) === w)
        .sort((a, b) => kickoffMs(a) - kickoffMs(b) || String(a.game_id).localeCompare(String(b.game_id))),
    [reg, s, w],
  );
  const [gameId, setGameId] = useState(initialSelection?.game ?? searchParams.get("game") ?? "");
  const selGame = games.find((g) => String(g.game_id) === gameId) ?? games[0];
  const away = selGame ? String(selGame.away_team) : "";
  const home = selGame ? String(selGame.home_team) : "";
  const [stat, setStat] = useState("points_margin");
  const [pythMode, setPythMode] = useState<"game" | "cumulative">("game");

  // Elo rating history (for the Elo card's sparkline) — built once per schedule load, then
  // aligned to a shared last-17-weeks timeline strictly before this matchup (pre-game only,
  // consistent with wkPlayed/keyStats elsewhere on this tab) — see alignedEloTimeline in
  // engine.ts for why it's a shared timeline rather than each team's own last 17 games.
  const eloHistIdx = useMemo<EloHistoryIndex>(() => buildScheduleEloHistoryIndex(schedule), [schedule]);
  const eloTimeline = useMemo(
    () => alignedEloTimeline(eloHistIdx, away, home, s, w),
    [eloHistIdx, away, home, s, w],
  );

  // Points-margin timeline (for the Pythagorean card's bar chart) — season-scoped, through
  // wkPlayed, same cutoff every other pre-game-only Pythagorean number on this tab already uses.
  const marginTimeline = useMemo(
    () => alignedMarginTimeline(twIdx, away, home, s, wkPlayed),
    [twIdx, away, home, s, wkPlayed],
  );

  // Predictive model — top 5 concepts by this specific game's own |contribution| to the
  // predicted margin (collinear families collapsed first — see topPredictiveDrivers in
  // engine.ts), so both the ranking and the point values genuinely vary game to game.
  const predFeatureRow = useMemo(
    () => (selGame ? predFeaturesIdx?.get(predictiveKey(s, w, away, home)) ?? null : null),
    [predFeaturesIdx, selGame, s, w, away, home],
  );
  const predTop5 = useMemo(() => topPredictiveDrivers(predFeatureRow, 5), [predFeatureRow]);
  // Every concept, same ranking as predTop5 but uncapped — backs the "full breakdown" popout
  // opened by clicking the Predictive card's margin row, as opposed to the top-5 slice shown
  // inline in the card itself.
  const predAllDrivers = useMemo(() => topPredictiveDrivers(predFeatureRow, Infinity), [predFeatureRow]);
  const [predDetailOpen, setPredDetailOpen] = useState(false);
  // Whether this specific matchup's L3 rolling-window features had a full 3-game window on both
  // sides — false in either team's first 3 played weeks of the season. Only ever shown here (the
  // Matchup tab, this one game) — see predictiveWindowFull's docstring in engine.ts.
  const predWindowFull = useMemo(() => (selGame ? predictiveWindowFull(twIdx, away, home, s, w) : true), [selGame, twIdx, away, home, s, w]);
  // Projected final score for the Matchup Snapshot's ML boxes: the predictive model's margin
  // (reconstructed from its own linear decomposition, same source as "Biggest movers" above)
  // split across the market's total line. Null (hidden) whenever either input is missing —
  // no prediction for this game, or no total line posted yet.
  const predictedMargin = useMemo(() => predictedMarginFromFeatures(predFeatureRow), [predFeatureRow]);
  const predictedScores = useMemo(() => {
    if (predictedMargin == null || selGame?.total_line == null) return null;
    const total = Number(selGame.total_line);
    return { away: (total - predictedMargin) / 2, home: (total + predictedMargin) / 2 };
  }, [predictedMargin, selGame]);

  // Keep season/week/game in the URL so "How the models work" (and browser
  // back/forward) can return to the exact matchup being viewed.
  // `setSearchParams` deliberately isn't a dependency here: react-router
  // gives it a new identity on every URL change (it's memoized on the
  // `searchParams` it closes over, which is itself derived from
  // `location.search`), so including it would re-run this effect — and
  // re-stamp season/week/game back onto the URL — after ANY navigation,
  // including a browser Back that had just intentionally left them off.
  useEffect(() => {
    if (!selGame) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("season", sel);
        next.set("week", selWeek);
        next.set("game", String(selGame.game_id));
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSearchParams intentionally excluded, see comment above
  }, [sel, selWeek, selGame]);

  usePageTitle(away && home ? `${away} @ ${home} — Matchup Previews` : "Matchup Previews — Matchup");

  // Jumped here from a Week Preview card (initialSelection set): land on the model
  // verdict strip rather than wherever the page happened to be scrolled to (the
  // Season/Week/Game filters above it, or last scroll position from the previous
  // tab). `scroll-mt` on the target element (below) keeps it clear of the sticky
  // top navbar. Only fires on mount from a card jump, not on every filter change —
  // MatchupTab remounts fresh each time the parent switches into this tab (see
  // MatchupPreviews.tsx), so a plain mount-time effect is exactly "on card select".
  const verdictRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialSelection) return;
    verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount only
  }, []);

  const recordOf = (team: string): string => {
    const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= w && r.win != null);
    const wins = rows.reduce((sm, r) => sm + Number(r.win), 0);
    return `${Math.round(wins)} - ${rows.length - Math.round(wins)}`;
  };

  // ---- pick engine (Market-calibrated: bucket history + vig-lean/ATS extras — see probBlend.ts) ----
  const engine = useMemo(() => {
    if (!selGame) return null;
    const spread = selGame.spread_line == null ? null : Number(selGame.spread_line);
    const fav = favoriteSide(spread);
    let nBucket = 0;
    let bucketWidened = false;
    let bucketHalfWidthPts = 0;
    let bucket: string | null = null;
    let pHome: number | null = null;
    let ciLowHome: number | null = null;
    let ciHighHome: number | null = null;
    if (spread != null && fav != null) {
      bucket = bucketLabel(spread);
      const m = marketRate(hist, bucket, fav, s, w);
      if (m) {
        nBucket = m.n;
        bucketWidened = m.widened;
        bucketHalfWidthPts = m.halfWidthPts;
        pHome = fav === "home" ? m.pHat : 1 - m.pHat;
        // Flipping favorite->home perspective reverses (and swaps) the interval too.
        ciLowHome = fav === "home" ? m.ciLow : 1 - m.ciHigh;
        ciHighHome = fav === "home" ? m.ciHigh : 1 - m.ciLow;
      }
    }
    const homeCoverFair = homeCoverFairProb(
      selGame.away_spread_odds == null ? null : Number(selGame.away_spread_odds),
      selGame.home_spread_odds == null ? null : Number(selGame.home_spread_odds),
    );
    const pVigLeanHome = vigLeanProbHome(homeCoverFair);
    const atsHome = atsRate(hist, home, s, wkPlayed);
    const atsAway = atsRate(hist, away, s, wkPlayed);
    const pAtsTrendHome = atsTrendProbHome(atsHome != null && atsAway != null ? atsHome - atsAway : null);
    const risks: string[] = [];
    if (spread == null) risks.push("No spread for this game (no market prior).");
    if (bucket == null) risks.push("Bucket undefined.");
    if (nBucket < MIN_N_BUCKET) risks.push(`Low-N bucket even after widening to nearby spreads (N=${nBucket}, min ${MIN_N_BUCKET}).`);
    // Zoomed section of the full bucket-calibration curve around this game's own
    // bucket — at least as wide as whatever marketRate actually pooled, so every
    // bucket feeding the headline number is visible on the chart too.
    const bucketWin = spread != null ? bucketWindow(hist, spread, s, w, Math.min(9, Math.max(6, bucketHalfWidthPts))) : null;
    return {
      spread,
      fav,
      bucket,
      nBucket,
      bucketWidened,
      bucketHalfWidthPts,
      pHome,
      ciLowHome,
      ciHighHome,
      bucketWin,
      homeCoverFair,
      pVigLeanHome,
      atsHome,
      atsAway,
      pAtsTrendHome,
      risks,
    };
  }, [selGame, hist, away, home, s, w, wkPlayed]);

  // ---- bucket calibration mini-chart (zoomed section of Spread Analytics'
  // full "Calibration — favorite win % by spread bucket" chart, centered on
  // this game's own bucket) ----
  const bucketCalOption = useMemo<EChartsOption | null>(() => {
    const pts = engine?.bucketWin;
    if (!pts?.length) return null;
    const targetIdx = pts.findIndex((p) => p.isTarget);
    const maxN = Math.max(1, ...pts.map((p) => p.n));
    // Short tick: the bucket's lower edge only ("-5" not "-5.0 to -4.0") —
    // the full range still shows in the tooltip. Bolds/colors just the
    // target bucket's own tick instead of a floating "this game" label, so
    // there's nothing extra to clip regardless of chart width or the
    // (now data-driven) y range.
    const shortTick = (lo: number) => (Number.isInteger(lo) ? String(lo) : lo.toFixed(1));
    const fmtPt = (p: BucketWindowPoint) =>
      `${p.label}${p.isTarget ? " — this game" : ""}<br/>Favorite win %: ${p.pHat == null ? "no history" : `${(100 * p.pHat).toFixed(1)}%`}<br/>N=${p.n}`;
    // Zoom the y-axis to where the data actually sits (padded), instead of
    // the full 0-100 scale, so the curve's real shape/movement is visible.
    const vals = pts.flatMap((p) => [p.pHat, p.ciLow, p.ciHigh]).filter((v): v is number => v != null).map((v) => 100 * v);
    const rawMin = vals.length ? Math.min(...vals) : 0;
    const rawMax = vals.length ? Math.max(...vals) : 100;
    const pad = Math.max(4, (rawMax - rawMin) * 0.2);
    const yMin = Math.max(0, Math.floor((rawMin - pad) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((rawMax + pad) / 5) * 5);
    return {
      grid: { left: 6, right: 6, top: 10, bottom: 20, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => fmtPt(pts[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0]),
      },
      xAxis: {
        type: "category",
        data: pts.map((p) => shortTick(p.lo)),
        axisLabel: {
          fontSize: 9,
          interval: 0,
          formatter: (value: string, idx: number) => (idx === targetIdx ? `{target|${value}}` : value),
          rich: { target: { color: MODEL_COLORS.blend, fontWeight: "bold" as const } },
        },
        axisTick: { show: false },
      },
      yAxis: [
        { type: "value", min: yMin, max: yMax, axisLabel: { fontSize: 9, formatter: "{value}%" }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
        { type: "value", show: false, max: maxN * 3 },
      ],
      series: [
        {
          name: "ci_low",
          type: "line",
          data: pts.map((p) => (p.ciLow == null ? null : +(100 * p.ciLow).toFixed(1))),
          stack: "ci",
          lineStyle: { opacity: 0 },
          symbol: "none",
          tooltip: { show: false },
        },
        {
          name: "ci_band",
          type: "line",
          data: pts.map((p) => (p.ciLow == null || p.ciHigh == null ? null : +(100 * (p.ciHigh - p.ciLow)).toFixed(1))),
          stack: "ci",
          lineStyle: { opacity: 0 },
          symbol: "none",
          areaStyle: { color: "rgba(100,116,139,0.16)" },
          tooltip: { show: false },
        },
        {
          name: "N",
          type: "bar",
          yAxisIndex: 1,
          data: pts.map((p) => p.n),
          itemStyle: { color: "rgba(100,116,139,0.28)" },
          barWidth: "55%",
          tooltip: { show: false },
        },
        {
          name: "Favorite win %",
          type: "line",
          data: pts.map((p) => (p.pHat == null ? null : +(100 * p.pHat).toFixed(1))),
          symbolSize: (_val: unknown, p: { dataIndex: number }) => (p.dataIndex === targetIdx ? 9 : 4),
          itemStyle: { color: MODEL_COLORS.blend },
          lineStyle: { width: 2, color: MODEL_COLORS.blend },
          markLine:
            targetIdx >= 0
              ? {
                  symbol: "none",
                  silent: true,
                  lineStyle: { type: "dashed", color: "#94a3b8" },
                  label: { show: false },
                  data: [{ xAxis: targetIdx }],
                }
              : undefined,
        },
      ],
    } as EChartsOption;
  }, [engine]);
  const bucketCalRef = useECharts(bucketCalOption);

  // ---- all-model bundle for the verdict strip ----
  const bundle = useMemo(
    () => (selGame ? probBundle(selGame, s, w, hist, gradesIdx, twIdx, eloIdx, predIdx) : null),
    [selGame, s, w, hist, gradesIdx, twIdx, eloIdx, predIdx],
  );

  // ---- key stats for the decision card (season-to-date thru week-1) ----
  const keyStats = useMemo(() => {
    if (!selGame) return null;
    const avgOf = (team: string, col: string): number | null => {
      const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r[col] != null);
      if (!rows.length) return null;
      return rows.reduce((sm, r) => sm + Number(r[col]), 0) / rows.length;
    };
    const rankRows = ranks.get(s) ?? [];
    const rankOf = (team: string, col: string): number | null => {
      const v = rankRows.find((r) => String(r.team) === team && Number(r.week) === wkPlayed)?.[`${col}_rank`];
      return v == null ? null : Math.round(Number(v));
    };
    const defs: [string, string, boolean][] = [
      // [label, column, higherIsBetter]
      ["Points/gm", "points", true],
      ["Points allowed/gm", "points_allowed", false],
      ["Total yards/gm", "total_yards", true],
      ["Yards allowed/gm", "total_yards_allowed", false],
      ["EPA diff/gm", "epa_diff", true],
      ["Turnover margin/gm", "turnover_margin", true],
    ];
    const rows = defs.map(([label, col, hib]) => {
      const a = avgOf(away, col);
      const h = avgOf(home, col);
      const better: "away" | "home" | null =
        a == null || h == null || a === h ? null : (hib ? a > h : a < h) ? "away" : "home";
      return { label, a, h, ra: rankOf(away, col), rh: rankOf(home, col), better };
    });
    // model inputs: elo ratings + pythagorean expectation (cumulative points for/against —
    // also exposed raw, not just as a win%, for the Pythagorean card's PF/PA/margin KPIs).
    const eloE = eloIdx.get(String(selGame.game_id));
    const cumPoints = (team: string): { pf: number; pa: number } | null => {
      const tw = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r.points != null && r.points_allowed != null);
      if (!tw.length) return null;
      return { pf: tw.reduce((sm, r) => sm + Number(r.points), 0), pa: tw.reduce((sm, r) => sm + Number(r.points_allowed), 0) };
    };
    const cpAway = cumPoints(away);
    const cpHome = cumPoints(home);
    return {
      rows,
      eloAway: eloE?.eloAway ?? null,
      eloHome: eloE?.eloHome ?? null,
      pythAway: cpAway ? pythWinPct(cpAway.pf, cpAway.pa) : null,
      pythHome: cpHome ? pythWinPct(cpHome.pf, cpHome.pa) : null,
      pfAway: cpAway?.pf ?? null,
      paAway: cpAway?.pa ?? null,
      pfHome: cpHome?.pf ?? null,
      paHome: cpHome?.pa ?? null,
    };
  }, [selGame, twIdx, ranks, eloIdx, away, home, s, wkPlayed]);

  // ---- trend edge ----
  const trendEdge = useMemo(() => {
    if (!selGame) return null;
    const gA = gradesIdx.avgOverall(away, s, wkPlayed);
    const gH = gradesIdx.avgOverall(home, s, wkPlayed);
    const fa = { ...twIdx.features(away, s, wkPlayed), grade: gA };
    const fh = { ...twIdx.features(home, s, wkPlayed), grade: gH };
    const parts = edgeComposite(fa, fh);
    const pAway = parts.pAway;
    const pHome = pAway == null ? null : 1 - pAway;
    return { fa, fh, gA, gH, parts, pAway, pHome, pick: pAway == null || pHome == null ? null : pAway >= pHome ? away : home };
  }, [selGame, gradesIdx, twIdx, away, home, s, wkPlayed]);

  const edgeBarOption = useMemo<EChartsOption | null>(() => {
    if (!trendEdge) return null;
    const names = ["Grade Δ", "Last6 PM Δ", "Last6 EPA Δ", "Last6 Win% Δ", "Last6 TO margin Δ"];
    // Short forms for the on-chart x-axis labels — the full names above are kept for the
    // tooltip. Five multi-word labels don't fit across a mobile-width chart without the
    // outermost one overhanging the plot's edge and getting clipped by the canvas.
    const shortNames = ["Grade Δ", "PM Δ", "EPA Δ", "Win% Δ", "TO marg Δ"];
    const vals = [trendEdge.parts.gradeD, trendEdge.parts.pmL6D, trendEdge.parts.epaL6D, trendEdge.parts.winL6D, trendEdge.parts.tomL6D];
    const detail = [
      [trendEdge.gA, trendEdge.gH, EDGE_WEIGHTS.grade],
      [trendEdge.fa.pmL6, trendEdge.fh.pmL6, EDGE_WEIGHTS.pmL6],
      [trendEdge.fa.epaL6, trendEdge.fh.epaL6, EDGE_WEIGHTS.epaL6],
      [trendEdge.fa.winL6, trendEdge.fh.winL6, EDGE_WEIGHTS.winL6],
      [trendEdge.fa.tomL6, trendEdge.fh.tomL6, EDGE_WEIGHTS.tomL6],
    ];
    const f2 = (x: number | null, signed = false) => (x == null || !Number.isFinite(x) ? "—" : `${signed && x >= 0 ? "+" : ""}${x.toFixed(2)}`);
    return {
      grid: { left: 6, right: 6, top: 20, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number; name: string };
          const [a, h, wt] = detail[q.dataIndex];
          const d = (a ?? 0) - (h ?? 0);
          return `${q.name}<br/>Away: ${f2(a)} | Home: ${f2(h)}<br/>Diff (Away − Home): ${f2(d, true)}<br/>Weight: ${f2(wt)}<br/><b>Contribution:</b> ${f2(vals[q.dataIndex], true)}`;
        },
      },
      // No axis titles here — "Components (Δ away − home, weighted)" and "Edge contribution"
      // were pushing this chart's height past its h-40 container on narrow screens (name +
      // nameGap has nowhere to go once the plot area itself needs the full height), clipping
      // both names and the rightmost category label. The card's own description line below the
      // chart, plus the tooltip, already say what the axes mean, so the titles were redundant.
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 9, interval: 0, formatter: (_v: string, i: number) => shortNames[i] },
      },
      yAxis: { type: "value", axisLabel: { fontSize: 9 } },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({
            value: +v.toFixed(3),
            itemStyle: { color: v >= 0 ? meta.get(away)?.color ?? "#888" : meta.get(home)?.color ?? "#666" },
          })),
          label: { show: true, position: "top", fontSize: 10, formatter: (p: { value?: unknown }) => f2(Number(p.value), true) },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#333" }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [trendEdge, meta, away, home]);
  const edgeRef = useECharts(edgeBarOption);

  // ---- trends + rank ----
  const trendOption = (team: string): EChartsOption | null => {
    const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r[stat] != null);
    if (!rows.length) return null;
    const xs = rows.map((r) => String(r.week));
    const ys = rows.map((r) => Number(r[stat]));
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    const opps = rows.map((r) => opponentLabel(String(r.game_id ?? ""), team));
    return {
      grid: { left: 5, right: 10, top: 10, bottom: 5, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          return `Week ${xs[q.dataIndex]} | ${opps[q.dataIndex]}<br/>${stat.replace(/_/g, " ")}: ${ys[q.dataIndex].toFixed(1)}`;
        },
      },
      xAxis: { type: "category", data: xs, axisLabel: { fontSize: 9 } },
      yAxis: { type: "value", axisLabel: { fontSize: 9 } },
      series: [
        {
          type: "line",
          data: ys.map((v, i) => ({ value: +v.toFixed(2), itemStyle: { color: Number(rows[i].win) === 1 ? "green" : "red" } })),
          lineStyle: { color: "#9E9E9E", width: 1 },
          symbolSize: 7,
        },
        { type: "line", data: xs.map(() => +avg.toFixed(2)), symbol: "none", lineStyle: { type: "dashed", width: 1, color: "#9E9E9E" }, tooltip: { show: false } },
      ],
    } as EChartsOption;
  };
  const leftTrendRef = useECharts(useMemo(() => (selGame ? trendOption(away) : null), [selGame, away, s, wkPlayed, stat, twIdx]));
  const rightTrendRef = useECharts(useMemo(() => (selGame ? trendOption(home) : null), [selGame, home, s, wkPlayed, stat, twIdx]));

  const rankBar = useMemo(() => {
    const rows = ranks.get(s) ?? [];
    const rowOf = (t: string) => rows.find((r) => String(r.team) === t && Number(r.week) === wkPlayed);
    const r1 = rowOf(away)?.[`${stat}_rank`];
    const r2 = rowOf(home)?.[`${stat}_rank`];
    if (r1 == null || r2 == null) return null;
    const n1 = Number(r1);
    const n2 = Number(r2);
    const w1 = n1 + n2 > 0 ? 0.5 + (n2 / (n1 + n2) - 0.5) * 0.5 : 0.5;
    return { n1, n2, w1 };
  }, [ranks, s, wkPlayed, away, home, stat]);

  // ---- recent + h2h ----
  const recent = (team: string) =>
    twIdx
      .rowsFor(team, s)
      .filter((r) => Number(r.week) <= w)
      .slice(-3)
      .map((r) => ({
        week: Number(r.week),
        opp: opponentLabel(String(r.game_id ?? ""), team),
        wl: Number(r.win) === 1 ? "W" : "L",
        pts: r.points == null ? "" : String(Math.round(Number(r.points))),
        yds: r.total_yards == null ? "" : String(Math.round(Number(r.total_yards))),
      }));

  const h2h = useMemo(() => {
    if (!selGame) return null;
    const df = schedule
      .filter(
        (g) =>
          (String(g.home_team) === away && String(g.away_team) === home) ||
          (String(g.home_team) === home && String(g.away_team) === away),
      )
      .map((g) => {
        const winner =
          g.home_score == null || g.away_score == null
            ? null
            : Number(g.home_score) > Number(g.away_score)
              ? String(g.home_team)
              : Number(g.home_score) < Number(g.away_score)
                ? String(g.away_team)
                : "TIE";
        return { g, winner, date: g.gameday ? String(g.gameday) : "" };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    const winsA = df.filter((r) => r.winner === away).length;
    const winsB = df.filter((r) => r.winner === home).length;
    const ties = df.filter((r) => r.winner === "TIE").length;
    const dates = df.map((r) => r.date).filter(Boolean).sort();
    return { rows: df.slice(0, 10), winsA, winsB, ties, first: dates[0] ?? "--", last: dates[dates.length - 1] ?? "--" };
  }, [schedule, selGame, away, home]);

  if (!selGame || !meta.size) return <div className="py-8 text-center text-sm text-slate-400">No games.</div>;

  const spread = selGame.spread_line == null ? null : Number(selGame.spread_line);
  const fav = favoriteSide(spread);
  const totalLine = selGame.total_line == null ? "—" : Number(selGame.total_line).toFixed(1);
  const mlAway = selGame.away_moneyline == null ? null : Number(selGame.away_moneyline);
  const mlHome = selGame.home_moneyline == null ? null : Number(selGame.home_moneyline);
  const { awayFair, homeFair, overround } = fairProbs(mlAway, mlHome);
  const dateTxt = selGame.gameday
    ? new Date(`${selGame.gameday}T${selGame.gametime ?? "12:00"}`).toLocaleString("en-US", { weekday: "short", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" })
    : "—";

  // model-breakdown helpers
  const pickOf = (pair: [number | null, number | null]): string | null =>
    pair[0] != null && pair[1] != null ? (pair[0] >= pair[1] ? away : home) : null;
  const probOf = (pair: [number | null, number | null]): number | null =>
    pair[0] != null && pair[1] != null ? Math.max(pair[0], pair[1]) : null;
  const gradeMetricOf = { Ovr: "Overall Grade", Off: "Offensive Grade", Def: "Defensive Grade" } as const;

  const gradeBox = (team: string) => {
    const [ovr, off, def] = gradesIdx.triple(team, s, wkPlayed);
    return (
      <div className="relative mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-xs font-semibold" title={`Season-average model grades through week ${wkPlayed} (pre-game information only)`}>Grades (thru W{wkPlayed})</div>
        <div className="flex gap-2">
          {([["Ovr", ovr], ["Off", off], ["Def", def]] as const).map(([l, v]) => {
            const r = gradesIdx.rank(team, s, wkPlayed, gradeMetricOf[l]);
            return (
              <div key={l} className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-center" title={r ? `League rank #${r.rank} of ${r.nTeams} (season-to-date average)` : undefined}>
                <div className="text-[0.7rem] text-slate-500">{l}</div>
                <div className="text-lg font-bold">{v ?? "--"}</div>
                {r && <div className="text-[10px] font-semibold text-slate-400">#{r.rank}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <FilterGroup label="Game — what to analyze">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `Week ${x}` }))} />
        <Select label="Game" value={String(selGame.game_id)} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team}` }))} />
      </FilterGroup>

      {/* Model verdict — every model's call for this game, conclusion first */}
      {bundle && (
        <div ref={verdictRef} className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ borderTop: "4px solid #002f6c" }}>
          <div className="flex flex-wrap items-stretch gap-2 p-3">
            {modelKeys.map(([k, lbl]) => {
              const [pA, pH] = bundle[k];
              const hasP = pA != null && pH != null;
              const side = pickWinner(bundle[k]);
              const pickT = side === "away" ? away : side === "home" ? home : null;
              const conf = hasP ? Math.max(pA!, pH!) : null;
              const isCons = k === "consensus";
              return (
                <div
                  key={k}
                  className={`min-w-32 flex-1 rounded-xl border px-2.5 py-2 text-center ${isCons ? "border-[#002f6c] bg-[#002f6c]/5" : "border-slate-200"}`}
                  title={hasP ? `${lbl}: ${away} ${Math.round(100 * pA!)}% | ${home} ${Math.round(100 * pH!)}%` : `${lbl}: not available for this game`}
                >
                  <div className="flex items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[k] }} />
                    {lbl}
                  </div>
                  <div className={`text-base font-bold ${isCons ? "text-[#002f6c]" : "text-slate-800"}`}>{pickT ?? "—"}</div>
                  <div className="text-[11px] text-slate-500">{conf == null ? "" : `${Math.round(100 * conf)}%`}</div>
                </div>
              );
            })}
          </div>
          {/* Model distribution — every model's home-win probability plotted on one axis, dot-colored by model */}
          <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
            <span className="w-8 shrink-0 text-right text-[9px] font-medium text-slate-300" title={`${away} win probability`}>{away}</span>
            <div className="relative h-2.5 flex-1">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" title="50%" />
              {modelKeys.map(([k, lbl]) => {
                const pH = bundle[k][1];
                if (pH == null) return null;
                const left = Math.max(0, Math.min(100, 100 * pH));
                return (
                  <div
                    key={k}
                    className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white"
                    style={{ left: `${left}%`, background: MODEL_COLORS[k] }}
                    title={`${lbl}: ${home} ${Math.round(100 * pH)}% · ${away} ${Math.round(100 * (1 - pH))}%`}
                  />
                );
              })}
            </div>
            <span className="w-8 shrink-0 text-[9px] font-medium text-slate-300" title={`${home} win probability`}>{home}</span>
          </div>
        </div>
      )}

      {/* headers + snapshot */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {[away, home].map((t, i) => (
          <div key={t} className={`flex-1 ${i === 1 ? "lg:order-3" : ""}`}>
            <div className="text-center">
              {meta.get(t)?.logo && (
                <TeamLogoLink
                  to={`/game_analysis/team_comparison?team1=${away}&team2=${home}&season=${sel}&week=${selWeek}`}
                  logo={meta.get(t)!.logo}
                  alt={t}
                  imgClassName="mx-auto h-16"
                  title={`Compare ${away} vs ${home}`}
                />
              )}
              <div className="mt-1 font-bold">{recordOf(t)}</div>
            </div>
            {gradeBox(t)}
          </div>
        ))}
        <div className="flex-[1.2] lg:order-2">
          <h3 className="mb-1.5 text-center text-sm font-semibold">Matchup Snapshot</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              // favorite is always laying points — show it as −X.X regardless of side
              ["Favorite (spread)", fav ? `${fav === "home" ? home : away} −${Math.abs(spread!).toFixed(1)}` : "—"],
              ["Kickoff", dateTxt],
              ["Points line (Total)", totalLine],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-2xl border border-slate-200 bg-white px-2 py-1.5 text-center shadow-sm">
                <div className="text-[0.7rem] text-slate-500">{l}</div>
                <div className="text-sm font-bold">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3 sm:grid-cols-3">
            {[
              [`${away} ML`, fmtMl(mlAway), `Implied: ${pct1(impliedProb(mlAway))} | Fair: ${pct1(awayFair)}`, predictedScores ? `Predicted: ${predictedScores.away.toFixed(1)}` : null],
              ["Market Overround", overround == null ? "—" : `${(100 * overround).toFixed(1)}%`, "(vig)", null],
              [`${home} ML`, fmtMl(mlHome), `Implied: ${pct1(impliedProb(mlHome))} | Fair: ${pct1(homeFair)}`, predictedScores ? `Predicted: ${predictedScores.home.toFixed(1)}` : null],
            ].map(([t, big, sub, extra]) => (
              <div key={String(t)} className="rounded-lg border border-slate-200 p-2 text-center">
                <div className="text-[0.75rem] text-slate-500">{t}</div>
                <div className="text-lg font-bold">{big}</div>
                <div className="text-[0.7rem] text-slate-500">{sub}</div>
                {extra != null && (
                  <div className="text-[0.7rem] text-slate-400" title="Projected final score — the predictive (margin regression) model's margin split across the market's total line">
                    {extra}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key stats + Average (consensus) — side by side on desktop, key stats first on mobile */}
      {keyStats && bundle && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <div className="text-sm font-bold">Key stats — season to date (thru W{wkPlayed})</div>
              <div className="text-[11px] text-slate-400">Bold = better side · #N = league rank (direction-adjusted, #1 best)</div>
            </div>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {keyStats.rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2 text-sm">
                  <span className={`w-20 text-right tabular-nums ${r.better === "away" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                    {r.a == null ? "—" : r.a.toFixed(1)}
                    {r.ra != null && <span className="ml-1 text-[10px] font-semibold text-slate-400">#{r.ra}</span>}
                  </span>
                  <span className="flex-1 text-center text-xs font-medium text-slate-500">{r.label}</span>
                  <span className={`w-20 tabular-nums ${r.better === "home" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                    {r.rh != null && <span className="mr-1 text-[10px] font-semibold text-slate-400">#{r.rh}</span>}
                    {r.h == null ? "—" : r.h.toFixed(1)}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm" title="Pre-game Elo power rating (1505 = league average). Feeds the Elo model.">
                <span className={`w-20 text-right tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloAway > keyStats.eloHome ? "font-bold" : "text-slate-500"}`}>
                  {keyStats.eloAway == null ? "—" : Math.round(keyStats.eloAway)}
                </span>
                <span className="flex-1 text-center text-xs font-medium text-slate-500">Elo rating</span>
                <span className={`w-20 tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloHome > keyStats.eloAway ? "font-bold" : "text-slate-500"}`}>
                  {keyStats.eloHome == null ? "—" : Math.round(keyStats.eloHome)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm" title="Pythagorean expected win% from points scored/allowed. Feeds the Pythagorean model.">
                <span className={`w-20 text-right tabular-nums ${keyStats.pythAway != null && keyStats.pythHome != null && keyStats.pythAway > keyStats.pythHome ? "font-bold" : "text-slate-500"}`}>
                  {keyStats.pythAway == null ? "—" : `${Math.round(100 * keyStats.pythAway)}%`}
                </span>
                <span className="flex-1 text-center text-xs font-medium text-slate-500">Pyth. expected win%</span>
                <span className={`w-20 tabular-nums ${keyStats.pythAway != null && keyStats.pythHome != null && keyStats.pythHome > keyStats.pythAway ? "font-bold" : "text-slate-500"}`}>
                  {keyStats.pythHome == null ? "—" : `${Math.round(100 * keyStats.pythHome)}%`}
                </span>
              </div>
            </div>
          </div>

          <ModelBlock color={MODEL_COLORS.consensus} title="Average (consensus)" pick={pickOf(bundle.consensus)} prob={probOf(bundle.consensus)}>
            {modelKeys.filter(([k]) => k !== "consensus").map(([k, lbl]) => (
              <ProbBar key={k} label={lbl} p={bundle[k][1]} color={MODEL_COLORS[k]} />
            ))}
            <div className="text-[10px] text-slate-400">Equal-weight mean of every model with data for this game — historically the best calibrated.</div>
          </ModelBlock>
        </div>
      )}

      {/* Model breakdown — each model's call and HOW it got there */}
      {bundle && engine && trendEdge && keyStats && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <div className="text-sm font-bold text-slate-800">Model breakdown</div>
            <div className="text-[11px] text-slate-400">Bars show the home-side ({home}) probability · tick = 50% · each card explains its own inputs</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <ModelBlock color={MODEL_COLORS.ml} title="ML Fair" pick={pickOf(bundle.ml)} prob={probOf(bundle.ml)}>
              <ProbBar label={`Implied — ${home} ${fmtMl(mlHome)}`} p={impliedProb(mlHome)} color={MODEL_COLORS.ml} note={`${away} ${fmtMl(mlAway)}`} />
              <ProbBar label="Fair (vig removed)" p={homeFair} color={MODEL_COLORS.ml} note={overround == null ? "" : `vig ${(100 * overround).toFixed(1)}%`} />
              <div className="text-[10px] text-slate-400">The bookmaker's own probability once its margin is stripped out.</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.blend} title="Market-calibrated" pick={pickOf(bundle.blend)} prob={probOf(bundle.blend)}>
              <ProbBar
                label="Bucket history"
                p={engine.pHome}
                color={MODEL_COLORS.blend}
                note={
                  engine.ciLowHome != null && engine.ciHighHome != null
                    ? `N=${engine.nBucket.toLocaleString()} · CI ${Math.round(100 * engine.ciLowHome)}–${Math.round(100 * engine.ciHighHome)}%`
                    : `N=${engine.nBucket.toLocaleString()}`
                }
                noteWidthClass="w-32"
              />
              {bucketCalOption && (
                <div>
                  <div ref={bucketCalRef} className="h-32" />
                  <div className="-mt-1 text-[9px] text-slate-400">Gray bars = sample size (N) per bucket, right-hand scale.</div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <span>
                  {engine.bucketWidened
                    ? `Bucket (${shortBucketRange(engine.bucket)}) was thin (N below ${MIN_N_BUCKET}), so history pooled in ±${engine.bucketHalfWidthPts}pt of nearby spreads.`
                    : `This exact bucket (${shortBucketRange(engine.bucket)}) alone — no widening needed.`}
                </span>
                <Link
                  to="/game_analysis/spread_win_percentage/win_rate"
                  className="shrink-0 whitespace-nowrap font-medium text-[#002f6c] underline decoration-slate-300 underline-offset-2 hover:decoration-[#002f6c]"
                  title="Open the full calibration chart — favorite win % across every spread bucket, with confidence bands"
                >
                  Full range →
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                {(() => {
                  const extrasN = [engine.pVigLeanHome, engine.pAtsTrendHome].filter((x) => x != null).length;
                  const extraWeightPct = extrasN > 0 ? Math.round(((1 - MARKET_BUCKET_W) * 100) / extrasN) : 0;
                  return (
                    <>
                      <SignalKPI
                        label="Vig lean"
                        p={engine.pVigLeanHome}
                        weightPct={engine.pVigLeanHome == null ? 0 : extraWeightPct}
                        detail={engine.homeCoverFair == null ? "no spread odds" : `home covers ${pct1(engine.homeCoverFair)}`}
                      />
                      <SignalKPI
                        label={`ATS trend (L${ATS_WINDOW})`}
                        p={engine.pAtsTrendHome}
                        weightPct={engine.pAtsTrendHome == null ? 0 : extraWeightPct}
                        detail={engine.atsHome == null || engine.atsAway == null ? "insufficient history" : `${home} ${pct1(engine.atsHome)} vs ${away} ${pct1(engine.atsAway)}`}
                      />
                    </>
                  );
                })()}
              </div>
              <div className="text-[10px] text-slate-400">Mostly bucket history, plus a {Math.round((1 - MARKET_BUCKET_W) * 100)}% dose of two signals ML Fair doesn't see: the spread's own vig lean and each team's recent against-the-spread trend.</div>
              {(engine.nBucket < MIN_N_BUCKET || engine.risks.length > 0) && (
                <div className="text-[10px] text-amber-700">{engine.risks.join(" ") || `Low-N bucket (N=${engine.nBucket}).`}</div>
              )}
            </ModelBlock>

            {!predictiveUnavailable && (
              <ModelBlock
                color={MODEL_COLORS.predictive}
                title="Predictive (margin reg.)"
                pick={pickOf(bundle.predictive) == null ? null : `${pickOf(bundle.predictive)}${bundle.predictive[1] != null && !predWindowFull ? "*" : ""}`}
                prob={probOf(bundle.predictive)}
              >
                <button
                  type="button"
                  onClick={() => setPredDetailOpen(true)}
                  disabled={predAllDrivers.length === 0}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-1.5 text-left transition-colors enabled:hover:border-slate-200 enabled:hover:bg-slate-100 disabled:cursor-default"
                  title={predAllDrivers.length > 0 ? "See every model input for this game, ranked by importance" : undefined}
                >
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(away)?.color ?? MODEL_COLORS.predictive }} />
                    <span className="text-[11px] font-semibold text-slate-500">{away}</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: meta.get(away)?.color ?? MODEL_COLORS.predictive }}>
                      {predictedMargin == null ? "—" : fmtSigned(-predictedMargin)}
                    </span>
                  </span>
                  <span className="flex-1 truncate text-center text-[9px] font-medium uppercase tracking-wider text-slate-400">predicted margin</span>
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="text-sm font-bold tabular-nums" style={{ color: meta.get(home)?.color ?? MODEL_COLORS.predictive }}>
                      {predictedMargin == null ? "—" : fmtSigned(predictedMargin)}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">{home}</span>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(home)?.color ?? MODEL_COLORS.predictive }} />
                  </span>
                </button>
                {predTop5.length > 0 ? (
                  <>
                    <div className="pt-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">Biggest movers for this game (margin points)</div>
                    {predTop5.map((r) => (
                      <ContribRow
                        key={r.feature}
                        r={r}
                        away={away}
                        home={home}
                        awayColor={meta.get(away)?.color ?? MODEL_COLORS.predictive}
                        homeColor={meta.get(home)?.color ?? MODEL_COLORS.predictive}
                        maxAbsContrib={Math.abs(predTop5[0].contrib)}
                      />
                    ))}
                  </>
                ) : (
                  <div className="text-[10px] italic text-slate-400">No variable breakdown available for this game.</div>
                )}
                <div className="text-[10px] text-slate-400">
                  Linear regression on pre-game stats predicts the scoring margin — the +/− values above are points of that margin.
                  {bundle.predictive[1] != null && !predWindowFull && (
                    <> {"* "}fewer than 3 prior played weeks for at least one team this season — the model's rolling-window inputs (L3 points margin, EPA, success rate, etc.) average over however many games have been played so far instead of the intended 3.</>
                  )}{" "}
                  <a href="#/game_analysis/models_guide" className="underline decoration-dotted underline-offset-2 hover:text-slate-600">Model details →</a>
                </div>
              </ModelBlock>
            )}

            {predDetailOpen && (
              <Modal
                title={`${away} @ ${home} — Predictive model inputs`}
                subtitle={`All ${predAllDrivers.length} concepts behind this prediction, ranked by contribution to the ${Math.abs(predictedMargin ?? 0).toFixed(1)}-point margin`}
                onClose={() => setPredDetailOpen(false)}
              >
                <div className="mb-3 flex items-center justify-center gap-6 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                  <span className="flex items-baseline gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(away)?.color ?? MODEL_COLORS.predictive }} />
                    <span className="text-xs font-semibold text-slate-500">{away}</span>
                    <span className="text-lg font-bold tabular-nums" style={{ color: meta.get(away)?.color ?? MODEL_COLORS.predictive }}>
                      {predictedMargin == null ? "—" : fmtSigned(-predictedMargin)}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold tabular-nums" style={{ color: meta.get(home)?.color ?? MODEL_COLORS.predictive }}>
                      {predictedMargin == null ? "—" : fmtSigned(predictedMargin)}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{home}</span>
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(home)?.color ?? MODEL_COLORS.predictive }} />
                  </span>
                </div>
                <div className="space-y-1.5">
                  {predAllDrivers.map((r) => (
                    <ContribRow
                      key={r.feature}
                      r={r}
                      away={away}
                      home={home}
                      awayColor={meta.get(away)?.color ?? MODEL_COLORS.predictive}
                      homeColor={meta.get(home)?.color ?? MODEL_COLORS.predictive}
                      maxAbsContrib={Math.abs(predAllDrivers[0]?.contrib ?? 1)}
                    />
                  ))}
                </div>
                <div className="mt-3 text-[10px] text-slate-400">
                  Linear regression on pre-game stats predicts the scoring margin — the +/− values are points of that margin, net of every other factor in the model.{" "}
                  <a href="#/game_analysis/models_guide" className="underline decoration-dotted underline-offset-2 hover:text-slate-600">Model details →</a>
                </div>
              </Modal>
            )}

            <ModelBlock color={MODEL_COLORS.elo} title="Elo" pick={pickOf(bundle.elo)} prob={probOf(bundle.elo)}>
              {/* Current ratings, as a KPI row — team dot + abbreviation on each side so it's
                  unambiguous which number belongs to which team, plus the HFA note. */}
              <div className="flex items-center justify-center gap-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(away)?.color ?? MODEL_COLORS.elo }} />
                  <span className="text-[11px] font-semibold text-slate-500">{away}</span>
                  <span className={`text-sm tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloAway > keyStats.eloHome ? "font-bold text-slate-900" : "text-slate-500"}`}>
                    {keyStats.eloAway == null ? "—" : Math.round(keyStats.eloAway)}
                  </span>
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">elo</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`text-sm tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloHome > keyStats.eloAway ? "font-bold text-slate-900" : "text-slate-500"}`}>
                    {keyStats.eloHome == null ? "—" : Math.round(keyStats.eloHome)}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500">{home}</span>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(home)?.color ?? MODEL_COLORS.elo }} />
                </span>
                <span className="text-[10px] text-slate-400" title="Home-field advantage baked into the Elo win-probability formula">+48 home</span>
              </div>

              {/* Both teams' last 17 weeks on one shared Elo-points axis — see how they stack up
                  and how each is trending. A week only one team played (a bye, or one team's
                  season having ended while the other made the playoffs) is a real gap in the
                  other team's line, not silently backfilled with an older game. Dot = that
                  game's result (green win / red loss). */}
              <EloSpark
                slots={eloTimeline}
                awayColor={meta.get(away)?.color ?? MODEL_COLORS.elo}
                homeColor={meta.get(home)?.color ?? MODEL_COLORS.elo}
                awayLabel={away}
                homeLabel={home}
              />

              <ProbBar label="Resulting p(home)" p={bundle.elo[1]} color={MODEL_COLORS.elo} />
              <div className="text-[10px] text-slate-400">Rolling power rating, last 17 games shown (1505 = average) · dotted line marks a new season · dot color = win/loss.</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.pyth} title="Pythagorean" pick={pickOf(bundle.pyth)} prob={probOf(bundle.pyth)}>
              {/* Cumulative points KPI — the meaningful numbers behind the (now-hidden) expected
                  win% — team-dot header, then PF/PA/margin rows in the same away|label|home,
                  bold-on-better-side convention as the "Key stats" card. */}
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(away)?.color ?? MODEL_COLORS.pyth }} />
                  {away}
                </span>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1">
                  {home}
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.get(home)?.color ?? MODEL_COLORS.pyth }} />
                </span>
              </div>
              {(() => {
                const marginAway = keyStats.pfAway != null && keyStats.paAway != null ? keyStats.pfAway - keyStats.paAway : null;
                const marginHome = keyStats.pfHome != null && keyStats.paHome != null ? keyStats.pfHome - keyStats.paHome : null;
                const fmtSigned = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
                const pythRows: [string, number | null, number | null, boolean, boolean][] = [
                  // [label, away, home, higherIsBetter, signed]
                  ["Points for", keyStats.pfAway, keyStats.pfHome, true, false],
                  ["Points allowed", keyStats.paAway, keyStats.paHome, false, false],
                  ["Point margin", marginAway, marginHome, true, true],
                ];
                return (
                  <div className="space-y-0.5">
                    {pythRows.map(([label, a, h, hib, signed]) => {
                      const better = a == null || h == null || a === h ? null : (hib ? a > h : a < h) ? "away" : "home";
                      return (
                        <div key={label} className="flex items-center gap-2 text-[11px]">
                          <span className={`w-10 shrink-0 text-right tabular-nums ${better === "away" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                            {a == null ? "—" : signed ? fmtSigned(a) : Math.round(a)}
                          </span>
                          <span className="flex-1 text-center text-slate-500">{label}</span>
                          <span className={`w-10 shrink-0 tabular-nums ${better === "home" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                            {h == null ? "—" : signed ? fmtSigned(h) : Math.round(h)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Small, subtle toggle between this week's game-by-game margin and the running
                  season-to-date total — same underlying data, two ways to read it over time. */}
              <div className="flex items-center justify-end gap-1 pt-0.5 text-[9px]">
                <button
                  type="button"
                  onClick={() => setPythMode("game")}
                  className={pythMode === "game" ? "font-semibold text-slate-600" : "text-slate-400 hover:text-slate-500"}
                >
                  Per game
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setPythMode("cumulative")}
                  className={pythMode === "cumulative" ? "font-semibold text-slate-600" : "text-slate-400 hover:text-slate-500"}
                >
                  Cumulative
                </button>
              </div>

              {/* Points margin per played week this season — "Per game": one bar per team,
                  diverging from zero, hover for that game's actual points scored/allowed.
                  "Cumulative": each team's running point margin as a line. A week only one team
                  played (bye, or a playoff first-round bye) has no bar in "Per game" and simply
                  carries the running total flat forward in "Cumulative". */}
              <MarginBars
                slots={marginTimeline}
                awayColor={meta.get(away)?.color ?? MODEL_COLORS.pyth}
                homeColor={meta.get(home)?.color ?? MODEL_COLORS.pyth}
                awayLabel={away}
                homeLabel={home}
                mode={pythMode}
              />

              <div className="text-[10px] text-slate-400">
                From points scored vs allowed through W{wkPlayed} — each side's expected win% is combined via log5 into the head-to-head probability above.
              </div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.trend} title="Trend Edge" pick={pickOf(bundle.trend)} prob={probOf(bundle.trend)}>
              {trendEdge.pAway == null ? (
                <div className="flex h-40 items-center justify-center text-[10px] italic text-slate-400">Not enough recent-form data yet</div>
              ) : (
                <div ref={edgeRef} className="h-40 min-w-0" />
              )}
              <div className="text-[10px] text-slate-400">Weighted recent-form differences (away − home): grade, last-6 margin, EPA, win rate, turnovers. Hover the bars.</div>
            </ModelBlock>
          </div>
        </div>
      )}
      {!predictiveUnavailable && (
        <p className="text-[11px] text-slate-400">{predictiveDisclaimer(predictiveCoverage ?? null)}</p>
      )}
      {predictiveUnavailable && (
        <p className="text-[11px] text-slate-400">⚠ Predictive model: data unavailable this session — excluded from the model list and Average above.</p>
      )}

      {/* Additional stats — stat comparison + history */}
      <div className="mb-1 mt-2 text-sm font-bold text-slate-800">Additional stats</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">Stat comparison — weekly values (green dot = win, dashed = season avg)</div>
          <Select
            label=""
            value={stat}
            onChange={setStat}
            options={["points_margin", "epa_diff", "turnover_margin", "points", "total_yards", "passing_yards", "rushing_yards", "turnovers"].map((v) => ({
              value: v,
              label: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            }))}
          />
        </div>
        <div className="flex flex-col items-stretch gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(away)?.color ?? "#888" }} />
              {away}
            </div>
            <div ref={leftTrendRef} className="h-44" />
          </div>
          <div className="flex w-full flex-col justify-center lg:w-52">
            <div className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">League rank — bigger side = better</div>
            {rankBar ? (
              <div className="flex h-7 overflow-hidden rounded-full ring-1 ring-inset ring-black/5">
                <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${rankBar.w1 * 100}%`, background: meta.get(away)?.color ?? "#d62728" }}>#{Math.round(rankBar.n1)}</div>
                <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${(1 - rankBar.w1) * 100}%`, background: meta.get(home)?.color ?? "#1f77b4" }}>#{Math.round(rankBar.n2)}</div>
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400">N/A</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-end gap-1.5 text-xs font-semibold text-slate-500">
              {home}
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(home)?.color ?? "#888" }} />
            </div>
            <div ref={rightTrendRef} className="h-44" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">
            Recent form — last 3 games <span className="font-normal text-slate-400">(@ = away game)</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[away, home].map((t) => (
              <div key={t}>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: meta.get(t)?.color }}>
                  {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="h-5" loading="lazy" decoding="async" />}
                  {t}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <tr>{["Wk", "Opp", "W/L", "Pts", "Yds"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {recent(t).map((r) => (
                        <tr key={`${t}${r.week}`} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-500">{r.week}</td>
                          <td className="px-2 py-1.5 font-medium">{r.opp}</td>
                          <td className={`px-2 py-1.5 font-bold ${r.wl === "W" ? "text-[#3C9A5F]" : "text-[#C8102E]"}`}>{r.wl}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.pts}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.yds}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              Head-to-head <span className="font-normal text-slate-400">(since 2015 — dataset start)</span>
            </div>
            {h2h && <div className="text-[11px] text-slate-400">First {h2h.first} · last {h2h.last}</div>}
          </div>
          {h2h && (
            <>
              <div className="mb-3 flex items-center justify-center gap-3">
                {([[away, h2h.winsA], [home, h2h.winsB]] as const).map(([t, wcount], i) => (
                  <div key={t} className={`flex items-center gap-2 ${i === 1 ? "flex-row-reverse" : ""}`}>
                    {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="h-8" loading="lazy" decoding="async" />}
                    <span className="text-2xl font-extrabold tabular-nums" style={{ color: meta.get(t)?.color }}>{wcount}</span>
                    {i === 0 && <span className="text-sm font-light text-slate-400">–</span>}
                  </div>
                ))}
                {h2h.ties > 0 && <span className="text-xs text-slate-400">({h2h.ties} ties)</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <tr>{["Season", "Wk", "Date", "Score", "Winner"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {h2h.rows.map(({ g, winner, date }) => (
                      <tr key={String(g.game_id)} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 text-slate-500">{String(g.season)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{String(g.week)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{date}</td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {String(g.away_team)} {g.away_score == null ? "" : Math.round(Number(g.away_score))} @ {String(g.home_team)} {g.home_score == null ? "" : Math.round(Number(g.home_score))}
                        </td>
                        <td className="px-2 py-1.5 font-bold" style={{ color: winner && winner !== "TIE" ? meta.get(winner)?.color : undefined }}>{winner ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
