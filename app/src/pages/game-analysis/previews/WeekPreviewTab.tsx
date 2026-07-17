// Port of week_preview_tab.py — game cards for a week with 4 probability metrics.
import { useMemo, useState } from "react";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { Select } from "../../../components/filters/Select";
import {
  MODEL_KEYS,
  type MetricKey,
  probBundle,
  favoriteSide,
  resultWinner,
  winTypeCode,
  pickBgColor,
  defaultWeekNearToday,
  kickoffMs,
  WIN_TYPE_CODE_COLORS,
  WIN_TYPE_CODE_LONG,
  type HistAgg,
  type GradesIndex,
  type TeamWeekIndex,
} from "./engine";

export default function WeekPreviewTab({
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
  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const [season, setSeason] = useState("");
  const sel = season || String(seasons[0] ?? "");
  const weeks = useMemo(
    () => [...new Set(reg.filter((r) => String(r.season) === sel).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [reg, sel],
  );
  const [week, setWeek] = useState("");
  const defWeek = useMemo(() => defaultWeekNearToday(reg, Number(sel)) ?? weeks[weeks.length - 1], [reg, sel, weeks]);
  const selWeek = weeks.map(String).includes(week) ? week : String(defWeek ?? "");
  const [primary, setPrimary] = useState<MetricKey>("consensus");
  const [sortMode, setSortMode] = useState<"time" | "confidence">("time");

  const cards = useMemo(() => {
    const games = reg
      .filter((r) => String(r.season) === sel && String(r.week) === selWeek)
      .sort((a, b) => kickoffMs(a) - kickoffMs(b) || String(a.game_id).localeCompare(String(b.game_id)));
    const s = Number(sel);
    const w = Number(selWeek);
    const rows = games.map((g) => {
      const bundle = probBundle(g, s, w, hist, gradesIdx, twIdx);
      const [pL, pR] = bundle[primary];
      const conf = pL != null && pR != null ? Math.max(pL, pR) : -1;
      const leadSide = pL != null && pR != null ? (pL >= pR ? "away" : "home") : null;
      return { g, bundle, conf, leadSide };
    });
    if (sortMode === "confidence") rows.sort((a, b) => b.conf - a.conf || kickoffMs(a.g) - kickoffMs(b.g));
    return rows;
  }, [reg, sel, selWeek, primary, sortMode, hist, gradesIdx, twIdx]);

  const { correct, missed, winCounts } = useMemo(() => {
    let correct = 0;
    let missed = 0;
    const winCounts: Record<string, number> = { FH: 0, FA: 0, UH: 0, UA: 0 };
    for (const r of cards) {
      const actual = resultWinner(r.g);
      if (actual && r.leadSide) (actual === r.leadSide ? correct++ : missed++);
      const code = winTypeCode(favoriteSide(r.g.spread_line == null ? null : Number(r.g.spread_line)), r.leadSide);
      if (code && code in winCounts) winCounts[code]++;
    }
    return { correct, missed, winCounts };
  }, [cards]);

  const total = Object.values(winCounts).reduce((a, b) => a + b, 0);
  const accTotal = correct + missed;
  const primaryLabel = MODEL_KEYS.find(([k]) => k === primary)?.[1] ?? "";

  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(100 * v)}%`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
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
          Sort
          <div className="flex gap-2">
            {(["time", "confidence"] as const).map((m) => (
              <button key={m} onClick={() => setSortMode(m)} className={`rounded-full px-3 py-1.5 text-sm normal-case tracking-normal ${sortMode === m ? "bg-[#002f6c] text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:text-slate-900"}`}>
                {m === "time" ? "Time" : "Highest prob"}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="min-w-40 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm" style={{ borderTop: "3px solid #2CA25F" }} title="Accuracy (completed games only)">
            <div className="text-[10px] text-slate-500">Accuracy</div>
            <div className="text-sm">
              <span className="mr-2 font-bold">✓ {correct}</span>
              <span className="mr-2 font-bold">✗ {missed}</span>
              <span>{accTotal ? Math.round((100 * correct) / accTotal) : 0}%</span>
            </div>
          </div>
          {(["FH", "UA", "FA", "UH"] as const).map((code) => (
            <div key={code} className="min-w-28 rounded-2xl border bg-white px-2.5 py-1.5 shadow-sm" style={{ borderColor: `${WIN_TYPE_CODE_COLORS[code]}55`, borderTop: `3px solid ${WIN_TYPE_CODE_COLORS[code]}`, color: WIN_TYPE_CODE_COLORS[code] }} title={WIN_TYPE_CODE_LONG[code]}>
              <div className="truncate text-[10px]">{WIN_TYPE_CODE_LONG[code]}</div>
              <div className="text-base font-bold leading-none">{winCounts[code]}</div>
              <div className="text-[10px]">{total ? Math.round((100 * winCounts[code]) / total) : 0}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {cards.map(({ g, bundle, leadSide }) => {
          const away = String(g.away_team);
          const home = String(g.home_team);
          const [pL, pR] = bundle[primary];
          const lead = leadSide === "away" ? away : leadSide === "home" ? home : null;
          const conf01 = pL != null && pR != null ? Math.max(0, Math.min(1, 2 * Math.max(pL, pR) - 1)) : 0;
          const actual = resultWinner(g);
          const isCorrect = leadSide != null && actual === leadSide;
          const code = winTypeCode(favoriteSide(g.spread_line == null ? null : Number(g.spread_line)), leadSide);
          const borderCol = lead === away ? meta.get(away)?.color : lead === home ? meta.get(home)?.color : "#ddd";
          const dateStr = g.gameday
            ? new Date(`${g.gameday}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" })
            : "";
          return (
            <div key={String(g.game_id)} className="relative rounded-2xl bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md" style={{ border: `2px solid ${borderCol ?? "#ddd"}` }}>
              {code && (
                <div className="absolute right-7 top-1.5 rounded border px-1.5 py-0.5 text-xs font-extrabold" style={{ borderColor: WIN_TYPE_CODE_COLORS[code], color: WIN_TYPE_CODE_COLORS[code], background: `${WIN_TYPE_CODE_COLORS[code]}0d` }} title={WIN_TYPE_CODE_LONG[code]}>
                  {code}
                </div>
              )}
              <div className="mb-1.5">
                <div className="text-sm font-bold">{dateStr}</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{away} @ {home}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-center">
                  {meta.get(away)?.logo ? <img src={meta.get(away)!.logo} alt={away} className="mx-auto h-11" /> : <div className="font-bold">{away}</div>}
                  <div className="mt-1 font-bold">{pct(pL)}</div>
                </div>
                <div className="flex h-4 flex-[2] overflow-hidden rounded-full border border-slate-100">
                  <div style={{ width: `${pL != null ? Math.round(100 * pL) : 0}%`, background: meta.get(away)?.color ?? "#888" }} />
                  <div style={{ width: `${pR != null ? Math.round(100 * pR) : 0}%`, background: meta.get(home)?.color ?? "#888" }} />
                </div>
                <div className="flex-1 text-center">
                  {meta.get(home)?.logo ? <img src={meta.get(home)!.logo} alt={home} className="mx-auto h-11" /> : <div className="font-bold">{home}</div>}
                  <div className="mt-1 font-bold">{pct(pR)}</div>
                </div>
              </div>
              <div className="relative mt-2 inline-block pr-3">
                <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold text-slate-900" style={{ background: lead ? pickBgColor(conf01) : "#eee" }}>
                  Pick: {lead ?? "—"} ({primaryLabel})
                </span>
                {isCorrect && (
                  <span className="absolute -right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-[#2CA25F] text-[10px] font-black text-white" title="Correct pick">
                    ✓
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MODEL_KEYS.map(([k, lbl]) => (
                  <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                    {lbl}: {away} {pct(bundle[k][0])} | {home} {pct(bundle[k][1])}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {!cards.length && <div className="py-8 text-center text-sm text-slate-400">No games found for this week.</div>}
      </div>
    </div>
  );
}
