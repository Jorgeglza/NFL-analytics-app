// Win-type breakdown for the "Similar weeks (auto-detected)" box plot —
// opened by clicking that chart's title. Pools "This week" + every
// auto-detected comparable week (same set/order the box plot itself plots)
// and shows: KPIs averaged per win type across the set, a stacked bar per
// week (same category colors/order as the Win Types tab), and — reusing
// WinTypeDetailModal's own body — a full games breakdown for whichever
// week's bar is selected (defaults to "This week").
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Modal } from "../../../../components/Modal";
import { Kpi } from "../../../../components/ui";
import { useECharts } from "../../../../components/charts/useECharts";
import { CATEGORY_COLORS, CATEGORY_CODES, WIN_TYPE_COLORS } from "../../../../lib/logic/winType";
import { classify, CATEGORY_ORDER } from "../WinTypesTab";
import { WinTypeBreakdown } from "../WinTypeDetailModal";
import type { Row } from "../../../../lib/data/loader";

// The four "real" win types the top KPI row and bar stacks focus on — same
// relative order as CATEGORY_ORDER, so the KPI tiles read left-to-right in
// the same order the bar segments stack in.
const CORE_WIN_TYPES = ["Favorite home", "Underdog away", "Favorite away", "Underdog home"] as const;

export default function SimilarWeeksWinTypesModal({
  groups,
  onClose,
}: {
  /** "This week" first, then each similarWeeks candidate — same shape/order
   *  as ThisWeekView's `similarBoxEntriesRef.current`. */
  groups: { label: string; rows: Row[] }[];
  onClose: () => void;
}) {
  const groupsWithGames = useMemo(
    () => groups.map((g) => ({ label: g.label, games: g.rows.map((r) => classify(r, "week")) })),
    [groups],
  );
  const [selectedIdx, setSelectedIdx] = useState(0);
  const idx = Math.min(selectedIdx, groupsWithGames.length - 1);

  // Average % share of each core win type, one week = one equally-weighted
  // sample (not pooled by game count, so a bye-heavy week doesn't skew it).
  const avgShare = useMemo(() => {
    const withGames = groupsWithGames.filter((g) => g.games.length > 0);
    return Object.fromEntries(
      CORE_WIN_TYPES.map((cat) => {
        if (!withGames.length) return [cat, null];
        const pcts = withGames.map((g) => (g.games.filter((x) => x.category === cat).length / g.games.length) * 100);
        return [cat, pcts.reduce((a, b) => a + b, 0) / pcts.length];
      }),
    ) as Record<(typeof CORE_WIN_TYPES)[number], number | null>;
  }, [groupsWithGames]);

  // Same avg %, translated into an actual game count against THIS week's
  // slate size (groups[0], "This week") — e.g. "29% -> ~5 of 16 games this
  // week" reads a lot more concretely than the bare percentage alone.
  const thisWeekGameCount = groupsWithGames[0]?.games.length ?? 0;

  const barOption = useMemo<EChartsOption | null>(() => {
    if (!groupsWithGames.some((g) => g.games.length)) return null;
    const present = CATEGORY_ORDER.filter((c) => groupsWithGames.some((g) => g.games.some((x) => x.category === c)));
    return {
      grid: { left: 10, right: 10, top: 40, bottom: 70, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: groupsWithGames.map((g) => g.label),
        axisLabel: { rotate: 45, fontSize: 9, hideOverlap: false },
      },
      yAxis: { type: "value", name: "Games" },
      series: present.map((cat) => ({
        name: cat,
        type: "bar",
        stack: "total",
        data: groupsWithGames.map((g) => g.games.filter((x) => x.category === cat).length),
        itemStyle: { color: CATEGORY_COLORS[cat] },
        label: {
          show: true,
          fontSize: 8,
          color: "#000",
          formatter: (p: { value?: unknown; dataIndex: number }) => {
            const v = Number(p.value);
            const total = groupsWithGames[p.dataIndex]?.games.length ?? 0;
            if (!v || !total || v / total < 0.08) return "";
            return `${CATEGORY_CODES[cat]} ${v}`;
          },
        },
      })),
    } as EChartsOption;
  }, [groupsWithGames]);

  const barRef = useECharts(barOption, {
    onInit: (chart) => {
      chart.on("click", (p: { dataIndex?: number }) => {
        if (p.dataIndex != null) setSelectedIdx(p.dataIndex);
      });
    },
  });

  const totalGames = groupsWithGames.reduce((s, g) => s + g.games.length, 0);

  return (
    <Modal
      onClose={onClose}
      wide
      title="Similar weeks — win-type breakdown"
      subtitle={`${groupsWithGames.length} comparable week${groupsWithGames.length === 1 ? "" : "s"} · ${totalGames} game${totalGames === 1 ? "" : "s"} total`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">
          {CORE_WIN_TYPES.map((cat) => {
            const share = avgShare[cat];
            const gamesEquiv = share == null || !thisWeekGameCount ? null : Math.round((share / 100) * thisWeekGameCount);
            return (
              <Kpi
                key={cat}
                label={cat}
                value={share == null ? "—" : `${Math.round(share)}%`}
                accent={WIN_TYPE_COLORS[cat]}
                sub={
                  gamesEquiv == null
                    ? `avg across ${groupsWithGames.length} weeks`
                    : `≈ ${gamesEquiv} of ${thisWeekGameCount} games this week`
                }
              />
            );
          })}
        </div>

        {barOption ? (
          <div>
            <div className="mb-1 text-[11px] text-slate-400">Click a bar to see that week&apos;s games below.</div>
            <div ref={barRef} className="h-[360px]" />
          </div>
        ) : (
          <div className="text-xs text-slate-400">Not enough data to chart win types for these weeks.</div>
        )}

        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">{groupsWithGames[idx]?.label ?? "—"}</div>
          <WinTypeBreakdown games={groupsWithGames[idx]?.games ?? []} />
        </div>
      </div>
    </Modal>
  );
}
