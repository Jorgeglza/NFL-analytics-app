// Two height strategies for chart containers (see MOBILE_READINESS.md §2a):
// - aspect-driven charts (scatter/line/XY heatmap) should shrink on mobile
//   and keep a roughly 4:3-or-taller aspect so the plot stays readable.
// - list-driven charts (one row per team/game) should stay tall and let the
//   page scroll — shrinking them collides the row labels.

/** Responsive height class strings for aspect-driven charts. Use the one
 * matching the chart's current fixed height (e.g. a chart that was
 * `h-[560px]` becomes `chartH.lg`). */
export const chartH = {
  sm: "h-[260px] sm:h-[320px]",
  md: "h-[300px] sm:h-[380px] lg:h-[420px]",
  lg: "h-[340px] sm:h-[440px] lg:h-[520px]",
  xl: "h-[380px] sm:h-[520px] lg:h-[620px]",
} as const;

/** Computed pixel height for list-driven charts (one row per item) — grows
 * with the item count instead of the viewport, so labels never collide. */
export function rowChartH(n: number, rowPx = 22, pad = 60): number {
  return n * rowPx + pad;
}
