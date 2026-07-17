// Port of features_tab.py — top-20 importance bars, cumulative curve, full table.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";

const TOP_N = 20;
type ImpType = "Overall" | "Offense" | "Defense";
const COL_OF: Record<ImpType, string> = {
  Overall: "Overall Importance",
  Offense: "Offensive Importance",
  Defense: "Defensive Importance",
};
const BAR_COLOR: Record<ImpType, string> = { Offense: "red", Defense: "blue", Overall: "#B8860B" };
const HILITE: Record<ImpType, string> = {
  Offense: "rgba(255,0,0,0.12)",
  Defense: "rgba(0,0,255,0.12)",
  Overall: "rgba(184,134,11,0.12)",
};

export default function FeaturesTab({ importance }: { importance: Row[] }) {
  const [impType, setImpType] = useState<ImpType>("Overall");

  const sorted = useMemo(
    () =>
      [...importance].sort((a, b) => Number(b[COL_OF[impType]] ?? 0) - Number(a[COL_OF[impType]] ?? 0)),
    [importance, impType],
  );
  const topN = sorted.slice(0, TOP_N);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!topN.length) return null;
    const feats = topN.map((r) => String(r.Feature));
    return {
      grid: { left: 10, right: 10, top: 30, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: feats, axisLabel: { rotate: -45, fontSize: 10 } },
      yAxis: { type: "value", name: "Importance" },
      series: (["Overall", "Offense", "Defense"] as ImpType[]).map((t) => ({
        name: t,
        type: "bar",
        itemStyle: { color: BAR_COLOR[t] },
        data: topN.map((r) => +Number(r[COL_OF[t]] ?? 0).toFixed(4)),
        label: {
          show: true,
          position: "top",
          fontSize: 9,
          formatter: (p: { value?: unknown }) => (Number(p.value) > 0 ? Number(p.value).toFixed(2) : ""),
        },
      })),
    } as EChartsOption;
  }, [topN]);

  const cumOption = useMemo<EChartsOption | null>(() => {
    if (!topN.length) return null;
    let cum = 0;
    const data = [0, ...topN.map((r) => (cum += Number(r[COL_OF[impType]] ?? 0)))];
    return {
      grid: { left: 10, right: 15, top: 20, bottom: 10, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => Number(v).toFixed(3) },
      xAxis: { type: "category", data: ["", ...topN.map((r) => String(r.Feature))], axisLabel: { rotate: -45, fontSize: 10 } },
      yAxis: { type: "value", name: "Cumulative Importance" },
      series: [
        {
          type: "line",
          data: data.map((v) => +v.toFixed(4)),
          lineStyle: { color: "#003366", width: 3 },
          itemStyle: { color: "#FF7F0E" },
          symbolSize: 8,
        },
      ],
    } as EChartsOption;
  }, [topN, impType]);

  const barRef = useECharts(barOption);
  const cumRef = useECharts(cumOption);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="mr-4 text-lg font-semibold text-slate-800">📊 Feature Importance</h3>
        {(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => (
          <button key={t} onClick={() => setImpType(t)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${impType === t ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div ref={barRef} className="h-[650px]" />
      </div>

      <h3 className="text-lg font-semibold text-slate-800">📈 Cumulative Feature Importance</h3>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div ref={cumRef} className="h-[500px]" />
      </div>

      <p className="text-sm text-slate-600">
        For feature information, refer to the{" "}
        <a href="https://nflreadr.nflverse.com/articles/dictionary_player_stats.html" target="_blank" rel="noopener noreferrer" className="text-[#004080] underline">
          NFL feature glossary.
        </a>
      </p>

      <h3 className="text-lg font-semibold text-slate-800">📄 Full Feature Importances</h3>
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2">Feature</th>
              {(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => (
                <th key={t} className="px-3 py-2 text-right">{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={String(r.Feature)} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium">{String(r.Feature)}</td>
                {(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => (
                  <td key={t} className="px-3 py-1.5 text-right" style={t === impType ? { backgroundColor: HILITE[t] } : undefined}>
                    {Number(r[COL_OF[t]] ?? 0).toFixed(3)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
