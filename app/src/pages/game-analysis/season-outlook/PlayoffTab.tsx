import { useEffect, useState } from "react";
import type { Row } from "../../../lib/data/loader";
import type { TeamMeta } from "../../../lib/team/meta";
import { simulatePlayoffs, type PlayoffSimResult, type TeamConfDiv } from "../../../lib/logic/playoffSim";
import { Loading } from "../../../components/Loading";
import { tableWrapCls, theadCls, trCls } from "../../../components/ui";

const ITERATIONS = 2000;

export default function PlayoffTab({ schedule, season, week, meta }: { schedule: Row[]; season: string; week: string; meta: Map<string, TeamMeta> }) {
  const [results, setResults] = useState<PlayoffSimResult[] | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    if (!season || !week || !meta.size) return;
    setComputing(true);
    setResults(null);
    // Defer to the next tick so the "computing" spinner actually paints
    // before the synchronous Monte Carlo loop runs (2000 iterations, fast
    // but not free — see docs/IMPLEMENTATION_LOG.md perf note).
    const id = setTimeout(() => {
      const teamMeta = new Map<string, TeamConfDiv>();
      for (const [abbr, m] of meta) if (m.conference && m.division) teamMeta.set(abbr, { conference: m.conference, division: m.division });
      setResults(simulatePlayoffs(schedule, Number(season), teamMeta, ITERATIONS, Number(week)));
      setComputing(false);
    }, 0);
    return () => clearTimeout(id);
  }, [schedule, season, week, meta]);

  if (computing || !results) return <Loading label={`Simulating ${ITERATIONS.toLocaleString()} seasons…`} />;

  const byConf = new Map<string, PlayoffSimResult[]>();
  for (const r of results) {
    if (!byConf.has(r.conference)) byConf.set(r.conference, []);
    byConf.get(r.conference)!.push(r);
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        {ITERATIONS.toLocaleString()} simulated seasons as of week {week} — standings lock in every result through week {week}, then each remaining
        game's winner is drawn from the two teams' Elo rating as of week {week} (frozen for the simulation). Standings ties use a simplified
        tiebreaker (head-to-head, then conference record, then point differential through week {week}) — not the full NFL rulebook (no strength of
        victory/schedule, no common-games rule).
      </p>

      {[...byConf.entries()].map(([conf, teams]) => (
        <div key={conf} className={tableWrapCls}>
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{conf}</div>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                {["Team", "Division", "Playoff %", "Division title %", "Avg wins", "Avg seed"].map((h) => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...teams]
                .sort((a, b) => b.playoffPct - a.playoffPct)
                .map((r) => (
                  <tr key={r.team} className={trCls}>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      <div className="flex items-center gap-2">
                        {meta.get(r.team)?.logo && <img src={meta.get(r.team)!.logo} alt="" className="h-5 w-5 object-contain" />}
                        {meta.get(r.team)?.name ?? r.team}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.division}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{(r.playoffPct * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600">{(r.divisionTitlePct * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-600">{r.avgWins.toFixed(1)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.avgSeed == null ? "—" : r.avgSeed.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
