// Port of model_overview_tab.py — all-games pick matrices per season/week with
// accuracy KPIs. Records computed client-side from the shared engine.
import { useMemo, useState } from "react";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { FilterGroup } from "../../../components/ui";
import {
  MODEL_KEYS,
  type MetricKey,
  probBundle,
  favoriteSide,
  resultWinner,
  kickoffMs,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
  type EloIndex,
} from "./engine";

interface Rec {
  season: number;
  week: number;
  gameId: string;
  kickoff: number;
  away: string;
  home: string;
  spread: number | null;
  favSide: string | null;
  actual: string | null;
  picks: Record<MetricKey, { team: string | null; side: string | null; conf: number | null; correct: boolean | null }>;
}

export default function ModelOverviewTab({
  schedule,
  meta,
  hist,
  gradesIdx,
  twIdx,
  eloIdx,
}: {
  schedule: Row[];
  meta: Map<string, TeamMeta>;
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
  eloIdx: EloIndex;
}) {
  const [grouping, setGrouping] = useState<"season" | "week">("season");
  const [primary, setPrimary] = useState<MetricKey>("consensus");
  const [order, setOrder] = useState<"time" | "rank">("time");
  const [filterMode, setFilterMode] = useState<"" | "upcoming" | "completed">("");
  const [minConf, setMinConf] = useState(0.55);

  const records = useMemo<Rec[]>(() => {
    const reg = schedule.filter((r) => r.game_type === "REG");
    return reg.map((g) => {
      const s = Number(g.season);
      const w = Number(g.week);
      const b = probBundle(g, s, w, hist, gradesIdx, twIdx, eloIdx);
      const actual = resultWinner(g);
      const picks = {} as Rec["picks"];
      for (const [key] of MODEL_KEYS) {
        const [pA, pH] = b[key];
        let side: string | null = null;
        let team: string | null = null;
        let conf: number | null = null;
        if (pA != null && pH != null) {
          side = pA >= pH ? "away" : "home";
          team = side === "away" ? String(g.away_team) : String(g.home_team);
          conf = Math.max(pA, pH);
        }
        picks[key] = { team, side, conf, correct: actual && side ? actual === side : null };
      }
      return {
        season: s,
        week: w,
        gameId: String(g.game_id),
        kickoff: kickoffMs(g),
        away: String(g.away_team),
        home: String(g.home_team),
        spread: g.spread_line == null ? null : Number(g.spread_line),
        favSide: favoriteSide(g.spread_line == null ? null : Number(g.spread_line)),
        actual,
        picks,
      };
    });
  }, [schedule, hist, gradesIdx, twIdx, eloIdx]);

  const filtered = useMemo(() => {
    let df = records;
    if (filterMode === "upcoming") df = df.filter((r) => r.actual == null);
    if (filterMode === "completed") df = df.filter((r) => r.actual != null);
    return df.filter((r) => (r.picks[primary].conf ?? 0) >= minConf);
  }, [records, filterMode, primary, minConf]);

  // Audit 7c: the tab's core question — does accuracy rise with confidence? —
  // answered directly, over ALL completed games (independent of the slider).
  const confBands = useMemo(() => {
    const bands = [
      { label: "50–55%", lo: 0.5, hi: 0.55 },
      { label: "55–60%", lo: 0.55, hi: 0.6 },
      { label: "60–65%", lo: 0.6, hi: 0.65 },
      { label: "65–70%", lo: 0.65, hi: 0.7 },
      { label: "70–80%", lo: 0.7, hi: 0.8 },
      { label: "80%+", lo: 0.8, hi: 1.01 },
    ];
    return bands.map((b) => {
      const rows = records.filter((r) => {
        const p = r.picks[primary];
        return p.correct != null && p.conf != null && p.conf >= b.lo && p.conf < b.hi;
      });
      const corr = rows.filter((r) => r.picks[primary].correct).length;
      return { ...b, n: rows.length, pct: rows.length ? (100 * corr) / rows.length : null };
    });
  }, [records, primary]);

  const kpi = useMemo(() => {
    const evald = filtered.filter((r) => r.picks[primary].correct != null);
    const correct = evald.filter((r) => r.picks[primary].correct).length;
    const confs = filtered.map((r) => r.picks[primary].conf).filter((c): c is number => c != null);
    return {
      total: evald.length,
      correct,
      avgConf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
    };
  }, [filtered, primary]);

  function Cell({ rec }: { rec: Rec | null }) {
    if (!rec) return <td className="border border-slate-100 p-2" />;
    const p = rec.picks[primary];
    const logo = p.team ? meta.get(p.team)?.logo : null;
    const pctTxt = p.conf == null ? "—" : `${Math.round(100 * p.conf)}%`;
    const title = `${rec.away} @ ${rec.home}\nPick: ${p.team ?? "—"} — ${pctTxt}\nSpread: ${rec.spread ?? "—"}\nResult: ${rec.actual ?? "—"} — ${p.correct === true ? "Correct ✓" : p.correct === false ? "Wrong ✗" : "Upcoming"}`;
    // color + glyph carry correctness; the per-cell % lives in the hover title
    // (2,300 tiny numbers were noise — audit 7c)
    const bg = p.correct === true ? "#DFF5E1" : p.correct === false ? "#FBE4E4" : "#fff";
    const bc = p.correct === true ? "#cfeacd" : p.correct === false ? "#f2cccc" : "#eee";
    return (
      <td className="border p-1.5 text-center align-middle" style={{ minWidth: 48, background: bg, borderColor: bc }} title={title}>
        <div className="relative flex flex-col items-center">
          {logo ? <img src={logo} alt={p.team ?? ""} className="h-6" /> : <div className="text-xs font-bold">{p.team ?? "—"}</div>}
          {p.correct === true && <span className="absolute -right-0.5 -top-1 text-[9px] font-black text-[#2CA25F]">✓</span>}
          {p.correct === false && <span className="absolute -right-0.5 -top-1 text-[9px] font-black text-[#C8102E]">✗</span>}
        </div>
      </td>
    );
  }

  function Matrix({ title, rows, rowLabel }: { title: string; rows: [number, Rec[]][]; rowLabel: string }) {
    const maxCols = Math.max(0, ...rows.map(([, rs]) => rs.length));
    const allRecs = rows.flatMap(([, rs]) => rs);
    const evaldAll = allRecs.filter((r) => r.picks[primary].correct != null);
    const corrAll = evaldAll.filter((r) => r.picks[primary].correct).length;
    const pctAll = evaldAll.length ? Math.round((100 * corrAll) / evaldAll.length) : null;
    const badgeColor = pctAll == null ? "#94a3b8" : pctAll >= 60 ? "#2CA25F" : pctAll < 50 ? "#C8102E" : "#B58B00";
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-1.5 flex items-center gap-2.5">
          <div className="text-base font-extrabold">{title}</div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
            style={{ color: badgeColor, background: `${badgeColor}18`, border: `1px solid ${badgeColor}44` }}
            title={`${MODEL_KEYS.find(([k]) => k === primary)?.[1]}: ${corrAll} of ${evaldAll.length} correct across this ${rowLabel.toLowerCase()} grouping`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: badgeColor }} />
            {pctAll == null ? "no results yet" : `${pctAll}% correct`}
            {pctAll != null && <span className="font-medium opacity-70">({corrAll}/{evaldAll.length})</span>}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="border px-2 py-1 text-left">{rowLabel}</th>
                <th className="border px-2 py-1">Correct %</th>
                {Array.from({ length: maxCols }, (_, i) => (
                  <th key={i} className="border px-2 py-1">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, rs]) => {
                const evald = rs.filter((r) => r.picks[primary].correct != null);
                const corr = evald.filter((r) => r.picks[primary].correct).length;
                const sorted = [...rs];
                if (order === "time") sorted.sort((a, b) => a.kickoff - b.kickoff);
                else sorted.sort((a, b) => (b.picks[primary].conf ?? 0) - (a.picks[primary].conf ?? 0));
                return (
                  <tr key={key}>
                    <td className="whitespace-nowrap border px-2 py-1 font-bold">{rowLabel} {key}</td>
                    <td
                      className="border px-2 py-1 text-center font-bold"
                      style={{ color: !evald.length ? "#94a3b8" : corr / evald.length >= 0.5 ? "#2CA25F" : "#C8102E" }}
                      title={`Correct–Wrong: ${corr}-${evald.length - corr} (green = beats a coin flip)`}
                    >
                      {evald.length ? `${Math.round((100 * corr) / evald.length)}%` : "—"}
                    </td>
                    {Array.from({ length: maxCols }, (_, i) => (
                      <Cell key={i} rec={sorted[i] ?? null} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const matrices = useMemo(() => {
    const groups = new Map<number, Map<number, Rec[]>>();
    for (const r of filtered) {
      const outer = grouping === "season" ? r.season : r.week;
      const inner = grouping === "season" ? r.week : r.season;
      if (!groups.has(outer)) groups.set(outer, new Map());
      const m = groups.get(outer)!;
      if (!m.has(inner)) m.set(inner, []);
      m.get(inner)!.push(r);
    }
    const outerKeys = [...groups.keys()].sort((a, b) => (grouping === "season" ? b - a : a - b));
    return outerKeys.map((outer) => {
      const innerSorted: [number, Rec[]][] = [...groups.get(outer)!.entries()].sort((a, b) =>
        grouping === "season" ? a[0] - b[0] : b[0] - a[0],
      );
      return { outer, rows: innerSorted };
    });
  }, [filtered, grouping]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-3">
        <FilterGroup label="Model — which picks are graded">
          <div className="flex flex-wrap gap-2">
            {MODEL_KEYS.map(([k, lbl]) => (
              <button key={k} onClick={() => setPrimary(k)} className={`rounded-full px-3 py-1.5 text-sm ${primary === k ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup label="Games — which are included">
          <div className="flex gap-2">
            {([["", "All"], ["upcoming", "Upcoming only"], ["completed", "Completed only"]] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setFilterMode(v)} className={`rounded-full px-3 py-1.5 text-sm ${filterMode === v ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {lbl}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Min confidence: {Math.round(minConf * 100)}%
            <input type="range" min={0.5} max={1} step={0.01} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="w-48" />
          </label>
        </FilterGroup>
        <FilterGroup label="Layout — how the grid reads">
          <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Group by
            <div className="flex gap-2">
              {(["season", "week"] as const).map((g) => (
                <button key={g} onClick={() => setGrouping(g)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${grouping === g ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                  {g === "season" ? "Season" : "Week #"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Column order
            <div className="flex gap-2">
              {([["time", "Kickoff time"], ["rank", "Confidence"]] as const).map(([v, lbl]) => (
                <button key={v} onClick={() => setOrder(v)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${order === v ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </FilterGroup>
      </div>

      {/* Accuracy by confidence — the tab's core answer */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTop: "4px solid #002f6c" }}>
        <div className="mb-2 text-sm font-semibold text-slate-700">
          Does confidence pay off? — accuracy by confidence band ({MODEL_KEYS.find(([k]) => k === primary)?.[1]}, all completed games)
        </div>
        <div className="flex flex-wrap gap-3">
          {confBands.map((b) => (
            <div key={b.label} className="min-w-28 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-center" title={`${b.n.toLocaleString()} completed games with pick confidence in ${b.label}`}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{b.label}</div>
              <div className={`text-xl font-bold tabular-nums ${b.pct == null ? "text-slate-300" : b.pct >= 60 ? "text-[#2CA25F]" : b.pct < 50 ? "text-[#C8102E]" : "text-slate-800"}`}>
                {b.pct == null ? "—" : `${Math.round(b.pct)}%`}
              </div>
              <div className="mx-auto mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${b.pct ?? 0}%`, background: b.pct != null && b.pct >= 50 ? "#2CA25F" : "#C8102E" }} />
              </div>
              <div className="mt-1 text-[10px] text-slate-400">{b.n.toLocaleString()} games</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">If the model is well-calibrated, accuracy should rise from left to right and each band should at least match its own confidence range.</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["Accuracy", `✓ ${kpi.correct} / ✗ ${Math.max(0, kpi.total - kpi.correct)} | ${kpi.total ? Math.round((100 * kpi.correct) / kpi.total) : 0}%`, "#2CA25F"],
          ["Games shown", String(filtered.length), "#2459A7"],
          ["Avg confidence", `${Math.round(100 * kpi.avgConf)}%`, "#C8102E"],
        ].map(([t, v, c]) => (
          <div key={t} className="min-w-36 rounded-2xl border border-slate-200 bg-white px-3 py-2" style={{ borderTop: `3px solid ${c}` }}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t}</div>
            <div className="text-lg font-extrabold">{v}</div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {matrices.map(({ outer, rows }) => (
          <Matrix
            key={outer}
            title={grouping === "season" ? `Season ${outer}` : `Week ${outer}`}
            rows={rows}
            rowLabel={grouping === "season" ? "Week" : "Season"}
          />
        ))}
        {!matrices.length && <div className="py-8 text-center text-sm text-slate-400">No games meet the filters.</div>}
      </div>
    </div>
  );
}
