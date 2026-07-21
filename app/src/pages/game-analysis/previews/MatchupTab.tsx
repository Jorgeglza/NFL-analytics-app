// Port of matchup_previews_tab.py — single-game deep dive: snapshot, moneyline,
// spread pick engine, trend edge predictor, trends, recent form, H2H.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsOption } from "echarts";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { Select } from "../../../components/filters/Select";
import { FilterGroup } from "../../../components/ui";
import { pythWinPct } from "../../../lib/logic/pythagorean";
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
  probBundle,
  MODEL_KEYS,
  MODEL_COLORS,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
  type EloIndex,
} from "./engine";

const fmtMl = (ml: number | null) => (ml == null ? "—" : ml > 0 ? `+${Math.round(ml)}` : String(Math.round(ml)));
const pct1 = (p: number | null) => (p == null ? "—" : `${(100 * p).toFixed(1)}%`);

/** Horizontal probability bar (home-side share by convention) with a 50% tick. */
function ProbBar({ label, p, color, note }: { label: string; p: number | null; color: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-32 shrink-0 truncate text-slate-500" title={label}>{label}</span>
      <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-1/2 z-10 w-px bg-slate-300" />
        {p != null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, 100 * p))}%`, background: color, opacity: 0.85 }} />}
      </div>
      <span className="w-10 shrink-0 text-right font-bold tabular-nums">{p == null ? "—" : `${Math.round(100 * p)}%`}</span>
      {note != null && <span className="w-20 shrink-0 truncate text-slate-400" title={note}>{note}</span>}
    </div>
  );
}

/** One model's breakdown card: pick header + how-it-got-there visual. */
function ModelBlock({
  color,
  title,
  pick,
  prob,
  children,
}: {
  color: string;
  title: string;
  pick: string | null;
  prob: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" style={{ borderTop: `3px solid ${color}` }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {title}
        </div>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: pick ? color : "#cbd5e1" }}>
          {pick ?? "—"}{prob != null && ` · ${Math.round(100 * prob)}%`}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export default function MatchupTab({
  schedule,
  ranks,
  meta,
  hist,
  gradesIdx,
  twIdx,
  eloIdx,
}: {
  schedule: Row[];
  ranks: Map<number, Row[]>; // season -> rank rows
  meta: Map<string, TeamMeta>;
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
  eloIdx: EloIndex;
}) {
  const [searchParams] = useSearchParams();
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const [season, setSeason] = useState(searchParams.get("season") ?? "");
  const sel = season || String(seasons[0] ?? "");
  const s = Number(sel);
  const weeks = useMemo(
    () => [...new Set(reg.filter((r) => Number(r.season) === s).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [reg, s],
  );
  const [week, setWeek] = useState(searchParams.get("week") ?? "");
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
  const [gameId, setGameId] = useState(searchParams.get("game") ?? "");
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
    // grades through week-1 only — using week w leaked the game's own grade
    // into "predictions" for completed games (fixed Session 5)
    const [lOvr] = gradesIdx.triple(away, s, wkPlayed);
    const [rOvr] = gradesIdx.triple(home, s, wkPlayed);
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

  // ---- all-model bundle for the verdict strip ----
  const bundle = useMemo(
    () => (selGame ? probBundle(selGame, s, w, hist, gradesIdx, twIdx, eloIdx) : null),
    [selGame, s, w, hist, gradesIdx, twIdx, eloIdx],
  );

  // ---- key stats for the decision card (season-to-date thru week-1) ----
  const keyStats = useMemo(() => {
    if (!selGame) return null;
    const avgOf = (team: string, col: string): number | null => {
      const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r[col] != null);
      if (!rows.length) return null;
      return rows.reduce((sm, r) => sm + Number(r[col]), 0) / rows.length;
    };
    const rankRows = ranks.get(s) ?? [];
    const rankOf = (team: string, col: string): number | null => {
      const v = rankRows.find((r) => String(r.team) === team && Number(r.week) === wkPlayed)?.[`${col}_rank`];
      return v == null ? null : Math.round(Number(v));
    };
    const defs: [string, string, boolean][] = [
      // [label, column, higherIsBetter]
      ["Points/gm", "points", true],
      ["Points allowed/gm", "points_allowed", false],
      ["Total yards/gm", "total_yards", true],
      ["Yards allowed/gm", "total_yards_allowed", false],
      ["EPA diff/gm", "epa_diff", true],
      ["Turnover margin/gm", "turnover_margin", true],
    ];
    const rows = defs.map(([label, col, hib]) => {
      const a = avgOf(away, col);
      const h = avgOf(home, col);
      const better: "away" | "home" | null =
        a == null || h == null || a === h ? null : (hib ? a > h : a < h) ? "away" : "home";
      return { label, a, h, ra: rankOf(away, col), rh: rankOf(home, col), better };
    });
    // model inputs: elo ratings + pythagorean expectation
    const eloE = eloIdx.get(String(selGame.game_id));
    const pythExp = (team: string): number | null => {
      const tw = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r.points != null && r.points_allowed != null);
      if (!tw.length) return null;
      return pythWinPct(tw.reduce((sm, r) => sm + Number(r.points), 0), tw.reduce((sm, r) => sm + Number(r.points_allowed), 0));
    };
    return { rows, eloAway: eloE?.eloAway ?? null, eloHome: eloE?.eloHome ?? null, pythAway: pythExp(away), pythHome: pythExp(home) };
  }, [selGame, twIdx, ranks, eloIdx, away, home, s, wkPlayed]);

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

  // model-breakdown helpers
  const pickOf = (pair: [number | null, number | null]): string | null =>
    pair[0] != null && pair[1] != null ? (pair[0] >= pair[1] ? away : home) : null;
  const probOf = (pair: [number | null, number | null]): number | null =>
    pair[0] != null && pair[1] != null ? Math.max(pair[0], pair[1]) : null;
  const mktHome: number | null = (() => {
    if (!engine || engine.fav == null) return null;
    const r = engine.bucketRows.find((b) => b.side === engine.fav);
    if (r?.p == null) return null;
    return engine.fav === "home" ? r.p : 1 - r.p;
  })();
  const gradeHome: number | null = (() => {
    if (!engine || engine.lOvr == null || engine.rOvr == null) return null;
    const pA = gradeModelProb(engine.lOvr, engine.rOvr);
    return pA == null ? null : 1 - pA;
  })();

  const gradeBox = (team: string) => {
    const [ovr, off, def] = gradesIdx.triple(team, s, wkPlayed);
    return (
      <div className="relative mt-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-3">
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-xs font-semibold" title={`Season-average model grades through week ${wkPlayed} (pre-game information only)`}>Grades (thru W{wkPlayed})</div>
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
      <FilterGroup label="Game — what to analyze">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `Week ${x}` }))} />
        <Select label="Game" value={String(selGame.game_id)} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team}` }))} />
      </FilterGroup>

      {/* Model verdict — every model's call for this game, conclusion first */}
      {bundle && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ borderTop: "4px solid #002f6c" }}>
          <div className="flex flex-wrap items-stretch gap-2 p-3">
            {MODEL_KEYS.map(([k, lbl]) => {
              const [pA, pH] = bundle[k];
              const hasP = pA != null && pH != null;
              const pickT = hasP ? (pA! >= pH! ? away : home) : null;
              const conf = hasP ? Math.max(pA!, pH!) : null;
              const isCons = k === "consensus";
              return (
                <div
                  key={k}
                  className={`min-w-32 flex-1 rounded-xl border px-2.5 py-2 text-center ${isCons ? "border-[#002f6c] bg-[#002f6c]/5" : "border-slate-200"}`}
                  title={hasP ? `${lbl}: ${away} ${Math.round(100 * pA!)}% | ${home} ${Math.round(100 * pH!)}%` : `${lbl}: not available for this game`}
                >
                  <div className="flex items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[k] }} />
                    {lbl}
                  </div>
                  <div className={`text-base font-bold ${isCons ? "text-[#002f6c]" : "text-slate-800"}`}>{pickT ?? "—"}</div>
                  <div className="text-[11px] text-slate-500">{conf == null ? "" : `${Math.round(100 * conf)}%`}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              // favorite is always laying points — show it as −X.X regardless of side
              ["Favorite (spread)", fav ? `${fav === "home" ? home : away} −${Math.abs(spread!).toFixed(1)}` : "—"],
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

      {/* Key stats — what actually feeds the models, side by side */}
      {keyStats && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <div className="text-sm font-bold">Key stats — season to date (thru W{wkPlayed})</div>
            <div className="text-[11px] text-slate-400">Bold = better side · #N = league rank (direction-adjusted, #1 best)</div>
          </div>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {keyStats.rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-sm">
                <span className={`w-20 text-right tabular-nums ${r.better === "away" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                  {r.a == null ? "—" : r.a.toFixed(1)}
                  {r.ra != null && <span className="ml-1 text-[10px] font-semibold text-slate-400">#{r.ra}</span>}
                </span>
                <span className="flex-1 text-center text-xs font-medium text-slate-500">{r.label}</span>
                <span className={`w-20 tabular-nums ${r.better === "home" ? "font-bold text-slate-900" : "text-slate-500"}`}>
                  {r.rh != null && <span className="mr-1 text-[10px] font-semibold text-slate-400">#{r.rh}</span>}
                  {r.h == null ? "—" : r.h.toFixed(1)}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-sm" title="Pre-game Elo power rating (1505 = league average). Feeds the Elo model.">
              <span className={`w-20 text-right tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloAway > keyStats.eloHome ? "font-bold" : "text-slate-500"}`}>
                {keyStats.eloAway == null ? "—" : Math.round(keyStats.eloAway)}
              </span>
              <span className="flex-1 text-center text-xs font-medium text-slate-500">Elo rating</span>
              <span className={`w-20 tabular-nums ${keyStats.eloAway != null && keyStats.eloHome != null && keyStats.eloHome > keyStats.eloAway ? "font-bold" : "text-slate-500"}`}>
                {keyStats.eloHome == null ? "—" : Math.round(keyStats.eloHome)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm" title="Pythagorean expected win% from points scored/allowed. Feeds the Pythagorean model.">
              <span className={`w-20 text-right tabular-nums ${keyStats.pythAway != null && keyStats.pythHome != null && keyStats.pythAway > keyStats.pythHome ? "font-bold" : "text-slate-500"}`}>
                {keyStats.pythAway == null ? "—" : `${Math.round(100 * keyStats.pythAway)}%`}
              </span>
              <span className="flex-1 text-center text-xs font-medium text-slate-500">Pyth. expected win%</span>
              <span className={`w-20 tabular-nums ${keyStats.pythAway != null && keyStats.pythHome != null && keyStats.pythHome > keyStats.pythAway ? "font-bold" : "text-slate-500"}`}>
                {keyStats.pythHome == null ? "—" : `${Math.round(100 * keyStats.pythHome)}%`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Model breakdown — each model's call and HOW it got there */}
      {bundle && engine && trendEdge && keyStats && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <div className="text-sm font-bold text-slate-800">Model breakdown</div>
            <div className="text-[11px] text-slate-400">Bars show the home-side ({home}) probability · tick = 50% · each card explains its own inputs</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <ModelBlock color={MODEL_COLORS.blend} title="Market-calibrated" pick={pickOf(bundle.blend)} prob={probOf(bundle.blend)}>
              <ProbBar label={`Bucket history (${engine.bucket ?? "—"})`} p={mktHome} color={MODEL_COLORS.blend} note={`N=${engine.nBucket.toLocaleString()}`} />
              <ProbBar label={`Grade model (${engine.lOvr ?? "—"} vs ${engine.rOvr ?? "—"})`} p={gradeHome} color={MODEL_COLORS.blend} note="60/40 blend →" />
              <ProbBar label="Blended result" p={bundle.blend[1]} color={MODEL_COLORS.blend} />
              {(engine.nBucket < MIN_N_BUCKET || engine.risks.length > 0) && (
                <div className="text-[10px] text-amber-700">{engine.risks.join(" ") || `Low-N bucket (N=${engine.nBucket}).`}</div>
              )}
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.trend} title="Trend Edge" pick={pickOf(bundle.trend)} prob={probOf(bundle.trend)}>
              <div ref={edgeRef} className="h-40" />
              <div className="text-[10px] text-slate-400">Weighted recent-form differences (away − home): grade, last-3 margin & EPA, momentum, turnovers. Hover the bars.</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.ml} title="ML Fair" pick={pickOf(bundle.ml)} prob={probOf(bundle.ml)}>
              <ProbBar label={`Implied — ${home} ${fmtMl(mlHome)}`} p={impliedProb(mlHome)} color={MODEL_COLORS.ml} note={`${away} ${fmtMl(mlAway)}`} />
              <ProbBar label="Fair (vig removed)" p={homeFair} color={MODEL_COLORS.ml} note={overround == null ? "" : `vig ${(100 * overround).toFixed(1)}%`} />
              <div className="text-[10px] text-slate-400">The bookmaker's own probability once its margin is stripped out.</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.elo} title="Elo" pick={pickOf(bundle.elo)} prob={probOf(bundle.elo)}>
              {([[away, keyStats.eloAway], [home, keyStats.eloHome]] as const).map(([t, e]) => (
                <div key={t} className="flex items-center gap-2 text-[11px]">
                  <span className="w-32 shrink-0 text-slate-500">{t} rating</span>
                  <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    {e != null && <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, ((e - 1200) / 600) * 100))}%`, background: MODEL_COLORS.elo, opacity: t === home ? 0.85 : 0.55 }} />}
                  </div>
                  <span className="w-10 shrink-0 text-right font-bold tabular-nums">{e == null ? "—" : Math.round(e)}</span>
                  <span className="w-20 shrink-0 text-slate-400">{t === home ? "+48 home" : ""}</span>
                </div>
              ))}
              <ProbBar label="Resulting p(home)" p={bundle.elo[1]} color={MODEL_COLORS.elo} />
              <div className="text-[10px] text-slate-400">Rolling power rating from every result since 2015 (1505 = average).</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.pyth} title="Pythagorean" pick={pickOf(bundle.pyth)} prob={probOf(bundle.pyth)}>
              <ProbBar label={`${away} expected win%`} p={keyStats.pythAway} color={MODEL_COLORS.pyth} />
              <ProbBar label={`${home} expected win%`} p={keyStats.pythHome} color={MODEL_COLORS.pyth} />
              <ProbBar label="log5 head-to-head" p={bundle.pyth[1]} color={MODEL_COLORS.pyth} />
              <div className="text-[10px] text-slate-400">From points scored vs allowed through W{wkPlayed} — scoring margin predicts wins.</div>
            </ModelBlock>

            <ModelBlock color={MODEL_COLORS.consensus} title="Average (consensus)" pick={pickOf(bundle.consensus)} prob={probOf(bundle.consensus)}>
              {(["blend", "trend", "ml", "elo", "pyth"] as const).map((k) => (
                <ProbBar key={k} label={MODEL_KEYS.find(([mk]) => mk === k)?.[1] ?? k} p={bundle[k][1]} color={MODEL_COLORS[k]} />
              ))}
              <div className="text-[10px] text-slate-400">Equal-weight mean of the five models — historically the best calibrated.</div>
            </ModelBlock>
          </div>
        </div>
      )}

      {/* Additional stats — stat comparison + history */}
      <div className="mb-1 mt-2 text-sm font-bold text-slate-800">Additional stats</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700">Stat comparison — weekly values (green dot = win, dashed = season avg)</div>
          <Select
            label=""
            value={stat}
            onChange={setStat}
            options={["points_margin", "epa_diff", "turnover_margin", "points", "total_yards", "passing_yards", "rushing_yards", "turnovers"].map((v) => ({
              value: v,
              label: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            }))}
          />
        </div>
        <div className="flex flex-col items-stretch gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(away)?.color ?? "#888" }} />
              {away}
            </div>
            <div ref={leftTrendRef} className="h-44" />
          </div>
          <div className="flex w-full flex-col justify-center lg:w-52">
            <div className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">League rank — bigger side = better</div>
            {rankBar ? (
              <div className="flex h-7 overflow-hidden rounded-full ring-1 ring-inset ring-black/5">
                <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${rankBar.w1 * 100}%`, background: meta.get(away)?.color ?? "#d62728" }}>#{Math.round(rankBar.n1)}</div>
                <div className="grid place-items-center text-xs font-bold text-white" style={{ width: `${(1 - rankBar.w1) * 100}%`, background: meta.get(home)?.color ?? "#1f77b4" }}>#{Math.round(rankBar.n2)}</div>
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400">N/A</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-end gap-1.5 text-xs font-semibold text-slate-500">
              {home}
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.get(home)?.color ?? "#888" }} />
            </div>
            <div ref={rightTrendRef} className="h-44" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">
            Recent form — last 3 games <span className="font-normal text-slate-400">(@ = away game)</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[away, home].map((t) => (
              <div key={t}>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: meta.get(t)?.color }}>
                  {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="h-5" />}
                  {t}
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <tr>{["Wk", "Opp", "W/L", "Pts", "Yds"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {recent(t).map((r) => (
                      <tr key={`${t}${r.week}`} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 text-slate-500">{r.week}</td>
                        <td className="px-2 py-1.5 font-medium">{r.opp}</td>
                        <td className={`px-2 py-1.5 font-bold ${r.wl === "W" ? "text-[#3C9A5F]" : "text-[#C8102E]"}`}>{r.wl}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.pts}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.yds}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              Head-to-head <span className="font-normal text-slate-400">(since 2015 — dataset start)</span>
            </div>
            {h2h && <div className="text-[11px] text-slate-400">First {h2h.first} · last {h2h.last}</div>}
          </div>
          {h2h && (
            <>
              <div className="mb-3 flex items-center justify-center gap-3">
                {([[away, h2h.winsA], [home, h2h.winsB]] as const).map(([t, wcount], i) => (
                  <div key={t} className={`flex items-center gap-2 ${i === 1 ? "flex-row-reverse" : ""}`}>
                    {meta.get(t)?.logo && <img src={meta.get(t)!.logo} alt={t} className="h-8" />}
                    <span className="text-2xl font-extrabold tabular-nums" style={{ color: meta.get(t)?.color }}>{wcount}</span>
                    {i === 0 && <span className="text-sm font-light text-slate-400">–</span>}
                  </div>
                ))}
                {h2h.ties > 0 && <span className="text-xs text-slate-400">({h2h.ties} ties)</span>}
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>{["Season", "Wk", "Date", "Score", "Winner"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {h2h.rows.map(({ g, winner, date }) => (
                    <tr key={String(g.game_id)} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-500">{String(g.season)}</td>
                      <td className="px-2 py-1.5 text-slate-500">{String(g.week)}</td>
                      <td className="px-2 py-1.5 text-slate-500">{date}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {String(g.away_team)} {g.away_score == null ? "" : Math.round(Number(g.away_score))} @ {String(g.home_team)} {g.home_score == null ? "" : Math.round(Number(g.home_score))}
                      </td>
                      <td className="px-2 py-1.5 font-bold" style={{ color: winner && winner !== "TIE" ? meta.get(winner)?.color : undefined }}>{winner ?? ""}</td>
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
