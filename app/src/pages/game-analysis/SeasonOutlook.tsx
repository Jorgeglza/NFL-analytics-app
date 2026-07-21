// Season Outlook — new analytics (not a port). What's ahead: strength of the
// remaining schedule, and playoff probability from a Monte Carlo simulation.
import { useEffect, useState } from "react";
import { getSchedule, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { PageHeader } from "../../components/ui";
import SosTab from "./season-outlook/SosTab";
import PlayoffTab from "./season-outlook/PlayoffTab";

const TABS = [
  ["Strength of Schedule", "🗓️", "Opponent difficulty, played vs. remaining"],
  ["Playoff Probability", "🏈", "Monte Carlo odds of making — and winning — the postseason"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function SeasonOutlook() {
  const [tab, setTab] = useState<Tab>("Strength of Schedule");
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [season, setSeason] = useState("");

  usePageTitle(`Season Outlook — ${tab}`);

  useEffect(() => {
    Promise.all([getSchedule(), getTeamMetaMap()]).then(([s, m]) => {
      setSchedule(s);
      setMeta(m);
      const seasons = [...new Set(s.map((r) => Number(r.season)))].sort((a, b) => b - a);
      if (seasons.length) setSeason(String(seasons[0]));
    });
  }, []);

  const seasons = [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a);
  const loading = !schedule.length || !meta || !season;

  return (
    <div className="space-y-4">
      <PageHeader title="Season Outlook" subtitle="What's ahead — remaining schedule difficulty and postseason odds.">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
      </PageHeader>

      <div className="grid gap-2 sm:grid-cols-2">
        {TABS.map(([t, icon, desc]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-2xl border px-4 py-2.5 text-left shadow-sm transition-all ${
              tab === t ? "border-[#002f6c] bg-[#002f6c] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[#002f6c]/40"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>{icon}</span>
              {t}
            </div>
            <div className={`mt-0.5 text-[11px] ${tab === t ? "text-white/75" : "text-slate-400"}`}>{desc}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <Loading label="Loading season data…" />
      ) : (
        <>
          {tab === "Strength of Schedule" && <SosTab schedule={schedule} season={season} meta={meta} />}
          {tab === "Playoff Probability" && <PlayoffTab schedule={schedule} season={season} meta={meta} />}
        </>
      )}
    </div>
  );
}
