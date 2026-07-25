// Feature contribution — permutation importance (averaged across every
// walk-forward fold), not raw linear coefficients: the 41 features are
// meaningfully collinear (EPA/success-rate/grade all correlate), which
// destabilizes raw coefficient signs/magnitudes across refits. Permutation
// importance is the decision doc's explicit recommendation
// (docs/predictive-model-decision.md).
//
// The bottom "Game inspector" section is different: it's a per-game exact
// decomposition (lin_reg is impute -> scale -> linear, so predicted_margin
// == intercept + sum(coef_i * scaled_feature_i)), not a global importance
// measure — it answers "how did this specific game's stats convert into
// this specific prediction," which permutation importance can't.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../lib/data/loader";
import { useECharts } from "../../components/charts/useECharts";
import { Card, tableWrapCls, theadCls, trCls } from "../../components/ui";
import { labelFor, pct } from "./shared";

const TOP_N = 20;

export default function ExplanationTab({
  importance,
  games,
  gameFeatures,
  featureCols,
}: {
  importance: Row[];
  games: Row[];
  gameFeatures: Row[];
  featureCols: string[];
}) {
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

  // Game inspector — pick a game via season/week, then a matchup within it.
  const gameSeasons = useMemo(() => Array.from(new Set(games.map((g) => Number(g.season)))).sort((a, b) => b - a), [games]);
  const [gsSeason, setGsSeason] = useState<number | null>(null);
  const season = gsSeason ?? gameSeasons[0] ?? null;

  const weeksForSeason = useMemo(
    () => Array.from(new Set(games.filter((g) => Number(g.season) === season).map((g) => Number(g.week)))).sort((a, b) => a - b),
    [games, season],
  );
  const [gsWeek, setGsWeek] = useState<number | null>(null);
  const week = gsWeek ?? weeksForSeason[0] ?? null;

  const matchups = useMemo(
    () => games.filter((g) => Number(g.season) === season && Number(g.week) === week),
    [games, season, week],
  );
  const [gsMatchupKey, setGsMatchupKey] = useState<string | null>(null);
  const matchupKey = gsMatchupKey ?? (matchups[0] ? `${matchups[0].away_team}@${matchups[0].home_team}` : null);
  const selectedGame = matchups.find((g) => `${g.away_team}@${g.home_team}` === matchupKey) ?? null;

  const selectedFeatures = useMemo(() => {
    if (!selectedGame) return null;
    return (
      gameFeatures.find(
        (f) => Number(f.season) === Number(selectedGame.season) && Number(f.week) === Number(selectedGame.week) &&
          f.home_team === selectedGame.home_team && f.away_team === selectedGame.away_team,
      ) ?? null
    );
  }, [gameFeatures, selectedGame]);

  const contribRows = useMemo(() => {
    if (!selectedFeatures) return [];
    return featureCols
      .map((c) => ({
        feature: c,
        raw: selectedFeatures[c] === null ? null : Number(selectedFeatures[c]),
        contrib: Number(selectedFeatures[`${c}_contrib`] ?? 0),
      }))
      .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  }, [selectedFeatures, featureCols]);

  const intercept = selectedFeatures ? Number(selectedFeatures.intercept) : 0;
  const contribSum = contribRows.reduce((s, r) => s + r.contrib, 0) + intercept;

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

      <Card
        title="Game inspector"
        subtitle="Pick a game to see exactly how its stats added up to the model's prediction — an exact per-game breakdown, not an average"
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Season</span>
            <select
              value={season ?? ""}
              onChange={(e) => { setGsSeason(Number(e.target.value)); setGsWeek(null); setGsMatchupKey(null); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
            >
              {gameSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Week</span>
            <select
              value={week ?? ""}
              onChange={(e) => { setGsWeek(Number(e.target.value)); setGsMatchupKey(null); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
            >
              {weeksForSeason.map((w) => <option key={w} value={w}>Week {w}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Matchup</span>
            <select
              value={matchupKey ?? ""}
              onChange={(e) => setGsMatchupKey(e.target.value)}
              className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
            >
              {matchups.map((g) => {
                const key = `${g.away_team}@${g.home_team}`;
                return <option key={key} value={key}>{key}</option>;
              })}
            </select>
          </label>
        </div>

        {selectedGame && (
          <>
            <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm">
              <div><span className="text-slate-400">Predicted margin: </span><b className="text-slate-800">{Number(selectedGame.predicted_margin).toFixed(1)}</b></div>
              <div><span className="text-slate-400">Actual margin: </span><b className="text-slate-800">{Number(selectedGame.actual_margin).toFixed(1)}</b></div>
              <div><span className="text-slate-400">Home win prob: </span><b className="text-slate-800">{pct(Number(selectedGame.home_win_prob))}</b></div>
              <div><span className="text-slate-400">Spread line: </span><b className="text-slate-800">{selectedGame.spread_line !== null ? Number(selectedGame.spread_line).toFixed(1) : "--"}</b></div>
            </div>

            {selectedFeatures ? (
              <div className={`max-h-[60vh] overflow-auto ${tableWrapCls}`}>
                <table className="w-full text-xs">
                  <thead className={`sticky top-0 ${theadCls}`}>
                    <tr>
                      <th className="px-3 py-2">Feature</th>
                      <th className="px-3 py-2 text-right">Raw value (home − away)</th>
                      <th className="px-3 py-2 text-right">Contribution to margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={trCls}>
                      <td className="px-3 py-1.5 font-medium text-slate-500">Intercept (baseline)</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">--</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{intercept.toFixed(2)}</td>
                    </tr>
                    {contribRows.map((r) => (
                      <tr key={r.feature} className={trCls}>
                        <td className="px-3 py-1.5 font-medium">{labelFor(r.feature)}</td>
                        <td className="px-3 py-1.5 text-right">{r.raw !== null ? r.raw.toFixed(2) : "--"}</td>
                        <td className={`px-3 py-1.5 text-right font-semibold ${r.contrib >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {r.contrib >= 0 ? "+" : ""}{r.contrib.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-slate-50/70">
                      <td className="px-3 py-1.5 font-semibold text-slate-700" colSpan={2}>Sum (intercept + all contributions)</td>
                      <td className="px-3 py-1.5 text-right font-bold text-slate-800">{contribSum.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No feature breakdown available for this game.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              This model is linear, so every feature's contribution above is exact — the sum row matches the
              predicted margin. Green pushed the prediction toward a home win/bigger home margin; red pushed it
              toward the away team.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
