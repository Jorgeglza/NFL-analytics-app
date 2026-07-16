// Port of game_picks_page_1.py — weekly results, win-type counts, spread scatter.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { WIN_TYPE_COLORS, type WinType } from "../../lib/logic/winType";

const WIN_TYPES: WinType[] = ["Favorite home", "Favorite away", "Underdog home", "Underdog away"];

export default function GamePicks() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [season, setSeason] = useState("");
  const [week, setWeek] = useState("");

  useEffect(() => {
    getSchedule().then((rows) => {
      setSchedule(rows);
      const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => b - a);
      if (seasons.length) {
        const s = seasons[0];
        setSeason(String(s));
        // default to the last week with a played game, else week 1
        const played = rows.filter((r) => Number(r.season) === s && r.home_score != null);
        const w = played.length ? Math.max(...played.map((r) => Number(r.week))) : 1;
        setWeek(String(w));
      }
    });
  }, []);

  const seasons = useMemo(
    () => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a),
    [schedule],
  );
  const weeks = useMemo(
    () =>
      [...new Set(schedule.filter((r) => String(r.season) === season).map((r) => Number(r.week)))].sort(
        (a, b) => a - b,
      ),
    [schedule, season],
  );

  const games = useMemo(
    () =>
      schedule
        .filter((r) => String(r.season) === season && String(r.week) === week)
        .sort((a, b) => String(a.gameday ?? "").localeCompare(String(b.gameday ?? ""))),
    [schedule, season, week],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of games) {
      const wt = g["Win Type"];
      if (wt != null) c[String(wt)] = (c[String(wt)] ?? 0) + 1;
    }
    return c;
  }, [games]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const barOption = useMemo(() => {
    if (!total) return null;
    return {
      grid: { left: 10, right: 10, top: 30, bottom: 10, containLabel: true },
      xAxis: { type: "value" as const, max: total, show: false },
      yAxis: { type: "category" as const, data: ["Win types"], show: false },
      series: WIN_TYPES.filter((wt) => counts[wt]).map((wt) => ({
        name: wt,
        type: "bar" as const,
        stack: "total",
        data: [counts[wt]],
        itemStyle: { color: WIN_TYPE_COLORS[wt] },
        label: {
          show: true,
          formatter: () => `${wt}\n${counts[wt]} | ${Math.round((counts[wt] / total) * 100)}%`,
          color: "#fff",
          fontSize: 11,
        },
      })),
      legend: { show: true, top: 0 },
      tooltip: { trigger: "item" as const },
    };
  }, [counts, total]);

  const scatterOption = useMemo(() => {
    const pts = games.filter((g) => g.spread_line != null);
    if (!pts.length) return null;
    return {
      grid: { left: 10, right: 20, top: 30, bottom: 10, containLabel: true },
      xAxis: { type: "value" as const, name: "Spread (home persp.)", nameLocation: "middle" as const, nameGap: 28 },
      yAxis: { type: "category" as const, data: pts.map((g) => `${g.away_team} @ ${g.home_team}`) },
      tooltip: {
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { dataIndex: number };
          const g = pts[p.dataIndex];
          return `${g.away_team} ${g.away_score ?? "—"} @ ${g.home_team} ${g.home_score ?? "—"}<br/>Spread: ${g.spread_line}<br/>${g["Win Type"] ?? "No result"}`;
        },
      },
      series: [
        {
          type: "scatter" as const,
          symbolSize: 14,
          data: pts.map((g, i) => ({
            value: [Number(g.spread_line), i],
            itemStyle: {
              color: g["Win Type"] ? WIN_TYPE_COLORS[g["Win Type"] as WinType] : "#D4AF37",
            },
          })),
        },
      ],
    };
  }, [games]);

  const barRef = useECharts(barOption);
  const scatterRef = useECharts(scatterOption);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-2xl font-bold text-[#002f6c]">Game Picks</h1>
        <Select label="Season" value={season} onChange={(v) => setSeason(v)} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Away</th>
              <th className="px-3 py-2 text-center">A</th>
              <th className="px-3 py-2 text-center">H</th>
              <th className="px-3 py-2">Home</th>
              <th className="px-3 py-2 text-center">Spread</th>
              <th className="px-3 py-2">Win Type</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={String(g.game_id)} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-500">{String(g.gameday ?? "")}</td>
                <td className="px-3 py-2 font-medium">{String(g.away_team)}</td>
                <td className="px-3 py-2 text-center">{g.away_score ?? "—"}</td>
                <td className="px-3 py-2 text-center">{g.home_score ?? "—"}</td>
                <td className="px-3 py-2 font-medium">{String(g.home_team)}</td>
                <td className="px-3 py-2 text-center">{g.spread_line ?? "—"}</td>
                <td className="px-3 py-2">
                  {g["Win Type"] ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ background: WIN_TYPE_COLORS[g["Win Type"] as WinType] }}
                    >
                      {String(g["Win Type"])}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Not played</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Win types — Week {week}</h2>
          <div ref={barRef} className="h-40" />
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Spread by game</h2>
          <div ref={scatterRef} className="h-80" />
        </div>
      </div>
    </div>
  );
}
