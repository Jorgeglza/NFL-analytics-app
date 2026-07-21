// Opponent-difficulty heatmap — new analytics (not a port). Rows = teams
// (hardest average schedule first), columns = week. Each cell is colored by
// that week's opponent Elo (green = easy, red = hard), shows the opponent's
// logo, and prints the opponent's Elo rating in the bottom-right corner.
// Uses an ECharts `custom` series (renderItem) since a plain heatmap series
// can't draw a logo image per cell.
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { HeatmapData } from "./shared";
import type { TeamMeta } from "../../../lib/team/meta";
import { useECharts } from "../../../components/charts/useECharts";

function colorForElo(elo: number, min: number, max: number): string {
  const t = max > min ? Math.max(0, Math.min(1, (elo - min) / (max - min))) : 0.5;
  const stops: [number, [number, number, number]][] = [
    [0, [34, 197, 94]], // easy — green
    [0.5, [250, 204, 21]], // yellow
    [1, [220, 38, 38]], // hard — red
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const localT = (t - lo[0]) / span;
  const rgb = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * localT));
  return `rgb(${rgb.join(",")})`;
}

interface Point {
  value: [number, number, number]; // [weekIndex, teamIndex, opponentElo]
  opponent: string;
  home: boolean;
}

export default function HeatmapChart({ data, meta }: { data: HeatmapData; meta: Map<string, TeamMeta> }) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data.rows.length || !data.weeks.length) return null;
    const teamLabels = data.rows.map((r) => r.team);
    const weekLabels = data.weeks.map((w) => `Wk${w}`);

    const points: Point[] = [];
    data.rows.forEach((row, yi) => {
      data.weeks.forEach((w, xi) => {
        const cell = row.cells.get(w);
        if (!cell) return;
        points.push({ value: [xi, yi, cell.opponentElo], opponent: cell.opponent, home: cell.home });
      });
    });

    return {
      grid: { left: 50, right: 12, top: 30, bottom: 10, containLabel: false },
      xAxis: {
        type: "category",
        data: weekLabels,
        position: "top",
        axisLabel: { fontSize: 10 },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      yAxis: { type: "category", data: teamLabels, inverse: true, axisLabel: { fontSize: 10 }, axisTick: { show: false } },
      tooltip: {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const d: Point = points[p.dataIndex];
          const team = teamLabels[d.value[1]];
          const week = data.weeks[d.value[0]];
          return `${meta.get(team)?.name ?? team} — Week ${week}<br/>${d.home ? "vs" : "@"} ${meta.get(d.opponent)?.name ?? d.opponent}<br/>Opponent Elo: <b>${Math.round(d.value[2])}</b>`;
        },
      },
      series: [
        {
          type: "custom",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderItem: (params: any, api: any) => {
            const xIndex = api.value(0);
            const yIndex = api.value(1);
            const eloVal = api.value(2);
            const point = points[params.dataIndex];
            const center = api.coord([xIndex, yIndex]);
            const size = api.size([1, 1]);
            const w = size[0] - 2;
            const h = size[1] - 2;
            const x0 = center[0] - w / 2;
            const y0 = center[1] - h / 2;
            const logo = meta.get(point.opponent)?.logo;
            const imgSize = Math.min(w, h) * 0.62;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const children: any[] = [
              {
                type: "rect",
                shape: { x: x0, y: y0, width: w, height: h, r: 3 },
                style: { fill: colorForElo(eloVal, data.eloMin, data.eloMax) },
              },
            ];
            if (logo) {
              children.push({
                type: "image",
                style: { image: logo, x: center[0] - imgSize / 2, y: center[1] - imgSize / 2, width: imgSize, height: imgSize },
              });
            }
            children.push({
              type: "text",
              style: {
                text: String(Math.round(eloVal)),
                x: x0 + w - 2,
                y: y0 + h - 2,
                fontSize: 8,
                fill: "rgba(0,0,0,0.6)",
                textAlign: "right",
                textVerticalAlign: "bottom",
              },
            });
            return { type: "group", children };
          },
          data: points.map((p) => p.value),
        },
      ],
    } as EChartsOption;
  }, [data, meta]);

  const ref = useECharts(option);

  if (!option) return <div className="py-8 text-center text-sm text-slate-400">No schedule data yet.</div>;
  return <div ref={ref} style={{ height: Math.max(320, data.rows.length * 22 + 60) }} />;
}
