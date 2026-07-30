import { useCallback, useEffect, useRef } from "react";
import * as echarts from "echarts";

// Any object shape that might carry the chart-option keys we normalize —
// applied to the top-level option and, separately, to `baseOption` (the
// `{ baseOption, media }` responsive form some charts already use).
type OptionLike = Record<string, unknown>;

function normalizeLayer(layer: OptionLike) {
  if (layer.tooltip && typeof layer.tooltip === "object") {
    layer.tooltip = { confine: true, ...layer.tooltip };
  }
  if (layer.legend) {
    const legends = Array.isArray(layer.legend) ? layer.legend : [layer.legend];
    for (const l of legends) {
      if (l && typeof l === "object" && (l as OptionLike).type === undefined) (l as OptionLike).type = "scroll";
    }
  }
  for (const axisKey of ["xAxis", "yAxis"]) {
    const axis = layer[axisKey];
    if (!axis) continue;
    const axes = Array.isArray(axis) ? axis : [axis];
    for (const a of axes) {
      if (!a || typeof a !== "object") continue;
      const ax = a as OptionLike;
      if (ax.type === "category") {
        ax.axisLabel = { hideOverlap: true, ...(ax.axisLabel as OptionLike | undefined) };
      }
    }
  }
}

/** Applies safe, unconditional defaults (tooltip confine, scrollable
 * legends, non-overlapping category-axis labels) before every setOption.
 * Explicit values already set on the option always win — this only fills
 * in gaps. Walks `baseOption` too, since some charts use the
 * `{ baseOption, media }` responsive form. */
function normalizeOption(option: echarts.EChartsOption): echarts.EChartsOption {
  const opt = option as OptionLike;
  normalizeLayer(opt);
  if (opt.baseOption && typeof opt.baseOption === "object") {
    normalizeLayer(opt.baseOption as OptionLike);
  }
  return option;
}

/**
 * Mounts an ECharts instance on the returned callback ref, applies options,
 * and resizes with the container. A callback ref (rather than a mount-only
 * effect) is required because pages render a Loading state first — the chart
 * div only appears later, and may be remounted by parent re-renders.
 */
export function useECharts(
  option: echarts.EChartsOption | null,
  opts?: { onInit?: (chart: echarts.ECharts) => void },
) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;
  const onInitRef = useRef(opts?.onInit);
  onInitRef.current = opts?.onInit;

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(normalizeOption(option), true);
      // The container's height may depend on the same state as the option
      // (e.g. one bar per game). Re-measure after the style change lands, since
      // some environments never deliver the ResizeObserver tick.
      const chart = chartRef.current;
      requestAnimationFrame(() => {
        if (chartRef.current === chart) chart.resize();
      });
    }
  }, [option]);

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const chart = echarts.init(node);
      chartRef.current = chart;
      if (optionRef.current) chart.setOption(normalizeOption(optionRef.current), true);
      onInitRef.current?.(chart);
      // The node can attach before flex layout settles (width 0) and some
      // environments never deliver the initial ResizeObserver tick — re-measure
      // on the next frame so the chart always picks up its real size.
      requestAnimationFrame(() => {
        if (chartRef.current === chart) chart.resize();
      });
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(node);
      roRef.current = ro;
    } else {
      roRef.current?.disconnect();
      roRef.current = null;
      chartRef.current?.dispose();
      chartRef.current = null;
    }
  }, []);

  return ref;
}
