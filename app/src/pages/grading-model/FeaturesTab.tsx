// Port of features_tab.py — top-20 importance bars, cumulative curve, full table.
// Redesigned (UX audit §13d): reordered to explain the model before showing
// numbers, horizontal bars for legible feature names, searchable full table,
// and the glossary promoted from a dangling footnote to an in-page callout.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Segmented, FilterGroup, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { statLabel } from "../player-analysis/statPicker";
import { Glossary } from "../../components/Glossary";
import { GLOSSARY_SECTIONS } from "../../lib/glossary";

const TOP_N = 20;
type ImpType = "Overall" | "Offense" | "Defense";
const COL_OF: Record<ImpType, string> = {
  Overall: "Overall Importance",
  Offense: "Offensive Importance",
  Defense: "Defensive Importance",
};
const BAR_COLOR: Record<ImpType, string> = { Offense: "#dc2626", Defense: "#2563eb", Overall: "#B8860B" };
const HILITE: Record<ImpType, string> = {
  Offense: "rgba(220,38,38,0.10)",
  Defense: "rgba(37,99,235,0.10)",
  Overall: "rgba(184,134,11,0.12)",
};

export default function FeaturesTab({ importance }: { importance: Row[] }) {
  const [impType, setImpType] = useState<ImpType>("Overall");
  const [search, setSearch] = useState("");
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const sorted = useMemo(
    () => [...importance].sort((a, b) => Number(b[COL_OF[impType]] ?? 0) - Number(a[COL_OF[impType]] ?? 0)),
    [importance, impType],
  );
  const topN = sorted.slice(0, TOP_N);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => String(r.Feature).toLowerCase().includes(q) || statLabel(String(r.Feature)).toLowerCase().includes(q));
  }, [sorted, search]);

  // Top drivers — horizontal bars (best on top), one series per grade type so
  // it doubles as a cross-model comparison, not just a ranking of the active one.
  const barOption = useMemo<EChartsOption | null>(() => {
    if (!topN.length) return null;
    const rows = [...topN].reverse();
    const labels = rows.map((r) => statLabel(String(r.Feature)));
    return {
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", name: "Importance" },
      yAxis: { type: "category", data: labels, axisLabel: { fontSize: 10 } },
      series: (["Overall", "Offense", "Defense"] as ImpType[]).map((t) => ({
        name: t,
        type: "bar",
        itemStyle: { color: BAR_COLOR[t] },
        data: rows.map((r) => +Number(r[COL_OF[t]] ?? 0).toFixed(4)),
      })),
    } as EChartsOption;
  }, [topN]);

  const cumOption = useMemo<EChartsOption | null>(() => {
    if (!topN.length) return null;
    let cum = 0;
    const data = [0, ...topN.map((r) => (cum += Number(r[COL_OF[impType]] ?? 0)))];
    const total = data[data.length - 1] || 1;
    const idx80 = data.findIndex((v) => v / total >= 0.8);
    return {
      grid: { left: 10, right: 15, top: 20, bottom: 10, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: unknown) => Number(v).toFixed(3) },
      xAxis: { type: "category", data: ["", ...topN.map((r) => statLabel(String(r.Feature)))], axisLabel: { rotate: -45, fontSize: 10 } },
      yAxis: { type: "value", name: "Cumulative Importance" },
      series: [
        {
          type: "line",
          data: data.map((v) => +v.toFixed(4)),
          lineStyle: { color: "#003366", width: 3 },
          itemStyle: { color: "#FF7F0E" },
          symbolSize: 8,
          markLine:
            idx80 >= 0
              ? { symbol: "none", lineStyle: { type: "dashed", color: "#94a3b8" }, label: { formatter: "80%" }, data: [{ yAxis: 0.8 * total }] }
              : undefined,
        },
      ],
    } as EChartsOption;
  }, [topN, impType]);

  const barRef = useECharts(barOption);
  const cumRef = useECharts(cumOption);

  return (
    <div className="space-y-4">
      {/* Explain the model first — the audit's "front door has no doorplate" fix, mirrored here for the feature side. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderTop: "3px solid #002f6c" }}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#002f6c]">What goes into a grade</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Every stat below is a column the Random Forest models saw during training. <b className="text-slate-700">Importance</b> is how much each model actually relied on that stat to predict wins and scoring — averaged across the win-prediction and points/margin-prediction models, then combined for Overall.
          A high-importance stat is one that reliably separated winners from losers that week; it directly sets how much weight that stat carries in every team's grade (see the <b className="text-slate-700">Season</b> tab for how the weighted sum becomes a 0–100 score).
        </p>
      </div>

      <FilterGroup label="Grade type — which model's weights">
        <Segmented label="" options={(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => ({ value: t, label: t }))} value={impType} onChange={setImpType} />
      </FilterGroup>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">Top {TOP_N} Drivers — ranked by {impType} importance</h3>
        <p className="mb-2 text-xs text-slate-500">All three models shown per stat, so you can see where they agree or diverge.</p>
        <div ref={barRef} className="h-[560px]" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">How concentrated is the {impType} model?</h3>
        <p className="mb-2 text-xs text-slate-500">Running total of importance as stats are added in rank order — the dashed line marks 80% of the model's total weight.</p>
        <div ref={cumRef} className="h-[420px]" />
      </div>

      <div className="rounded-2xl border border-[#002f6c]/20 bg-[#002f6c]/[0.03] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Not sure what a stat means?</h3>
            <p className="text-xs text-slate-500">Every column name here comes straight from the play-by-play data — search the app's glossary below (same one used on Win Types).</p>
          </div>
          <button
            onClick={() => setGlossaryOpen((o) => !o)}
            className="whitespace-nowrap rounded-full bg-[#002f6c] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#164a9c]"
          >
            {glossaryOpen ? "Hide glossary" : "Open the glossary →"}
          </button>
        </div>
        {glossaryOpen && (
          <div className="mt-4 border-t border-[#002f6c]/10 pt-4">
            <Glossary sections={GLOSSARY_SECTIONS} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700">All {sorted.length} Features</h3>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a stat…"
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
          />
        </div>
        <div className={`max-h-[70vh] overflow-auto ${tableWrapCls}`}>
          <table className="w-full text-xs">
            <thead className={`sticky top-0 ${theadCls}`}>
              <tr>
                <th className="px-3 py-2">Feature</th>
                {(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => (
                  <th key={t} className="px-3 py-2 text-right">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r.Feature)} className={trCls}>
                  <td className="px-3 py-1.5 font-medium">{statLabel(String(r.Feature))}</td>
                  {(["Overall", "Offense", "Defense"] as ImpType[]).map((t) => (
                    <td key={t} className="px-3 py-1.5 text-right" style={t === impType ? { backgroundColor: HILITE[t] } : undefined}>
                      {Number(r[COL_OF[t]] ?? 0).toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">No stats match "{search}".</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
