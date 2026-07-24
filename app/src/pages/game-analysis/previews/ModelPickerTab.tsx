// Model Picker — new tab (not a port): answers "which model is best, and in
// which scenario" across the whole history, one level up from Model
// Overview's game-by-game matrices.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../../lib/data/loader";
import { Segmented } from "../../../components/ui";
import { useECharts } from "../../../components/charts/useECharts";
import {
  MODEL_KEYS,
  MODEL_COLORS,
  type MetricKey,
  probBundle,
  favoriteSide,
  resultWinner,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
  type EloIndex,
} from "./engine";

interface Pick {
  side: "home" | "away" | null;
  conf: number | null; // max(pAway, pHome)
  pHome: number | null;
  correct: boolean | null;
}

interface Rec {
  season: number;
  week: number;
  favSide: "home" | "away" | null;
  actual: "home" | "away" | null;
  picks: Record<MetricKey, Pick>;
}

/**
 * red (bad) -> amber (coin flip) -> green (good), stretched over [domainLo, domainHi]
 * instead of a fixed 0–100 span. Real accuracy rarely leaves ~40–80%, so a fixed
 * span crams every normal cell into one washed-out yellow-green band; stretching
 * to the data's own range (with 50% still anchored as the amber midpoint when it
 * falls inside that range) makes the actual spread readable. Values outside the
 * domain clamp to the nearest end color.
 */
function colorForAcc(pct: number, domainLo = 0, domainHi = 100): string {
  const lo = Math.min(domainLo, domainHi);
  const hi = Math.max(domainLo, domainHi);
  const mid = lo < 50 && hi > 50 ? 50 : (lo + hi) / 2;
  const stops: [number, [number, number, number]][] = [
    [lo, [200, 16, 46]],
    [mid, [250, 204, 21]],
    [hi, [44, 162, 95]],
  ];
  const t = Math.max(lo, Math.min(hi, pct));
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const lt = (t - a[0]) / span;
  const rgb = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * lt));
  return `rgb(${rgb.join(",")})`;
}

