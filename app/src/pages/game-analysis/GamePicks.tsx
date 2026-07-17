// Port of game_picks_page_1.py — weekly results table with manual-winner
// checkboxes for unplayed games (persisted in localStorage), win-type counts
// bar, and spread-by-win-type scatter with ×N collision markers.
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { getSchedule, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";

const LABEL_FOR_NONE = "No result yet";
const COLORS: Record<string, string> = {
  "Favorite home": "#3C9A5F",
  "Favorite away": "#2459A7",
  "Underdog home": "#E87722",
  "Underdog away": "#C8102E",
  [LABEL_FOR_NONE]: "#e0e0e0",
};
const ROW_BG: Record<string, string> = {
  "Favorite home": "rgba(60,154,95,0.2)",
  "Favorite away": "rgba(36,89,167,0.2)",
  "Underdog home": "rgba(232,119,34,0.2)",
  "Underdog away": "rgba(200,16,46,0.2)",
};
const ORDER = ["Favorite home", "Favorite away", "Underdog home", "Underdog away", LABEL_FOR_NONE];
const LS_KEY = "gamePicks.manualWinners";

function loadManual(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function GamePicks() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [season, setSeason] = useState("");
  const [week, setWeek] = useState("");
  const [manual, setManual] = useState<string[]>(loadManual);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(manual));
  }, [manual]);

  useEffect(() => {
    getSchedule().then((rows) => {
      setSchedule(rows);
      const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => b - a);
      if (seasons.length) {
        const s = seasons[0];
        setSeason(String(s));
        const played = rows.filter((r) => Number(r.season) === s && r.home_score != null);
        setWeek(String(played.length ? Math.max(...played.map((r) => Number(r.week))) : 1));
      }
    });
  }, []);

  const seasons = useMemo(() => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a), [schedule]);
  const weeks = useMemo(
    () => [...new Set(schedule.filter((r) => String(r.season) === season).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [schedule, season],
  );

  const games = useMemo(() => {
    return schedule
      .filter((r) => String(r.season) === season && String(r.week) === week)
      .map((g) => {
        const gid = String(g.game_id);
        const hs = g.home_score == null ? null : Number(g.home_score);
        const as_ = g.away_score == null ? null : Number(g.away_score);
        const manualWinner = hs == null && as_ == null ? (manual.includes(`${gid}_home`) ? "home" : manual.includes(`${gid}_away`) ? "away" : null) : null;
        const winner = hs != null && as_ != null ? (hs > as_ ? "home" : as_ > hs ? "away" : null) : manualWinner;
        const spread = g.spread_line == null ? null : Number(g.spread_line);
        const favorite = spread == null ? null : spread < 0 ? "home" : spread > 0 ? "away" : "none";
        let winType: string | null = null;
        if (winner != null && favorite != null && favorite !== "none") {
          if (winner === favorite) winType = winner === "home" ? "Favorite home" : "Favorite away";
          else winType = winner === "home" ? "Underdog home" : "Underdog away";
        }
        const winnerTeam = winner === "home" ? String(g.home_team) : winner === "away" ? String(g.away_team) : null;
        return { g, gid, hs, as_, spread, winner, winType, winnerTeam, label: winType ?? LABEL_FOR_NONE };
      })
      .sort((a, b) => String(a.g.gameday ?? "").localeCompare(String(b.g.gameday ?? "")));
  }, [schedule, season, week, manual]);

  const toggleManual = (gid: string, side: "home" | "away") => {
    setManual((cur) => {
      const cleared = cur.filter((c) => !c.startsWith(`${gid}_`));
      const key = `${gid}_${side}`;
      return cur.includes(key) ? cleared : [...cleared, key];
    });
  };

  const chartOption = useMemo<EChartsOption | null>(() => {
    if (!games.length) return null;
    const counts = new Map<string, number>();
    for (const g of games) counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
    const present = ORDER.filter((l) => counts.has(l));
    const total = games.length;

    // scatter collisions per (label, spread rounded 2)
    const groups = new Map<string, typeof games>();
    for (const g of games) {
      if (g.spread == null || !present.includes(g.label)) continue;
      const key = `${g.label}|${g.spread.toFixed(2)}`;
      groups.set(key, [...(groups.get(key) ?? []), g]);
    }
    const singles: { label: string; spread: number; g: (typeof games)[number] }[] = [];
    const overlaps: { label: string; spread: number; items: typeof games }[] = [];
    for (const [key, items] of groups) {
      const [label, spreadStr] = key.split("|");
      if (items.length > 1) overlaps.push({ label, spread: Number(spreadStr), items });
      else singles.push({ label, spread: Number(spreadStr), g: items[0] });
    }

    return {
      grid: [
        { left: 10, right: 15, top: 25, height: "32%", containLabel: true },
        { left: 10, right: 15, top: "52%", bottom: 10, containLabel: true },
      ],
      xAxis: [
        { type: "category", gridIndex: 0, data: present, axisLabel: { fontSize: 10 } },
        { type: "category", gridIndex: 1, data: present, axisLabel: { fontSize: 10 } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, name: "Games" },
        { type: "value", gridIndex: 1, name: "Spread" },
      ],
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: present.map((l) => ({
            value: counts.get(l) ?? 0,
            itemStyle: { color: COLORS[l] },
          })),
          label: {
            show: true,
            position: "top",
            formatter: (p: { value?: unknown; name: string }) =>
              `${p.value}  (${total ? (((counts.get(p.name) ?? 0) / total) * 100).toFixed(1) : 0}%)`,
            fontSize: 11,
          },
        },
        {
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          symbolSize: 9,
          data: singles.map(({ label, spread, g }) => ({
            value: [label, spread],
            itemStyle: { color: COLORS[label], opacity: 0.9 },
            tooltip: { formatter: () => `Game=${g.gid}<br/>${g.winnerTeam ?? "—"}, ${label}<br/>Spread=${spread.toFixed(2)}` },
          })),
        },
        {
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          symbolSize: 10,
          data: overlaps.map(({ label, spread, items }) => {
            const c = new Map<string, number>();
            for (const it of items) c.set(it.label, (c.get(it.label) ?? 0) + 1);
            const sorted = [...c.entries()].sort((a, b) => b[1] - a[1]);
            const fill = COLORS[sorted[0][0]] ?? "#000";
            const border = sorted.length > 1 ? COLORS[sorted[1][0]] ?? fill : fill;
            return {
              value: [label, spread],
              itemStyle: { color: fill, borderColor: border, borderWidth: 2, opacity: 0.95 },
              label: { show: true, position: "top" as const, fontSize: 8, formatter: `×${items.length}` },
              tooltip: {
                formatter: () =>
                  items.map((it) => `${it.gid} | Winner: ${it.winnerTeam ?? "—"} | Win Type: ${it.label} | Spread: ${it.spread}`).join("<br/>"),
              },
            };
          }),
        },
      ],
    } as EChartsOption;
  }, [games]);

  const chartRef = useECharts(chartOption);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-2xl font-bold text-[#002f6c]">Game Picks</h1>
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {["Date", "Away", "A Score", "H Score", "Home", "Spread", "Win Type"].map((h) => (
                <th key={h} className="px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map(({ g, gid, hs, as_, spread, winType }) => (
              <tr key={gid} className="border-t border-slate-100" style={{ background: winType ? ROW_BG[winType] : "rgba(224,224,224,0.1)" }}>
                <td className="px-3 py-2 text-slate-600">{String(g.gameday ?? "")}</td>
                <td className="px-3 py-2 font-medium">{String(g.away_team)}</td>
                <td className="px-3 py-2 text-center">
                  {as_ != null ? Math.round(as_) : (
                    <label className="cursor-pointer select-none" title="Mark away team as manual winner">
                      <input type="checkbox" checked={manual.includes(`${gid}_away`)} onChange={() => toggleManual(gid, "away")} /> ✔
                    </label>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {hs != null ? Math.round(hs) : (
                    <label className="cursor-pointer select-none" title="Mark home team as manual winner">
                      <input type="checkbox" checked={manual.includes(`${gid}_home`)} onChange={() => toggleManual(gid, "home")} /> ✔
                    </label>
                  )}
                </td>
                <td className="px-3 py-2 font-medium">{String(g.home_team)}</td>
                <td className="px-3 py-2 text-center">{spread ?? "—"}</td>
                <td className="px-3 py-2">
                  {winType ? (
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: COLORS[winType] }}>
                      {winType}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">{LABEL_FOR_NONE}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Win types &amp; spread — Week {week}</h2>
        <div ref={chartRef} className="h-[560px]" />
      </div>
    </div>
  );
}
