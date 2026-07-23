// Shared chart builders for the Grading Model tabs (ranked bars + off/def scatter).
import type { EChartsOption } from "echarts";
import type { TeamMeta } from "../../lib/team/meta";
import { axisRange, medianOf, rankDesc } from "./shared";

export interface TeamPoint {
  team: string;
  value: number; // bar value
  off?: number;
  def?: number;
  record?: string;
  extraLine?: string; // e.g. week result
  won?: boolean;
}

/** Horizontal ranked bar (best on top), team colors, value labels, record+rank hover. */
export function rankedBarOption(points: TeamPoint[], meta: Map<string, TeamMeta>, useNames = false): EChartsOption {
  const sorted = [...points].sort((a, b) => b.value - a.value || a.team.localeCompare(b.team));
  const labels = sorted.map((p) => (useNames ? meta.get(p.team)?.name ?? p.team : p.team));
  return {
    grid: { left: 10, right: 45, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: "value", min: 0, max: 100 },
    yAxis: { type: "category", data: labels, inverse: true, axisLabel: { fontSize: 11 } },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const p = params as { dataIndex: number };
        const pt = sorted[p.dataIndex];
        const lines = [`<b>${pt.team} ${pt.record ?? ""}</b>`];
        if (pt.extraLine) lines.push(pt.extraLine);
        lines.push(`Rank: ${p.dataIndex + 1}`, `Value: ${pt.value.toFixed(1)}`);
        return lines.join("<br/>");
      },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((p) => ({
          value: +p.value.toFixed(1),
          itemStyle: { color: meta.get(p.team)?.color ?? "#636EFA", borderColor: "#000", borderWidth: 0.5 },
        })),
        label: { show: true, position: "right", fontSize: 10, formatter: (p: { value?: unknown }) => Number(p.value).toFixed(1) },
      },
    ],
  } as EChartsOption;
}

/** Offense vs Defense scatter with team logos, abbr labels, median crosshair. */
export function offDefScatterOption(points: TeamPoint[], meta: Map<string, TeamMeta>): EChartsOption | null {
  const pts = points.filter((p) => p.off != null && p.def != null);
  if (!pts.length) return null;
  const offs = pts.map((p) => p.off!);
  const defs = pts.map((p) => p.def!);
  const [xMin, xMax] = axisRange(offs);
  const [yMin, yMax] = axisRange(defs);
  const offRank = rankDesc(offs);
  const defRank = rankDesc(defs);
  const xMed = medianOf(offs);
  const yMed = medianOf(defs);

  const seriesData = pts.map((p) => {
    const logo = meta.get(p.team)?.logo;
    return {
      value: [p.off, p.def],
      symbol: logo ? `image://${logo}` : "circle",
      itemStyle: logo ? undefined : { color: meta.get(p.team)?.color ?? "#636EFA" },
      label: {
        show: true,
        position: "bottom" as const,
        distance: 2,
        fontWeight: p.won ? ("bold" as const) : ("normal" as const),
        color: p.won ? "rgba(0,110,0,0.95)" : "rgba(0,0,0,0.66)",
        formatter: p.team,
      },
    };
  });

  // Media queries (user request): on narrow phone-width containers the 32
  // full-size logos + labels overlap into an unreadable smear, so shrink the
  // symbols, labels, and margins instead of rendering the desktop layout at
  // a smaller scale.
  const baseOption = {
    grid: { left: 10, right: 20, top: 20, bottom: 10, containLabel: true },
    xAxis: { type: "value", min: xMin, max: xMax, name: "Offense", nameLocation: "middle", nameGap: 28 },
    yAxis: { type: "value", min: yMin, max: yMax, name: "Defense" },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const p = params as { dataIndex: number; seriesIndex: number };
        const pt = pts[p.dataIndex];
        const lines = [
          `<b>${pt.team} ${pt.record ?? ""}</b>`,
          `Offense: ${pt.off!.toFixed(1)} | Rk: ${offRank[p.dataIndex]}`,
          `Defense: ${pt.def!.toFixed(1)} | Rk: ${defRank[p.dataIndex]}`,
        ];
        if (pt.extraLine) lines.push(pt.extraLine);
        return lines.join("<br/>");
      },
    },
    series: [
      {
        type: "scatter",
        symbolSize: 34,
        data: seriesData.map((d) => ({ ...d, label: { ...d.label, fontSize: 10 } })),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "rgba(0,0,0,0.3)", type: "dotted", width: 1 },
          label: { show: false },
          data: [{ xAxis: xMed }, { yAxis: yMed }],
        },
      },
    ],
  };

  return {
    baseOption,
    media: [
      {
        query: { maxWidth: 520 },
        option: {
          grid: { left: 4, right: 12, top: 14, bottom: 4, containLabel: true },
          xAxis: { nameGap: 20, nameTextStyle: { fontSize: 10 } },
          yAxis: { nameTextStyle: { fontSize: 10 } },
          series: [
            {
              symbolSize: 20,
              data: seriesData.map((d) => ({ ...d, label: { ...d.label, distance: 1, fontSize: 8 } })),
            },
          ],
        },
      },
    ],
  } as unknown as EChartsOption;
}
