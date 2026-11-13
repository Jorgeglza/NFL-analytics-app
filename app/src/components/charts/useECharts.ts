import { useCallback, useEffect, useRef } from "react";
import * as echarts from "echarts";

// Any object shape that might carry the chart-option keys we normalize —
// applied to the top-level option and, separately, to `baseOption` (the
// `{ baseOption, media }` responsive form some charts already use).
type OptionLike = Record<string, unknown>;

// Shared tooltip look: rounded card, soft shadow, readable padding/type —
// applied under whatever the option sets, same as the other normalize
// defaults below.
const TOOLTIP_DEFAULTS = {
  confine: true,
  backgroundColor: "rgba(15, 23, 42, 0.94)", // slate-900
  borderWidth: 0,
  borderRadius: 10,
  padding: [8, 12],
  extraCssText: "box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18); line-height: 1.5;",
  textStyle: { color: "#f1f5f9", fontSize: 12 }, // slate-100
};

function normalizeLayer(layer: OptionLike) {
  if (layer.tooltip && typeof layer.tooltip === "object") {
    const t = layer.tooltip as OptionLike;
    layer.tooltip = {
      ...TOOLTIP_DEFAULTS,
      ...t,
      textStyle: { ...TOOLTIP_DEFAULTS.textStyle, ...(t.textStyle as OptionLike | undefined) },
    };
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
  const root = opt.baseOption && typeof opt.baseOption === "object" ? (opt.baseOption as OptionLike) : opt;
  if (root !== opt) normalizeLayer(root);
  // Screen readers (audit A5): ECharts' built-in aria module writes a generated
  // text description of the chart (type, series, data range) as the container's
  // aria-label. Decal patterns stay off so the look is unchanged.
  if (root.aria === undefined) root.aria = { enabled: true, decal: { show: false } };
  // Reduced motion (audit A5): no entry/update animations.
  if (root.animation === undefined && prefersReducedMotion()) root.animation = false;
  return option;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

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
  const touchCleanupRef = useRef<(() => void) | null>(null);
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
      // Init only once the container has a real size (audit A6): a node that
      // attaches before layout settles (hidden tab, unmeasured flex child)
      // made echarts.init warn "Can't get DOM width or height" and draw at 0×0
      // until a later resize. Until then, the ResizeObserver/rAF below retry.
      const init = () => {
        if (chartRef.current || !node.isConnected || !node.clientWidth || !node.clientHeight) return;
        const chart = echarts.init(node);
        chartRef.current = chart;
        if (optionRef.current) chart.setOption(normalizeOption(optionRef.current), true);
        onInitRef.current?.(chart);
        // Some environments never deliver the initial ResizeObserver tick —
        // re-measure on the next frame so the chart always picks up its real size.
        requestAnimationFrame(() => {
          if (chartRef.current === chart) chart.resize();
        });

        // Touch devices have no "mouse left" analog: ECharts' default tooltip
        // triggering leaves a tapped tooltip stuck on screen until another
        // data point is tapped. Hide it on (a) a tap on empty chart canvas and
        // (b) a tap anywhere outside the chart entirely.
        const hideTip = () => chart.dispatchAction({ type: "hideTip" });
        chart.getZr().on("click", (e: { target?: unknown }) => {
          if (!e.target) hideTip();
        });
        const onDocumentTouch = (e: TouchEvent) => {
          if (!node.contains(e.target as Node)) hideTip();
        };
        document.addEventListener("touchstart", onDocumentTouch, { passive: true });
        touchCleanupRef.current = () => document.removeEventListener("touchstart", onDocumentTouch);
      };
      const ro = new ResizeObserver(() => {
        if (chartRef.current) chartRef.current.resize();
        else init();
      });
      ro.observe(node);
      roRef.current = ro;
      init();
      requestAnimationFrame(init);
    } else {
      roRef.current?.disconnect();
      roRef.current = null;
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
      chartRef.current?.dispose();
      chartRef.current = null;
    }
  }, []);

  return ref;
}
