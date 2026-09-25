// Win-type breakdown for the "Similar weeks (auto-detected)" box plot —
// opened by clicking that chart's title. Pools "This week" + every
// auto-detected comparable week (same set/order the box plot itself plots)
// and shows: KPIs averaged per win type across the set, a stacked bar per
// week (same category colors/order as the Win Types tab) with the Win Types
// tab's spread scatter beside it (below on mobile), and — reusing
// WinTypeDetailModal's own body — a full games breakdown for whichever
// week's bar is selected (defaults to "This week").
import { useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { Modal } from "../../../../components/Modal";
import { Kpi } from "../../../../components/ui";
import { useECharts } from "../../../../components/charts/useECharts";
import { CATEGORY_COLORS, CATEGORY_CODES, WIN_TYPE_COLORS } from "../../../../lib/logic/winType";
import { classify, spreadScatterOption, CATEGORY_ORDER, type Game } from "../WinTypesTab";
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
    () =>
      groups.map((g, i) => {
        // compact axis label ("2023 W5") so ~12 weeks fit side-by-side on a
        // phone; the full label still heads each tooltip
        const r0 = g.rows[0];
        const short = i === 0 ? "This wk" : r0 ? `${r0.season} W${r0.week}` : g.label;
        return { label: g.label, short, games: g.rows.map((r) => classify(r, "week")) };
      }),
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
      grid: { left: 10, right: 10, top: 60, bottom: 10, containLabel: true },
      legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: { seriesName: string; value: unknown; dataIndex: number; color: string }[]) => {
          const g = groupsWithGames[ps[0]?.dataIndex ?? 0];
          const lines = ps
            .filter((p) => Number(p.value) > 0)
            .map(
              (p) =>
                `<div style="display:flex;justify-content:space-between;gap:14px;"><span>` +
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>` +
                `${p.seriesName}</span><span style="font-weight:600;">${Number(p.value)}</span></div>`,
            );
          return `<div style="font-weight:600;margin-bottom:4px;">${g?.label ?? ""} — ${g?.games.length ?? 0} games</div>${lines.join("")}`;
        },
      },
      xAxis: {
        type: "category",
        data: groupsWithGames.map((g) => g.short),
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

  // Spread scatter (same builder as the Win Types tab's per-group block): one
  // dot per game at (week, spread), colored by how it resolved — shows how
  // lopsided each week's lines were and which of them the underdog cashed.
  // Games are keyed to their group by gameId (weeks never share a game).
  const scatterOption = useMemo(() => {
    const groupOf = new Map<string, (typeof groupsWithGames)[number]>();
    for (const g of groupsWithGames) for (const x of g.games) groupOf.set(x.gameId, g);
    return spreadScatterOption({
      games: groupsWithGames.flatMap((g) => g.games),
      categories: groupsWithGames.map((g) => g.short),
      xOf: (x: Game) => groupOf.get(x.gameId)?.short ?? "",
      xTitle: (x: Game) => groupOf.get(x.gameId)?.label ?? "",
      axisLabel: { rotate: 45, fontSize: 9, hideOverlap: false },
      // room for the "Spread" axis name, level with the bar chart's plot top
      grid: { top: 60 },
    });
  }, [groupsWithGames]);

  const barRef = useECharts(barOption, {
    onInit: (chart) => {
      chart.on("click", (p: { dataIndex?: number }) => {
        if (p.dataIndex != null) setSelectedIdx(p.dataIndex);
      });
    },
  });
  // clicking a dot selects its week too; the click handler is bound once at
  // init, so read the latest groups through a ref
  const shortsRef = useRef<string[]>([]);
  shortsRef.current = groupsWithGames.map((g) => g.short);
  const scatterRef = useECharts(scatterOption, {
    onInit: (chart) => {
      chart.on("click", (p: { value?: unknown }) => {
        const i = Array.isArray(p.value) ? shortsRef.current.indexOf(String(p.value[0])) : -1;
        if (i >= 0) setSelectedIdx(i);
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
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <div className="mb-1 text-[11px] text-slate-400">Click a bar to see that week&apos;s games below.</div>
              <div ref={barRef} className="h-[320px] sm:h-[360px]" />
            </div>
            {scatterOption && (
              <div className="min-w-0">
                <div className="mb-1 truncate text-[11px] text-slate-400">Spread per game · hover a dot for the result</div>
                <div ref={scatterRef} className="h-[320px] sm:h-[360px]" />
              </div>
            )}
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
