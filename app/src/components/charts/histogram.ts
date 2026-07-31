// Shared value-axis histogram builder — bars drawn with a `custom` series
// (renderItem) rather than the built-in `bar` type, because ECharts'
// `barWidth` only sizes to category bandwidth; it doesn't size to axis units
// on a value axis. This is the same pattern as ECharts' own histogram
// example. Using a real value axis (rather than a category axis labeled with
// bin edges) means markLine/markPoint land on the true data value instead of
// the containing bin's center, and bin edges come out as round numbers
// instead of raw min/max fractions.
import type { CustomSeriesOption, CustomSeriesRenderItemAPI, CustomSeriesRenderItemReturn } from "echarts";

export interface HistogramBins {
  lo: number;
  hi: number;
  width: number;
  counts: number[];
}

/** Rounds a raw bin width up to a "nice" 1/2/5 * 10^k step, so bin edges are
 * round numbers instead of arbitrary fractions of the data range. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exp;
}

/** Sturges' rule (capped), for a target bin count that scales sensibly with
 * sample size instead of a fixed count regardless of `n`. */
export function sturgesBinCount(n: number, cap = 12, min = 5): number {
  if (n <= 1) return 1;
  return Math.min(cap, Math.max(min, Math.ceil(1 + Math.log2(n))));
}

/** Bins `values` into ~`targetBins` bins with round edges (nice step size,
 * lo/hi snapped to multiples of it) — the actual bin count may differ
 * slightly from `targetBins` once snapped. */
export function buildHistogramBins(values: number[], targetBins: number): HistogramBins {
  const dataMin = Math.min(...values);
  const dataMaxRaw = Math.max(...values);
  const dataMax = dataMaxRaw === dataMin ? dataMin + 1 : dataMaxRaw;
  const width = niceStep((dataMax - dataMin) / Math.max(1, targetBins));
  const lo = Math.floor(dataMin / width) * width;
  const hi = Math.ceil(dataMax / width) * width;
  const nbins = Math.max(1, Math.round((hi - lo) / width));
  const counts = new Array(nbins).fill(0);
  for (const v of values) {
    const idx = Math.min(nbins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[idx]++;
  }
  return { lo, hi, width, counts };
}

/** A `custom`-series histogram bar series for a value x-axis. `data` rows
 * are `[binLo, binHi, count]` so `renderItem` can size each rect to its
 * exact pixel span regardless of zoom/resize. */
export function histogramBarSeries(bins: HistogramBins, color: string, name = "Count"): CustomSeriesOption {
  const { lo, width, counts } = bins;
  const data = counts.map((c, i) => [lo + i * width, lo + (i + 1) * width, c]);
  return {
    name,
    type: "custom",
    renderItem: (_params: unknown, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
      const yValue = api.value(2) as number;
      const start = api.coord([api.value(0) as number, yValue]);
      const size = api.size!([(api.value(1) as number) - (api.value(0) as number), yValue]) as number[];
      return {
        type: "rect",
        shape: { x: start[0], y: start[1], width: size[0], height: size[1] },
        style: api.style(),
      };
    },
    itemStyle: { color },
    encode: { x: [0, 1], y: 2, tooltip: [0, 1, 2] },
    data,
  } as CustomSeriesOption;
}
