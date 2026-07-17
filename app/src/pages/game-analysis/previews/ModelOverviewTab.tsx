// Port of model_overview_tab.py — all-games pick matrices per season/week with
// accuracy KPIs. Records computed client-side from the shared engine.
import { useMemo, useState } from "react";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
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
}: {
  schedule: Row[];
  meta: Map<string, TeamMeta>;
  hist: HistAgg;
  gradesIdx: GradesIndex;
  twIdx: TeamWeekIndex;
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
      const b = probBundle(g, s, w, hist, gradesIdx, twIdx);
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
  }, [schedule, hist, gradesIdx, twIdx]);

  const filtered = useMemo(() => {
    let df = records;
    if (filterMode === "upcoming") df = df.filter((r) => r.actual == null);
    if (filterMode === "completed") df = df.filter((r) => r.actual != null);
    return df.filter((r) => (r.picks[primary].conf ?? 0) >= minConf);
  }, [records, filterMode, primary, minConf]);

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
    return (
      <td className="border p-1.5 text-center align-middle" style={{ minWidth: 60, background: p.correct ? "#DFF5E1" : "#fff", borderColor: p.correct ? "#cfeacd" : "#eee" }} title={title}>
        <div className="flex flex-col items-center">
          {logo ? <img src={logo} alt={p.team ?? ""} className="h-6" /> : <div className="text-xs font-bold">{p.team ?? "—"}</div>}
          <div className="mt-0.5 text-[11px] font-bold">{pctTxt}</div>
        </div>
      </td>
    );
  }

  function Matrix({ title, rows, rowLabel }: { title: string; rows: [number, Rec[]][]; rowLabel: string }) {
    const maxCols = Math.max(0, ...rows.map(([, rs]) => rs.length));
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-1.5 text-base font-extrabold">{title}</div>
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
                    <td className="border px-2 py-1 text-center font-bold" title={`Correct–Wrong: ${corr}-${evald.length - corr}`}>
                      {evald.length ? Math.round((100 * corr) / evald.length) : 0}%
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
      <div className="flex flex-wrap items-end gap-4">
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
          Primary metric
          <div className="flex gap-2">
            {MODEL_KEYS.map(([k, lbl]) => (
              <button key={k} onClick={() => setPrimary(k)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${primary === k ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Order columns by
          <div className="flex gap-2">
            {([["time", "Kickoff time"], ["rank", "Confidence"]] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setOrder(v)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${order === v ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Filters
          <div className="flex gap-2">
            {([["", "All"], ["upcoming", "Upcoming only"], ["completed", "Completed only"]] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setFilterMode(v)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${filterMode === v ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Min confidence: {Math.round(minConf * 100)}%
          <input type="range" min={0.5} max={1} step={0.01} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="w-56" />
        </label>
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
