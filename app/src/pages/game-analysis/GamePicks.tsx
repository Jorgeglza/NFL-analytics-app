// Port of game_picks_page_1.py — weekly results table with manual-winner
// checkboxes for unplayed games (persisted in localStorage), win-type counts
// bar, and a spread-by-game bar chart (sortable by kickoff time or spread).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import { getSchedule, type Row } from "../../lib/data/loader";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { WIN_TYPE_COLORS } from "../../lib/logic/winType";
import { useSeasonWeek } from "../../context/SeasonWeekContext";

const LABEL_FOR_NONE = "No result yet";
const COLORS: Record<string, string> = {
  ...WIN_TYPE_COLORS,
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
  const [searchParams] = useSearchParams();
  const { season, week, setSeason, setWeek } = useSeasonWeek();
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [manual, setManual] = useState<string[]>(loadManual);
  const [spreadSort, setSpreadSort] = useState<"time" | "spread">("time");
  const deepLinkApplied = useRef(false);

  usePageTitle(season && week ? `Game Picks — Wk ${week}, ${season}` : "Game Picks");

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(manual));
  }, [manual]);

  useEffect(() => {
    getSchedule().then(setSchedule);
  }, []);

  // Deep-linked (e.g. from Home's "this week" launchpad or another page) —
  // the URL params win over whatever the shared season/week context has,
  // applied once per mount. Otherwise the shared context (seeded from the
  // current/last-completed week — audit §2) already provides the default.
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const s = searchParams.get("season");
    const w = searchParams.get("week");
    if (s && w) {
      deepLinkApplied.current = true;
      setSeason(s);
      setWeek(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const seasons = useMemo(() => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a), [schedule]);
  const weeks = useMemo(
    () => [...new Set(schedule.filter((r) => String(r.season) === season).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [schedule, season],
  );

  const stepWeek = (dir: -1 | 1) => {
    const idx = weeks.indexOf(Number(week));
    const next = weeks[idx + dir];
    if (next != null) setWeek(String(next));
  };

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

  // Record of manual picks vs. actual results for the selected week.
  const pickRecord = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    let pending = 0;
    for (const { gid, hs, as_ } of games) {
      const picked = manual.includes(`${gid}_home`) ? "home" : manual.includes(`${gid}_away`) ? "away" : null;
      if (!picked) continue;
      if (hs == null || as_ == null) pending++;
      else if (hs === as_) continue; // tie — no winner to grade against
      else if ((hs > as_ ? "home" : "away") === picked) correct++;
      else wrong++;
    }
    return { correct, wrong, pending, any: correct + wrong + pending > 0 };
  }, [games, manual]);

  const toggleManual = (gid: string, side: "home" | "away") => {
    setManual((cur) => {
      const cleared = cur.filter((c) => !c.startsWith(`${gid}_`));
      const key = `${gid}_${side}`;
      return cur.includes(key) ? cleared : [...cleared, key];
    });
  };

  const countsOption = useMemo<EChartsOption | null>(() => {
    if (!games.length) return null;
    const counts = new Map<string, number>();
    for (const g of games) counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
    const present = ORDER.filter((l) => counts.has(l));
    const total = games.length;
    return {
      grid: { left: 10, right: 15, top: 25, bottom: 10, containLabel: true },
      xAxis: { type: "category", data: present, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "Games" },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
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
      ],
    } as EChartsOption;
  }, [games]);

  const spreadGames = useMemo(() => {
    const withSpread = games.filter((g) => g.spread != null);
    if (spreadSort === "spread") return [...withSpread].sort((a, b) => (a.spread ?? 0) - (b.spread ?? 0));
    return withSpread; // games[] is already kickoff-ordered
  }, [games, spreadSort]);

  const spreadOption = useMemo<EChartsOption | null>(() => {
    if (!spreadGames.length) return null;
    return {
      grid: { left: 10, right: 40, top: 25, bottom: 10, containLabel: true },
      xAxis: { type: "value", name: "Spread", nameLocation: "middle", nameGap: 22 },
      yAxis: {
        type: "category",
        inverse: true, // first game at the top
        data: spreadGames.map((g) => `${g.g.away_team} @ ${g.g.home_team}`),
        axisLabel: { fontSize: 10 },
      },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          barMaxWidth: 14,
          data: spreadGames.map((g) => ({
            value: g.spread,
            itemStyle: { color: COLORS[g.label], borderRadius: 3 },
            tooltip: {
              formatter: () =>
                `${g.g.away_team} @ ${g.g.home_team} — ${String(g.g.gameday ?? "")}<br/>Winner: ${g.winnerTeam ?? "—"} | ${g.label}<br/>Spread: ${g.spread?.toFixed(1)} (${(g.spread ?? 0) < 0 ? "home" : (g.spread ?? 0) > 0 ? "away" : "pick'em"} favored)`,
            },
          })),
          label: {
            show: true,
            position: "right",
            fontSize: 9,
            formatter: (p: { value?: unknown }) => String(p.value),
          },
        },
      ],
    } as EChartsOption;
  }, [spreadGames]);

  const countsRef = useECharts(countsOption);
  const spreadRef = useECharts(spreadOption);

  if (!schedule.length) return <Loading label="Loading schedule…" />;

  const weekIdx = weeks.indexOf(Number(week));
  const stepBtnCls = "grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 title="Once you've made your picks, see how these win types trend across a season on Win Types." className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Game Picks</h1>
        {pickRecord.any && (
          <div className="flex items-center gap-1.5 self-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm" title="Your manual picks vs. final results for this week">
            <span className="uppercase tracking-wider text-slate-400">Your picks</span>
            <span className="text-[#3C9A5F]">{pickRecord.correct}✓</span>
            <span className="text-[#C8102E]">{pickRecord.wrong}✗</span>
            {pickRecord.correct + pickRecord.wrong > 0 && (
              <span className="text-slate-600">({Math.round((pickRecord.correct / (pickRecord.correct + pickRecord.wrong)) * 100)}%)</span>
            )}
            {pickRecord.pending > 0 && <span className="text-slate-400">· {pickRecord.pending} pending</span>}
          </div>
        )}
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <div className="flex items-end gap-1.5">
          <Select label="Week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <button className={stepBtnCls} onClick={() => stepWeek(-1)} disabled={weekIdx <= 0} title="Previous week">‹</button>
          <button className={stepBtnCls} onClick={() => stepWeek(1)} disabled={weekIdx < 0 || weekIdx >= weeks.length - 1} title="Next week">›</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Win types</span>
        {ORDER.filter((l) => l !== LABEL_FOR_NONE).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[l] }} />
            {l}
          </span>
        ))}
        <span className="ml-auto text-slate-400">Unplayed games show ✔ checkboxes — tick a team to record your pick (saved in this browser).</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <tr>
              {["Date", "Away", "A Score", "H Score", "Home", "Spread", "Win Type", "Zoom in"].map((h) => (
                <th key={h} className="px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map(({ g, gid, hs, as_, spread, winner, winType }) => (
              <tr key={gid} className="border-t border-slate-100" style={{ background: winType ? ROW_BG[winType] : "rgba(224,224,224,0.1)" }}>
                <td className="px-3 py-2 text-slate-600">{String(g.gameday ?? "")}</td>
                <td className={`px-3 py-2 ${winner === "away" ? "font-bold" : "font-medium"}`}>
                  {String(g.away_team)}
                  {winner === "away" && <span className="ml-1 text-xs font-black text-slate-700" title="Winner">✓</span>}
                </td>
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
                <td className={`px-3 py-2 ${winner === "home" ? "font-bold" : "font-medium"}`}>
                  {String(g.home_team)}
                  {winner === "home" && <span className="ml-1 text-xs font-black text-slate-700" title="Winner">✓</span>}
                </td>
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
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Link
                      to={`/game_analysis/matchup_previews?tab=matchup&season=${season}&week=${week}&game=${gid}`}
                      className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#002f6c]/50 hover:shadow"
                      title={`Open Matchup Preview — ${g.away_team} @ ${g.home_team}`}
                    >
                      ⚔️
                    </Link>
                    <Link
                      to={`/game_analysis/team_comparison?season=${season}&week=${week}&team1=${g.away_team}&team2=${g.home_team}`}
                      className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#002f6c]/50 hover:shadow"
                      title={`Compare ${g.away_team} vs ${g.home_team}`}
                    >
                      🆚
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Win-type counts — Week {week}</h2>
        <div ref={countsRef} className="h-[260px]" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Spread by game — Week {week}</h2>
          <div className="flex rounded-full border border-slate-200 bg-slate-100 p-0.5">
            {([["time", "Game time"], ["spread", "Spread"]] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setSpreadSort(v)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  spreadSort === v ? "bg-[#002f6c] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div ref={spreadRef} style={{ height: Math.max(180, 28 * spreadGames.length + 70) }} />
      </div>
    </div>
  );
}
