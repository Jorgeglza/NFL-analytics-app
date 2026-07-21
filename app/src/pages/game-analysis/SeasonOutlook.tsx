// Season Outlook — new analytics (not a port). What's ahead: strength of the
// remaining schedule, and playoff probability from a Monte Carlo simulation.
// Week selector (defaults to the current week via the shared season/week
// context) lets both tabs be backtested "as of" any past week.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, type Row } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Select } from "../../components/filters/Select";
import { Loading } from "../../components/Loading";
import { usePageTitle } from "../../lib/hooks/usePageTitle";
import { useSeasonWeek } from "../../context/SeasonWeekContext";
import { PageHeader } from "../../components/ui";
import SosTab from "./season-outlook/SosTab";
import PlayoffTab from "./season-outlook/PlayoffTab";

const TABS = [
  ["Strength of Schedule", "🗓️", "Opponent difficulty, played vs. remaining"],
  ["Playoff Probability", "🏈", "Monte Carlo odds of making — and winning — the postseason"],
] as const;
type Tab = (typeof TABS)[number][0];

const stepBtnCls =
  "grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900 disabled:opacity-30 disabled:hover:text-slate-500";

export default function SeasonOutlook() {
  const [tab, setTab] = useState<Tab>("Strength of Schedule");
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const { season, week, setSeason, setWeek } = useSeasonWeek();

  usePageTitle(`Season Outlook — ${tab}`);

  useEffect(() => {
    Promise.all([getSchedule(), getTeamMetaMap()]).then(([s, m]) => {
      setSchedule(s);
      setMeta(m);
    });
  }, []);

  const seasons = useMemo(() => [...new Set(schedule.map((r) => Number(r.season)))].sort((a, b) => b - a), [schedule]);
  const weeks = useMemo(
    () =>
      [...new Set(schedule.filter((r) => String(r.season) === season && r.game_type === "REG").map((r) => Number(r.week)))].sort(
        (a, b) => a - b,
      ),
    [schedule, season],
  );
  const stepWeek = (dir: -1 | 1) => {
    const idx = weeks.indexOf(Number(week));
    const next = weeks[idx + dir];
    if (next != null) setWeek(String(next));
  };

  const loading = !schedule.length || !meta || !season || !week;

  return (
    <div className="space-y-4">
      <PageHeader title="Season Outlook" subtitle="What's ahead — remaining schedule difficulty and postseason odds, as of any week (backtestable).">
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ value: String(s), label: String(s) }))} />
        <div className="flex items-end gap-1.5">
          <Select label="As of week" value={week} onChange={setWeek} options={weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))} />
          <button className={stepBtnCls} onClick={() => stepWeek(-1)} disabled={weeks.indexOf(Number(week)) <= 0} title="Previous week">‹</button>
          <button
            className={stepBtnCls}
            onClick={() => stepWeek(1)}
            disabled={weeks.indexOf(Number(week)) < 0 || weeks.indexOf(Number(week)) >= weeks.length - 1}
            title="Next week"
          >
            ›
          </button>
        </div>
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
          {tab === "Strength of Schedule" && <SosTab schedule={schedule} season={season} week={week} meta={meta} />}
          {tab === "Playoff Probability" && <PlayoffTab schedule={schedule} season={season} week={week} meta={meta} />}
        </>
      )}
    </div>
  );
}
