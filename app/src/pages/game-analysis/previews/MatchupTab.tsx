// Port of matchup_previews_tab.py — single-game deep dive: snapshot, moneyline,
// spread pick engine, trend edge predictor, trends, recent form, H2H.
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { Select } from "../../../components/filters/Select";
import { useECharts } from "../../../components/charts/useECharts";
import { gradeModelProb, blendProbs, MIN_N_BUCKET } from "../../../lib/logic/probBlend";
import { edgeComposite, EDGE_WEIGHTS } from "../../../lib/logic/edgeComposite";
import { impliedProb, fairProbs } from "../../../lib/logic/moneyline";
import { opponentLabel } from "../../grading-model/shared";
import {
  favoriteSide,
  bucketLabel,
  marketRate,
  defaultWeekNearToday,
  kickoffMs,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
} from "./engine";

const fmtMl = (ml: number | null) => (ml == null ? "—" : ml > 0 ? `+${Math.round(ml)}` : String(Math.round(ml)));
const pct1 = (p: number | null) => (p == null ? "—" : `${(100 * p).toFixed(1)}%`);

export default function MatchupTab({
  schedule,
  ranks,
  meta,
  hist,
  gradesIdx,
  twIdx,
}: {
  schedule: Row[];
  ranks: Map<number, Row[]>; // season -> rank rows
  meta: Map<string, TeamMeta>;
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
}) {
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const [season, setSeason] = useState("");
  const sel = season || String(seasons[0] ?? "");
  const s = Number(sel);
  const weeks = useMemo(
    () => [...new Set(reg.filter((r) => Number(r.season) === s).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [reg, s],
  );
  const [week, setWeek] = useState("");
  const defWeek = useMemo(() => defaultWeekNearToday(reg, s) ?? weeks[weeks.length - 1], [reg, s, weeks]);
  const selWeek = weeks.map(String).includes(week) ? week : String(defWeek ?? "");
  const w = Number(selWeek);
  const wkPlayed = Math.max(0, w - 1);

  const games = useMemo(
    () =>
      reg
        .filter((r) => Number(r.season) === s && Number(r.week) === w)
        .sort((a, b) => kickoffMs(a) - kickoffMs(b) || String(a.game_id).localeCompare(String(b.game_id))),
    [reg, s, w],
  );
  const [gameId, setGameId] = useState("");
  const selGame = games.find((g) => String(g.game_id) === gameId) ?? games[0];
  const away = selGame ? String(selGame.away_team) : "";
  const home = selGame ? String(selGame.home_team) : "";
  const [stat, setStat] = useState("points_margin");

  const recordOf = (team: string): string => {
    const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= w && r.win != null);
    const wins = rows.reduce((sm, r) => sm + Number(r.win), 0);
    return `${Math.round(wins)} - ${rows.length - Math.round(wins)}`;
  };

  // ---- pick engine ----
  const engine = useMemo(() => {
    if (!selGame) return null;
    const spread = selGame.spread_line == null ? null : Number(selGame.spread_line);
    const fav = favoriteSide(spread);
    let pMarket: number | null = null;
    let nBucket = 0;
    let bucket: string | null = null;
    if (spread != null && fav != null) {
      bucket = bucketLabel(spread);
      const m = marketRate(hist, bucket, fav, s, w);
      if (m) {
        pMarket = m.pHat;
        nBucket = m.n;
      }
    }
    const [lOvr] = gradesIdx.triple(away, s, w);
    const [rOvr] = gradesIdx.triple(home, s, w);
    const pModelAway = gradeModelProb(lOvr, rOvr);
    const pModelHome = pModelAway == null ? null : 1 - pModelAway;
    const pMarketHome = pMarket == null ? null : fav === "home" ? pMarket : 1 - pMarket;
    const pHome = blendProbs(pMarketHome, pModelHome);
    const pAway = pHome == null ? null : 1 - pHome;
    let pickTeam: string | null = null;
    if (pHome != null && pAway != null) pickTeam = pHome >= pAway ? home : away;
    let conf = 0;
    if (pHome != null && pAway != null) {
      const edge = Math.abs(Math.max(pHome, pAway) - 0.5) * 2;
      const nFactor = Math.min(1, nBucket / Math.max(1, MIN_N_BUCKET));
      conf = Math.round(100 * edge * (0.7 + 0.3 * nFactor));
    }
    // bucket details both sides
    const bucketRows = (["home", "away"] as const).map((side) => {
      const m = bucket ? marketRate(hist, bucket, side, s, w) : null;
      return { side, n: m?.n ?? null, p: m?.pHat ?? null };
    });
    const risks: string[] = [];
    if (spread == null) risks.push("No spread for this game (no market prior).");
    if (bucket == null) risks.push("Bucket undefined.");
    if (nBucket < MIN_N_BUCKET) risks.push(`Low-N bucket (N=${nBucket}, min ${MIN_N_BUCKET}).`);
    if (lOvr == null || rOvr == null) risks.push("Missing grades for one or both teams.");
    return { spread, fav, bucket, nBucket, pHome, pAway, pickTeam, conf, lOvr, rOvr, bucketRows, risks };
  }, [selGame, hist, gradesIdx, away, home, s, w]);

  // ---- trend edge ----
  const trendEdge = useMemo(() => {
    if (!selGame) return null;
    const gA = gradesIdx.avgOverall(away, s, wkPlayed);
    const gH = gradesIdx.avgOverall(home, s, wkPlayed);
    const fa = { ...twIdx.features(away, s, wkPlayed), grade: gA };
    const fh = { ...twIdx.features(home, s, wkPlayed), grade: gH };
    const parts = edgeComposite(fa, fh);
    const pAway = parts.pAway;
    const pHome = 1 - pAway;
    return { fa, fh, gA, gH, parts, pAway, pHome, pick: pAway >= pHome ? away : home };
  }, [selGame, gradesIdx, twIdx, away, home, s, wkPlayed]);

  const gaugeOption = (p: number | null, title: string): EChartsOption => ({
    series: [
      {
        type: "gauge",
        min: 0,
        max: 100,
        progress: { show: true, width: 8 },
        axisLine: { lineStyle: { width: 8 } },
        axisTick: { show: false },
        splitLine: { length: 6 },
        axisLabel: { fontSize: 8, distance: 12 },
        pointer: { width: 3 },
        title: { fontSize: 11, offsetCenter: [0, "75%"] },
        detail: { fontSize: 18, formatter: "{value}%", offsetCenter: [0, "45%"] },
        data: [{ value: p == null ? 0 : Math.round(100 * p), name: title }],
      },
    ],
  } as EChartsOption);

  const gaugeLeftRef = useECharts(useMemo(() => (engine ? gaugeOption(engine.pAway, `${away} win prob`) : null), [engine, away]));
  const gaugeRightRef = useECharts(useMemo(() => (engine ? gaugeOption(engine.pHome, `${home} win prob`) : null), [engine, home]));

  const edgeBarOption = useMemo<EChartsOption | null>(() => {
    if (!trendEdge) return null;
    const names = ["Grade Δ", "Last3 PM Δ", "Last3 EPA Δ", "PM slope Δ", "Last3 TO margin Δ"];
    const vals = [trendEdge.parts.gradeD, trendEdge.parts.pmL3D, trendEdge.parts.epaL3D, trendEdge.parts.pmSlopeD, trendEdge.parts.tomL3D];
    const detail = [
      [trendEdge.gA, trendEdge.gH, EDGE_WEIGHTS.grade],
      [trendEdge.fa.pmL3, trendEdge.fh.pmL3, EDGE_WEIGHTS.pmL3],
      [trendEdge.fa.epaL3, trendEdge.fh.epaL3, EDGE_WEIGHTS.epaL3],
      [trendEdge.fa.pmSlope, trendEdge.fh.pmSlope, EDGE_WEIGHTS.pmSlope],
      [trendEdge.fa.tomL3, trendEdge.fh.tomL3, EDGE_WEIGHTS.tomL3],
    ];
    const f2 = (x: number | null, signed = false) => (x == null || !Number.isFinite(x) ? "—" : `${signed && x >= 0 ? "+" : ""}${x.toFixed(2)}`);
    return {
      grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number; name: string };
          const [a, h, wt] = detail[q.dataIndex];
          const d = (a ?? 0) - (h ?? 0);
          return `${q.name}<br/>Away: ${f2(a)} | Home: ${f2(h)}<br/>Diff (Away − Home): ${f2(d, true)}<br/>Weight: ${f2(wt)}<br/><b>Contribution:</b> ${f2(vals[q.dataIndex], true)}`;
        },
      },
      xAxis: { type: "category", data: names, name: "Components (Δ away − home, weighted)", nameLocation: "middle", nameGap: 30, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "Edge contribution" },
      series: [
        {
          type: "bar",
          data: vals.map((v) => ({
            value: +v.toFixed(3),
            itemStyle: { color: v >= 0 ? meta.get(away)?.color ?? "#888" : meta.get(home)?.color ?? "#666" },
          })),
          label: { show: true, position: "top", fontSize: 10, formatter: (p: { value?: unknown }) => f2(Number(p.value), true) },
          markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#333" }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
      ],
    } as EChartsOption;
  }, [trendEdge, meta, away, home]);
  const edgeRef = useECharts(edgeBarOption);

  // ---- trends + rank ----
  const trendOption = (team: string): EChartsOption | null => {
    const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r[stat] != null);
    if (!rows.length) return null;
    const xs = rows.map((r) => String(r.week));
    const ys = rows.map((r) => Number(r[stat]));
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    const opps = rows.map((r) => opponentLabel(String(r.game_id ?? ""), team));
    return {
      grid: { left: 5, right: 10, top: 10, bottom: 5, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const q = p as { dataIndex: number };
          return `Week ${xs[q.dataIndex]} | ${opps[q.dataIndex]}<br/>${stat.replace(/_/g, " ")}: ${ys[q.dataIndex].toFixed(1)}`;
        },
      },
      xAxis: { type: "category", data: xs, axisLabel: { fontSize: 9 } },
      yAxis: { type: "value", axisLabel: { fontSize: 9 } },
      series: [
        {
          type: "line",
          data: ys.map((v, i) => ({ value: +v.toFixed(2), itemStyle: { color: Number(rows[i].win) === 1 ? "green" : "red" } })),
          lineStyle: { color: "#9E9E9E", width: 1 },
          symbolSize: 7,
        },
        { type: "line", data: xs.map(() => +avg.toFixed(2)), symbol: "none", lineStyle: { type: "dashed", width: 1, color: "#9E9E9E" }, tooltip: { show: false } },
      ],
    } as EChartsOption;
  };
  const leftTrendRef = useECharts(useMemo(() => (selGame ? trendOption(away) : null), [selGame, away, s, wkPlayed, stat, twIdx]));
  const rightTrendRef = useECharts(useMemo(() => (selGame ? trendOption(home) : null), [selGame, home, s, wkPlayed, stat, twIdx]));

  const rankBar = useMemo(() => {
    const rows = ranks.get(s) ?? [];
    const rowOf = (t: string) => rows.find((r) => String(r.team) === t && Number(r.week) === wkPlayed);
    const r1 = rowOf(away)?.[`${stat}_rank`];
    const r2 = rowOf(home)?.[`${stat}_rank`];
    if (r1 == null || r2 == null) return null;
    const n1 = Number(r1);
    const n2 = Number(r2);
    const w1 = n1 + n2 > 0 ? 0.5 + (n2 / (n1 + n2) - 0.5) * 0.5 : 0.5;
    return { n1, n2, w1 };
  }, [ranks, s, wkPlayed, away, home, stat]);

  // ---- recent + h2h ----
  const recent = (team: string) =>
    twIdx
      .rowsFor(team, s)
      .filter((r) => Number(r.week) <= w)
      .slice(-3)
      .map((r) => ({
        week: Number(r.week),
        opp: opponentLabel(String(r.game_id ?? ""), team),
        wl: Number(r.win) === 1 ? "W" : "L",
        pts: r.points == null ? "" : String(Math.round(Number(r.points))),
        yds: r.total_yards == null ? "" : String(Math.round(Number(r.total_yards))),
      }));

  const h2h = useMemo(() => {
    if (!selGame) return null;
    const df = schedule
      .filter(
        (g) =>
          (String(g.home_team) === away && String(g.away_team) === home) ||
          (String(g.home_team) === home && String(g.away_team) === away),
      )
      .map((g) => {
        const winner =
          g.home_score == null || g.away_score == null
            ? null
            : Number(g.home_score) > Number(g.away_score)
              ? String(g.home_team)
              : Number(g.home_score) < Number(g.away_score)
                ? String(g.away_team)
                : "TIE";
        return { g, winner, date: g.gameday ? String(g.gameday) : "" };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    const winsA = df.filter((r) => r.winner === away).length;
    const winsB = df.filter((r) => r.winner === home).length;
    const ties = df.filter((r) => r.winner === "TIE").length;
    const dates = df.map((r) => r.date).filter(Boolean).sort();
    return { rows: df.slice(0, 10), winsA, winsB, ties, first: dates[0] ?? "--", last: dates[dates.length - 1] ?? "--" };
  }, [schedule, selGame, away, home]);

  if (!selGame || !meta.size) return <div className="py-8 text-center text-sm text-slate-400">No games.</div>;

  const spread = selGame.spread_line == null ? null : Number(selGame.spread_line);
  const fav = favoriteSide(spread);
  const totalLine = selGame.total_line == null ? "—" : Number(selGame.total_line).toFixed(1);
  const mlAway = selGame.away_moneyline == null ? null : Number(selGame.away_moneyline);
  const mlHome = selGame.home_moneyline == null ? null : Number(selGame.home_moneyline);
  const { awayFair, homeFair, overround } = fairProbs(mlAway, mlHome);
  const dateTxt = selGame.gameday
    ? new Date(`${selGame.gameday}T${selGame.gametime ?? "12:00"}`).toLocaleString("en-US", { weekday: "short", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" })
    : "—";

  const gradeBox = (team: string) => {
    const [ovr, off, def] = gradesIdx.triple(team, s, w);
    return (
      <div className="relative mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-xs font-semibold">Grades</div>
        <div className="flex gap-2">
          {[["Ovr", ovr], ["Off", off], ["Def", def]].map(([l, v]) => (
            <div key={String(l)} className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-center">
              <div className="text-[0.7rem] text-slate-500">{l}</div>
              <div className="text-lg font-bold">{v ?? "--"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `Week ${x}` }))} />
        <Select label="Game" value={String(selGame.game_id)} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team}` }))} />
      </div>

      {/* headers + snapshot */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {[away, home].map((t, i) => (
          <div key={t} className={`flex-1 ${i === 1 ? "lg:order-3" : ""}`}>
            <div className="text-center">
              {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="mx-auto h-16" />}
              <div className="mt-1 font-bold">{recordOf(t)}</div>
            </div>
            {gradeBox(t)}
          </div>
        ))}
        <div className="flex-[1.2] lg:order-2">
          <h3 className="mb-1.5 text-center text-sm font-semibold">Matchup Snapshot</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Favorite (spread)", fav ? `${fav === "home" ? home : away} ${spread! > 0 ? "+" : "−"}${Math.abs(spread!).toFixed(1)}` : "—"],
              ["Kickoff", dateTxt],
              ["Points line (Total)", totalLine],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-2xl border border-slate-200 bg-white px-2 py-1.5 text-center shadow-sm">
                <div className="text-[0.7rem] text-slate-500">{l}</div>
                <div className="text-sm font-bold">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
            {[
              [`${away} ML`, fmtMl(mlAway), `Implied: ${pct1(impliedProb(mlAway))} | Fair: ${pct1(awayFair)}`],
              ["Market Overround", overround == null ? "—" : `${(100 * overround).toFixed(1)}%`, "(vig)"],
              [`${home} ML`, fmtMl(mlHome), `Implied: ${pct1(impliedProb(mlHome))} | Fair: ${pct1(homeFair)}`],
            ].map(([t, big, sub]) => (
              <div key={String(t)} className="rounded-lg border border-slate-200 p-2 text-center">
                <div className="text-[0.75rem] text-slate-500">{t}</div>
                <div className="text-lg font-bold">{big}</div>
                <div className="text-[0.7rem] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spread Pick Engine */}
      {engine && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
          <div className="mb-1 text-sm font-bold">Spread Pick Engine</div>
          <div className="mb-2 text-sm">
            {engine.pHome == null ? (
              "Pick Engine: insufficient data (no spread bucket or grades)."
            ) : (
              <>
                <b>Pick: {engine.pickTeam ?? "—"}</b>
                {" · "}Home win prob {Math.round(100 * engine.pHome)}% vs Away {100 - Math.round(100 * engine.pHome)}%{" · "}
                Confidence {engine.conf}%
                {engine.spread != null && ` · Spread ${engine.spread > 0 ? "+" : ""}${engine.spread.toFixed(1)} (${engine.fav === "home" ? "Home" : "Away"} favored)`}
              </>
            )}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row">
            <div ref={gaugeLeftRef} className="h-44 flex-1" />
            <div className="flex-1">
              <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
                {engine.fav && (
                  <>
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-white">{engine.fav === "home" ? "Favorite home" : "Favorite away"}</span>
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-white">{engine.fav === "home" ? "Underdog away" : "Underdog home"}</span>
                  </>
                )}
                {engine.bucket && <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-white">Bucket: {engine.bucket}</span>}
                <span className={`rounded-full px-2 py-0.5 text-white ${engine.nBucket >= MIN_N_BUCKET ? "bg-green-600" : "bg-slate-500"}`}>N={engine.nBucket.toLocaleString()} hist</span>
                {engine.lOvr != null && engine.rOvr != null && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-white">Grades Δ (away-home) = {engine.lOvr - engine.rOvr >= 0 ? "+" : ""}{engine.lOvr - engine.rOvr}</span>
                )}
              </div>
              {engine.risks.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-red-800">
                  {engine.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {engine.bucket && (
                <table className="mt-2 w-full border text-xs">
                  <thead className="bg-slate-50">
                    <tr>{["Fav side", "Hist N", "Fav win %", "Note"].map((h) => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {engine.bucketRows.map((r) => (
                      <tr key={r.side}>
                        <td className="border px-2 py-1">{r.side}</td>
                        <td className="border px-2 py-1">{r.n ?? "—"}</td>
                        <td className="border px-2 py-1">{r.p == null ? "—" : `${(100 * r.p).toFixed(1)}%`}</td>
                        <td className="border px-2 py-1">{r.side === "home" ? "Fav is home" : "Fav is away"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div ref={gaugeRightRef} className="h-44 flex-1" />
          </div>
        </div>
      )}

      {/* Trend Edge Predictor */}
      {trendEdge && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
          <div className="mb-1 text-sm font-bold">Trend Edge Predictor</div>
          <div className="mb-1 text-sm">
            <b>Trend Pick: {trendEdge.pick}</b>
            {" · "}Away prob {Math.round(100 * trendEdge.pAway)}% vs Home {Math.round(100 * trendEdge.pHome)}%{" · "}
            Confidence {Math.round(100 * Math.max(trendEdge.pAway, trendEdge.pHome))}%
          </div>
          <div ref={edgeRef} className="h-72" />
        </div>
      )}

      {/* Trends + rank bar */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex-1">
          <h4 className="mb-1 text-sm font-semibold">Left Team Trend ({away})</h4>
          <Select
            label=""
            value={stat}
            onChange={setStat}
            options={["points_margin", "epa_diff", "turnover_margin", "points", "total_yards", "passing_yards", "rushing_yards", "turnovers"].map((v) => ({
              value: v,
              label: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            }))}
          />
          <div ref={leftTrendRef} className="mt-2 h-44" />
        </div>
        <div className="w-full lg:w-56">
          <h4 className="mb-1 text-sm font-semibold">Rank Bar (selected stat)</h4>
          {rankBar ? (
            <div className="mt-8 flex h-8 overflow-hidden rounded">
              <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${rankBar.w1 * 100}%`, background: meta.get(away)?.color ?? "#d62728" }}>{Math.round(rankBar.n1)}</div>
              <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${(1 - rankBar.w1) * 100}%`, background: meta.get(home)?.color ?? "#1f77b4" }}>{Math.round(rankBar.n2)}</div>
            </div>
          ) : (
            <div className="mt-8 text-center text-sm text-slate-400">N/A</div>
          )}
        </div>
        <div className="flex-1">
          <h4 className="mb-1 text-sm font-semibold">Right Team Trend ({home})</h4>
          <div ref={rightTrendRef} className="mt-9 h-44" />
        </div>
      </div>

      {/* Recent + H2H */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex-1">
          <h4 className="mb-2 text-sm font-semibold">Recent Form (Last 3 Games)</h4>
          {[away, home].map((t) => (
            <table key={t} className="mb-3 w-full border text-xs">
              <thead className="bg-slate-50">
                <tr>{["Wk", "Opp", "W/L", "Pts", "Yds"].map((h) => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {recent(t).map((r) => (
                  <tr key={`${t}${r.week}`}>
                    <td className="border px-2 py-1">{r.week}</td>
                    <td className="border px-2 py-1">{r.opp}</td>
                    <td className="border px-2 py-1">{r.wl}</td>
                    <td className="border px-2 py-1">{r.pts}</td>
                    <td className="border px-2 py-1">{r.yds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div className="flex-[1.2]">
          <h4 className="mb-2 text-sm font-semibold">All-Time Matchup</h4>
          {h2h && (
            <>
              <div className="mb-2 text-xs text-slate-700">
                <div className="font-bold">{away} vs {home}</div>
                <div>All-time: {away} {h2h.winsA} – {h2h.winsB} {home}{h2h.ties ? ` (Ties: ${h2h.ties})` : ""}</div>
                <div>First meeting: {h2h.first} | Most recent: {h2h.last}</div>
              </div>
              <table className="w-full border text-xs">
                <thead className="bg-slate-50">
                  <tr>{["Season", "Week", "Date", "Away", "Home", "Winner"].map((h) => <th key={h} className="border px-2 py-1 text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {h2h.rows.map(({ g, winner, date }) => (
                    <tr key={String(g.game_id)}>
                      <td className="border px-2 py-1">{String(g.season)}</td>
                      <td className="border px-2 py-1">{String(g.week)}</td>
                      <td className="border px-2 py-1">{date}</td>
                      <td className="border px-2 py-1">{String(g.away_team)} {g.away_score == null ? "" : Math.round(Number(g.away_score))}</td>
                      <td className="border px-2 py-1">{String(g.home_team)} {g.home_score == null ? "" : Math.round(Number(g.home_score))}</td>
                      <td className="border px-2 py-1">{winner ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
