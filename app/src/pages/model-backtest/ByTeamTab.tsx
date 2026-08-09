// By Team — which teams the model profits, or loses, on when it bets them.
import { useMemo, useState, type ReactNode } from "react";
import { LazyMount } from "../../components/LazyMount";
import { FilterGroup, tableWrapCls, theadCls, trCls, ScrollHint } from "../../components/ui";
import { type MetricKey } from "../game-analysis/previews/engine";
import { type GameBacktestRow, summarizeByTeam, type BacktestSummary } from "../../lib/logic/backtest";
import { pct, money, roiPct, profitColor } from "./shared";

type SortKey = "team" | "roi" | "profit" | "accuracy" | "n";

export default function ByTeamTab({
  rows,
  modelKeys,
  primary,
  onPrimaryChange,
}: {
  rows: GameBacktestRow[];
  modelKeys: readonly [MetricKey, string][];
  primary: MetricKey;
  onPrimaryChange: (k: MetricKey) => void;
}) {
  const byTeam = useMemo(() => summarizeByTeam(rows, primary), [rows, primary]);
  const [sortKey, setSortKey] = useState<SortKey>("roi");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const val = (s: BacktestSummary, team: string): number | string => {
      if (sortKey === "team") return team;
      if (sortKey === "roi") return s.roi ?? -Infinity;
      if (sortKey === "profit") return s.totalProfit ?? -Infinity;
      if (sortKey === "accuracy") return s.accuracy ?? -Infinity;
      return s.nGraded;
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...byTeam].sort((a, b) => {
      const va = val(a.summary, a.team);
      const vb = val(b.summary, b.team);
      if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb));
      return dir * (va - vb);
    });
  }, [byTeam, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const Th = ({ k, children, align = "right" }: { k: SortKey; children: ReactNode; align?: "left" | "right" }) => (
    <th
      className={`cursor-pointer select-none px-3 py-2 ${align === "left" ? "text-left" : "text-right"} ${sortKey === k ? "text-[#002f6c]" : ""}`}
      onClick={() => onSort(k)}
    >
      {children}
      {sortKey === k && (sortDir === "asc" ? " ▲" : " ▼")}
    </th>
  );

  return (
    <div className="space-y-4">
      <FilterGroup label="Model">
        <div className="flex flex-wrap gap-2">
          {modelKeys.map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => onPrimaryChange(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${primary === k ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </FilterGroup>
      <p className="text-[11px] text-slate-400">Credits the team actually bet on (the model's pick), not both teams in every game it appears in. Click a column to sort.</p>

      <LazyMount minHeight={480}>
        <div className={tableWrapCls}>
          <table className="w-full border-collapse text-xs">
            <thead className={theadCls}>
              <tr>
                <Th k="team" align="left">Team</Th>
                <Th k="n">Picks</Th>
                <Th k="accuracy">Accuracy</Th>
                <Th k="profit">Profit</Th>
                <Th k="roi">ROI</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ team, summary }) => (
                <tr key={team} className={trCls}>
                  <td className="px-3 py-2 font-bold">{team}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{summary.nGraded.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(summary.accuracy)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(summary.totalProfit) }}>
                    {money(summary.totalProfit)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: profitColor(summary.roi) }}>
                    {roiPct(summary.roi)}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    No graded bets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ScrollHint />
        </div>
      </LazyMount>
    </div>
  );
}
