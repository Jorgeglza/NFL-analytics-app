import { useCallback, useEffect, useRef } from "react";
import * as echarts from "echarts";

/**
 * Mounts an ECharts instance on the returned callback ref, applies options,
 * and resizes with the container. A callback ref (rather than a mount-only
 * effect) is required because pages render a Loading state first — the chart
 * div only appears later, and may be remounted by parent re-renders.
 */
export function useECharts(option: echarts.EChartsOption | null) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, true);
  }, [option]);

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const chart = echarts.init(node);
      chartRef.current = chart;
      if (optionRef.current) chart.setOption(optionRef.current, true);
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