/** Linear-interpolated percentile of a pre-sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const SCENARIOS = [
  { key: "all", label: "Overall", test: () => true },
  { key: "fav", label: "Picked favorite", test: (r: Rec, p: Pick) => p.side != null && r.favSide != null && p.side === r.favSide },
  { key: "dog", label: "Picked underdog", test: (r: Rec, p: Pick) => p.side != null && r.favSide != null && p.side !== r.favSide },
  { key: "home", label: "Home pick", test: (_r: Rec, p: Pick) => p.side === "home" },
  { key: "away", label: "Away pick", test: (_r: Rec, p: Pick) => p.side === "away" },
  { key: "hiconf", label: "High confidence ≥65%", test: (_r: Rec, p: Pick) => p.conf != null && p.conf >= 0.65 },
  { key: "loconf", label: "Toss-up 50–55%", test: (_r: Rec, p: Pick) => p.conf != null && p.conf < 0.55 },
] as const;

function accOf(rows: { correct: boolean | null }[]): { pct: number | null; n: number; correct: number } {
  const evald = rows.filter((r) => r.correct != null);
  const correct = evald.filter((r) => r.correct).length;
  return { pct: evald.length ? (100 * correct) / evald.length : null, n: evald.length, correct };
}

export default function ModelPickerTab({
  schedule,
  hist,
  gradesIdx,
  twIdx,
  eloIdx,
}: {
  schedule: Row[];
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
  eloIdx: EloIndex;
}) {
  const records = useMemo<Rec[]>(() => {
    const reg = schedule.filter((r) => r.game_type === "REG");
    return reg.map((g) => {
      const s = Number(g.season);
      const w = Number(g.week);
      const b = probBundle(g, s, w, hist, gradesIdx, twIdx, eloIdx);
      const actual = resultWinner(g);
      const favSide = favoriteSide(g.spread_line == null ? null : Number(g.spread_line));
      const picks = {} as Rec["picks"];
      for (const [key] of MODEL_KEYS) {
        const [pA, pH] = b[key];
        let side: "home" | "away" | null = null;
        let conf: number | null = null;
        if (pA != null && pH != null) {
          side = pA >= pH ? "away" : "home";
          conf = Math.max(pA, pH);
        }
        picks[key] = { side, conf, pHome: pH ?? null, correct: actual && side ? actual === side : null };
      }
      return { season: s, week: w, favSide, actual, picks };
    });
  }, [schedule, hist, gradesIdx, twIdx, eloIdx]);

  const seasons = useMemo(() => [...new Set(records.map((r) => r.season))].sort((a, b) => b - a), [records]);
  const latestWithResults = useMemo(() => {
    for (const s of seasons) {
      if (records.some((r) => r.season === s && r.actual != null)) return s;
    }
    return seasons[0];
  }, [seasons, records]);
  const [season, setSeason] = useState<number | null>(null);
  const sel = season ?? latestWithResults ?? seasons[0];

  // ---------- overall KPIs (all seasons, all time) ----------
  const overall = useMemo(() => {
    const rows = MODEL_KEYS.map(([key, label]) => {
      const picks = records.map((r) => r.picks[key]);
      const a = accOf(picks);
      const confs = picks.map((p) => p.conf).filter((c): c is number => c != null);
      const avgConf = confs.length ? confs.reduce((x, y) => x + y, 0) / confs.length : null;
      // Brier score: mean squared error of the home-win probability vs actual outcome — rewards calibration, not just hit rate.
      const brierRows = records
        .map((r) => ({ p: r.picks[key].pHome, y: r.actual == null ? null : r.actual === "home" ? 1 : 0 }))
        .filter((x): x is { p: number; y: number } => x.p != null && x.y != null);
      const brier = brierRows.length ? brierRows.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / brierRows.length : null;
      return { key, label, ...a, avgConf, brier };
    });
    const bestAcc = Math.max(...rows.map((r) => r.pct ?? -1));
    const bestBrier = Math.min(...rows.filter((r) => r.brier != null).map((r) => r.brier!));
    return rows.map((r) => ({ ...r, isBestAcc: r.pct != null && r.pct === bestAcc, isBestBrier: r.brier != null && r.brier === bestBrier }));
  }, [records]);

  // ---------- scenario matrix (all seasons, all time) ----------
  const scenarioMatrix = useMemo(
    () =>
      MODEL_KEYS.map(([key, label]) => ({
        key,
        label,
        cells: SCENARIOS.map((sc) => {
          const rows = records.filter((r) => sc.test(r, r.picks[key])).map((r) => r.picks[key]);
          return { scenario: sc.key, ...accOf(rows) };
        }),
      })),
    [records],
  );

  // ---------- per-week accuracy for the selected season ----------
  const weekly = useMemo(() => {
    const weeks = [...new Set(records.filter((r) => r.season === sel).map((r) => r.week))].sort((a, b) => a - b);
    return weeks.map((w) => {
      const rows = records.filter((r) => r.season === sel && r.week === w);
      const perModel = MODEL_KEYS.map(([key]) => accOf(rows.map((r) => r.picks[key])));
      return { week: w, perModel };
    });
  }, [records, sel]);

  const lineOption = useMemo<EChartsOption | null>(() => {
    if (!weekly.length) return null;
    const weeks = weekly.map((w) => w.week);
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; seriesIndex: number; color: string; seriesName: string }[];
          if (!arr.length) return "";
          const wi = weeks.indexOf(Number(arr[0].axisValue));
          const lines = arr.map((p) => {
            const m = weekly[wi].perModel[p.seriesIndex];
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${m.pct == null ? "no games" : `${m.pct.toFixed(0)}%`}</b>${m.n ? ` (${m.correct}/${m.n})` : ""}`;
          });
          return `Week ${arr[0].axisValue}<br/>${lines.join("<br/>")}`;
        },
      },
      xAxis: { type: "category", data: weeks.map(String), name: "Week", nameLocation: "middle", nameGap: 24, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", min: 0, max: 100, name: "Accuracy %", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: MODEL_KEYS.map(([key, label], i) => ({
        name: label,
        type: "line" as const,
        data: weekly.map((w) => (w.perModel[i].pct == null ? null : +w.perModel[i].pct!.toFixed(1))),
        connectNulls: false,
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: MODEL_COLORS[key] },
      })),
    };
  }, [weekly]);

  const heat = useMemo(() => {
    if (!weekly.length) return null;
    const weeks = weekly.map((w) => w.week);
    const data: { value: [number, number, number]; n: number; correct: number }[] = [];
    weekly.forEach((w, xi) => {
      w.perModel.forEach((m, yi) => {
        data.push({ value: [xi, yi, m.pct ?? -1], n: m.n, correct: m.correct });
      });
    });
    // Stretch the color scale to this view's actual spread (10th–90th percentile,
    // padded to at least 20pts) instead of the full 0–100 range — otherwise a
    // realistic 45–80% accuracy band all reads as one washed-out color, and a
    // single small-N outlier week (0% or 100%) dominates the eye.
    const validPct = data.map((d) => d.value[2]).filter((p) => p >= 0);
    const sorted = [...validPct].sort((a, b) => a - b);
    let domainLo = percentile(sorted, 0.1);
    let domainHi = percentile(sorted, 0.9);
    if (domainHi - domainLo < 20) {
      const mid = (domainHi + domainLo) / 2;
      domainLo = Math.max(0, mid - 10);
      domainHi = Math.min(100, mid + 10);
    }
    const option = {
      grid: { left: 110, right: 12, top: 10, bottom: 30, containLabel: false },
      tooltip: {
        formatter: (p: unknown) => {
          const d = p as { data: { value: [number, number, number]; n: number; correct: number } };
          const [xi, yi] = d.data.value;
          const label = MODEL_KEYS[yi][1];
          const pct = d.data.value[2];
          return `${label} — Week ${weeks[xi]}<br/>${pct < 0 ? "No games" : `${pct.toFixed(0)}% (${d.data.correct}/${d.data.n})`}`;
        },
      },
      xAxis: { type: "category", data: weeks.map((w) => `Wk${w}`), position: "bottom", axisLabel: { fontSize: 10 }, splitArea: { show: false } },
      yAxis: { type: "category", data: MODEL_KEYS.map(([, l]) => l), axisLabel: { fontSize: 11 } },
      visualMap: { show: false, min: 0, max: 100 },
      series: [
        {
          type: "heatmap",
          data: data.map((d) => d.value),
          itemStyle: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            color: (params: any) => {
              const pct = params.value[2];
              return pct < 0 ? "#f1f5f9" : colorForAcc(pct, domainLo, domainHi);
            },
          },
          label: {
            show: true,
            fontSize: 9,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => (p.value[2] < 0 ? "" : `${Math.round(p.value[2])}`),
            color: "#1e293b",
          },
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as EChartsOption;
    return { option, domainLo, domainHi };
  }, [weekly]);

  // ---------- accuracy trend aggregated by season (all-time, not one season) ----------
  const [axisMode, setAxisMode] = useState<"week" | "weekAllSeasons">("week");

  // Every Week 1 across every season pooled together, every Week 2 pooled
  // together, etc. — answers "does this model reliably start slow / peak
  // mid-season / fade late" instead of just this one season's noise.
  const weekAllSeasons = useMemo(() => {
    const weeks = [...new Set(records.map((r) => r.week))].sort((a, b) => a - b);
    return weeks.map((w) => {
      const rows = records.filter((r) => r.week === w);
      const perModel = MODEL_KEYS.map(([key]) => accOf(rows.map((r) => r.picks[key])));
      const seasonsInWeek = new Set(rows.map((r) => r.season)).size;
      return { week: w, perModel, seasonsInWeek };
    });
  }, [records]);

  const weekAllSeasonsOption = useMemo<EChartsOption | null>(() => {
    if (!weekAllSeasons.length) return null;
    const weeks = weekAllSeasons.map((w) => w.week);
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; seriesIndex: number; color: string; seriesName: string }[];
          if (!arr.length) return "";
          const wi = weeks.indexOf(Number(arr[0].axisValue));
          const wk = weekAllSeasons[wi];
          const lines = arr.map((p) => {
            const m = wk.perModel[p.seriesIndex];
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${m.pct == null ? "no games" : `${m.pct.toFixed(0)}%`}</b>${m.n ? ` (${m.correct}/${m.n})` : ""}`;
          });
          return `Week ${arr[0].axisValue} — pooled across ${wk.seasonsInWeek} seasons<br/>${lines.join("<br/>")}`;
        },
      },
      xAxis: { type: "category", data: weeks.map(String), name: "Week", nameLocation: "middle", nameGap: 24, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", min: 0, max: 100, name: "Accuracy %", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: MODEL_KEYS.map(([key, label], i) => ({
        name: label,
        type: "line" as const,
        data: weekAllSeasons.map((w) => (w.perModel[i].pct == null ? null : +w.perModel[i].pct!.toFixed(1))),
        connectNulls: false,
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: MODEL_COLORS[key] },
      })),
    };
  }, [weekAllSeasons]);

  const lineRef = useECharts(lineOption);
  const weekAllSeasonsRef = useECharts(weekAllSeasonsOption);
  const heatRef = useECharts(heat?.option ?? null);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-1.5 text-sm font-semibold text-slate-700">Overall performance — every graded game, all seasons</div>
        <div className="flex flex-wrap gap-2">
          {overall.map((m) => (
            <div
              key={m.key}
              className="min-w-40 flex-1 rounded-2xl border px-3 py-2.5 shadow-sm"
              style={{ borderColor: `${MODEL_COLORS[m.key]}55`, borderTop: `3px solid ${MODEL_COLORS[m.key]}`, background: `${MODEL_COLORS[m.key]}0a` }}
            >
              <div className="flex items-center gap-1.5 truncate text-xs font-bold" style={{ color: MODEL_COLORS[m.key] }}>
                {m.label}
                {m.isBestAcc && <span title="Highest overall accuracy">🏆</span>}
                {m.isBestBrier && !m.isBestAcc && <span title="Best calibrated (lowest Brier score)">🎯</span>}
              </div>
              <div className="mt-0.5 text-xl font-extrabold leading-none tabular-nums text-slate-800">{m.pct == null ? "—" : `${m.pct.toFixed(1)}%`}</div>
              <div className="mt-1 text-[11px] text-slate-500">{m.n ? `${m.correct}/${m.n} correct` : "no results yet"}</div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                <span title="Average pick confidence">avg conf {m.avgConf == null ? "—" : `${Math.round(100 * m.avgConf)}%`}</span>
                <span title="Brier score — mean squared error of the home-win probability vs the actual result (lower = better calibrated)">brier {m.brier == null ? "—" : m.brier.toFixed(3)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-1.5 text-sm font-semibold text-slate-700">Best model, by scenario — all seasons</div>
        <p className="mb-2 text-[11px] text-slate-400">Accuracy % within each slice; darker green/red = further from a coin flip. Hover a cell for the exact record.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="border px-2 py-1.5 text-left">Model</th>
                {SCENARIOS.map((sc) => (
                  <th key={sc.key} className="border px-2 py-1.5">{sc.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarioMatrix.map((row) => (
                <tr key={row.key}>
                  <td className="whitespace-nowrap border px-2 py-1.5 font-bold" style={{ color: MODEL_COLORS[row.key] }}>{row.label}</td>
                  {row.cells.map((c) => (
                    <td
                      key={c.scenario}
                      className="border px-2 py-1.5 text-center font-semibold"
                      style={{ background: c.pct == null ? "#f8fafc" : `${colorForAcc(c.pct)}26`, color: c.pct == null ? "#94a3b8" : colorForAcc(c.pct) }}
                      title={c.n ? `${c.correct}/${c.n} correct` : "No games in this slice"}
                    >
                      {c.pct == null ? "—" : `${c.pct.toFixed(0)}%`}
                      <div className="text-[9px] font-normal text-slate-400">{c.n ? `n=${c.n}` : ""}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-700">Accuracy trend</div>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            label="Axis"
            value={axisMode}
            onChange={setAxisMode}
            options={[
              { value: "week", label: "This season, by week" },
              { value: "weekAllSeasons", label: "All seasons, by week #" },
            ]}
          />
          {axisMode === "week" && (
            <Segmented label="Season" value={String(sel)} onChange={(v) => setSeason(Number(v))} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {axisMode === "week" ? (
          <>
            <div className="mb-1.5 text-xs font-semibold text-slate-600">Line — accuracy % per model, week by week ({sel})</div>
            {lineOption ? <div ref={lineRef} className="h-[300px]" /> : <div className="grid h-[300px] place-items-center text-sm text-slate-400">No games this season</div>}
          </>
        ) : (
          <>
            <div className="mb-1.5 text-xs font-semibold text-slate-600">Line — accuracy % per model, by week # (every Week 1 pooled together, every Week 2 pooled together, …)</div>
            {weekAllSeasonsOption ? <div ref={weekAllSeasonsRef} className="h-[300px]" /> : <div className="grid h-[300px] place-items-center text-sm text-slate-400">No graded games</div>}
          </>
        )}
      </div>

      {axisMode === "week" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 text-xs font-semibold text-slate-600">Heatmap — accuracy % per model, week by week ({sel})</div>
          {heat ? (
            <>
              <div ref={heatRef} style={{ height: Math.max(220, MODEL_KEYS.length * 34 + 60) }} />
              <div className="mt-1.5 text-[10px] text-slate-400">Color scale stretched to this view's spread ({Math.round(heat.domainLo)}%–{Math.round(heat.domainHi)}%) — values outside it clamp to the end colors.</div>
            </>
          ) : (
            <div className="grid h-[260px] place-items-center text-sm text-slate-400">No games this season</div>
          )}
        </div>
      )}
    </div>
  );
}
