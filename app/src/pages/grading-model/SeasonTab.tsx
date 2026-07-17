// Port of season_tab.py — season-average grades: 3 ranked bars + off/def scatter.
import { useMemo, useState } from "react";
import type { Row } from "../../lib/data/loader";
import type { TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { useECharts } from "../../components/charts/useECharts";
import { seasonRecords } from "./shared";
import { rankedBarOption, offDefScatterOption, type TeamPoint } from "./charts";

export default function SeasonTab({
  grades,
  schedule,
  meta,
}: {
  grades: Row[];
  schedule: Row[];
  meta: Map<string, TeamMeta>;
}) {
  const seasons = useMemo(
    () => [...new Set(grades.map((r) => Number(r.Season)))].sort((a, b) => b - a),
    [grades],
  );
  const [season, setSeason] = useState("");
  const sel = season || String(seasons[0] ?? "");

  const { teamAvgs, records } = useMemo(() => {
    const bySeason = grades.filter((r) => String(r.Season) === sel);
    const byTeam = new Map<string, Row[]>();
    for (const r of bySeason) {
      const t = String(r.Team);
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(r);
    }
    // mean per team, rounded to 1 decimal like the old groupby().mean().round(1)
    const teamAvgs = [...byTeam.entries()].map(([team, rows]) => {
      const avg = (col: string) =>
        +(rows.reduce((s, r) => s + Number(r[col] ?? 0), 0) / rows.length).toFixed(1);
      return { team, overall: avg("Overall Grade"), off: avg("Offensive Grade"), def: avg("Defensive Grade") };
    });
    return { teamAvgs, records: seasonRecords(schedule, Number(sel)) };
  }, [grades, schedule, sel]);

  const mkPoints = (col: "overall" | "off" | "def"): TeamPoint[] =>
    teamAvgs.map((t) => ({
      team: t.team,
      value: t[col],
      off: t.off,
      def: t.def,
      record: records.get(t.team) ?? "0-0",
    }));

  const overallRef = useECharts(useMemo(() => (teamAvgs.length ? rankedBarOption(mkPoints("overall"), meta) : null), [teamAvgs, meta]));
  const scatterRef = useECharts(useMemo(() => (teamAvgs.length ? offDefScatterOption(mkPoints("overall"), meta) : null), [teamAvgs, meta]));
  const offRef = useECharts(useMemo(() => (teamAvgs.length ? rankedBarOption(mkPoints("off"), meta) : null), [teamAvgs, meta]));
  const defRef = useECharts(useMemo(() => (teamAvgs.length ? rankedBarOption(mkPoints("def"), meta) : null), [teamAvgs, meta]));

  return (
    <div className="space-y-6">
      <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
      {[
        { title: `🏆 Overall Grades – ${sel}`, ref: overallRef, h: "h-[600px]" },
        { title: `📊 Offense vs Defense Grade (Avg per Team) – ${sel}`, ref: scatterRef, h: "h-[700px]" },
        { title: `🚀 Offensive Grades – ${sel}`, ref: offRef, h: "h-[600px]" },
        { title: `🛡️ Defensive Grades – ${sel}`, ref: defRef, h: "h-[600px]" },
      ].map((c) => (
        <div key={c.title} className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{c.title}</h3>
          <div ref={c.ref} className={c.h} />
        </div>
      ))}
    </div>
  );
}
