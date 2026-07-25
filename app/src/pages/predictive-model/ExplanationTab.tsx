// Feature contribution — permutation importance (averaged across every
// walk-forward fold), not raw linear coefficients: the 41 features are
// meaningfully collinear (EPA/success-rate/grade all correlate), which
// destabilizes raw coefficient signs/magnitudes across refits. Permutation
// importance is the decision doc's explicit recommendation
// (docs/predictive-model-decision.md).
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, tableWrapCls, theadCls, trCls } from "../../components/ui";

const TOP_N = 20;

function labelFor(feature: string): string {
  return feature.replace(/^diff_/, "").replace(/_/g, " ");
}

export default function ExplanationTab({ importance }: { importance: Row[] }) {
  const [search, setSearch] = useState("");

  const sorted = useMemo(
    () => [...importance].sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0)),
    [importance],
  );
  const topN = sorted.slice(0, TOP_N);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => String(r.feature).toLowerCase().includes(q));
  }, [sorted, search]);

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!topN.length) return null;
    const rows = [...topN].reverse();
    return {
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", name: "Mean drop in accuracy when shuffled" },
      yAxis: { type: "category", data: rows.map((r) => labelFor(String(r.feature))), axisLabel: { fontSize: 10 } },
      series: [
        {
          type: "bar",
          itemStyle: { color: "#002f6c" },
          data: rows.map((r) => +Number(r.importance ?? 0).toFixed(4)),
        },
      ],
    } as EChartsOption;
  }, [topN]);

  const barRef = useECharts(barOption);

  return (
    <div className="space-y-4">
      <Card accent="#002f6c">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#002f6c]">How to read this</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Each bar is <b className="text-slate-700">permutation importance</b>: how much the model's mean absolute
          error gets worse when that single feature's values are randomly shuffled, averaged across every
          walk-forward test season. A bigger drop means the model relies on that feature more. Elo and rolling EPA
          differentials dominate by roughly an order of magnitude over everything else — the same finding across
          every round of the research spike (<code>docs/predictive-model.md</code>).
        </p>
      </Card>

      <Card title={`Top ${TOP_N} features`} subtitle="Ranked by permutation importance, averaged across all walk-forward folds">
        <div ref={barRef} className="h-[560px]" />
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700">All {sorted.length} features</h3>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a feature…"
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
          />
        </div>
        <div className={`max-h-[70vh] overflow-auto ${tableWrapCls}`}>
          <table className="w-full text-xs">
            <thead className={`sticky top-0 ${theadCls}`}>
              <tr>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2 text-right">Importance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r.feature)} className={trCls}>
                  <td className="px-3 py-1.5 font-medium">{labelFor(String(r.feature))}</td>
                  <td className="px-3 py-1.5 text-right">{Number(r.importance ?? 0).toFixed(4)}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-slate-400">No features match "{search}".</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
