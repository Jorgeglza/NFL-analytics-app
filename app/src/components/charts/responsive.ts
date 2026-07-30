import type { EChartsOption } from "echarts";

// ECharts media queries key off the chart *container* width — matches the
// breakpoint already chosen ad hoc at pages/grading-model/charts.tsx:120.
export const MOBILE_MAX = 520;

// Shared geometry constants so charts migrated to withMobile() stay visually
// consistent instead of each picking its own mobile numbers.
export const MOBILE_GRID = { left: 4, right: 12, top: 14, bottom: 4, containLabel: true };
export const MOBILE_LABEL = { fontSize: 9 };

/** Wraps a base option with a `maxWidth: MOBILE_MAX` media override, using
 * ECharts' `{ baseOption, media }` responsive form. `mobileOverrides` is a
 * partial option merged in (via ECharts' own option merge) only when the
 * chart's container is at or below MOBILE_MAX wide. */
export function withMobile(base: EChartsOption, mobileOverrides: EChartsOption): EChartsOption {
  return {
    baseOption: base,
    media: [{ query: { maxWidth: MOBILE_MAX }, option: mobileOverrides }],
  } as unknown as EChartsOption;
}
