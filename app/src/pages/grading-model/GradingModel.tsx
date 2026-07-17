// Port of the grading model page (4 tabs: Season, Teams, Weekly, Features).
import { useEffect, useState } from "react";
import { getGrades, getFeatureImportance, getSchedule, getContribParams, type Row, type ContribParams } from "../../lib/data/loader";
import { getTeamMetaMap, type TeamMeta } from "../../lib/team/meta";
import { Loading } from "../../components/Loading";
import SeasonTab from "./SeasonTab";
import TeamsTab from "./TeamsTab";
import WeeklyTab from "./WeeklyTab";
import FeaturesTab from "./FeaturesTab";

const TABS = ["Season", "Teams", "Weekly", "Features"] as const;
type Tab = (typeof TABS)[number];

export default function GradingModel() {
  const [tab, setTab] = useState<Tab>("Season");
  const [grades, setGrades] = useState<Row[]>([]);
  const [importance, setImportance] = useState<Row[]>([]);
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Map<string, TeamMeta> | null>(null);
  const [contribParams, setContribParams] = useState<ContribParams | null>(null);

  useEffect(() => {
    Promise.all([getGrades(), getFeatureImportance(), getSchedule(), getTeamMetaMap(), getContribParams()]).then(
      ([g, fi, s, m, cp]) => {
        setGrades(g);
        setImportance(fi);
        setSchedule(s);
        setMeta(m);
        setContribParams(cp);
      },
    );
  }, []);

  const loading = !grades.length || !meta || !contribParams;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Grading Model</h1>
        <div className="flex rounded-full border border-slate-200 bg-slate-100 p-0.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm normal-case tracking-normal font-medium ${tab === t ? "bg-[#002f6c] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Loading label="Loading model data…" />
      ) : (
        <>
          {tab === "Season" && <SeasonTab grades={grades} schedule={schedule} meta={meta} />}
          {tab === "Teams" && <TeamsTab grades={grades} meta={meta} contribParams={contribParams} />}
          {tab === "Weekly" && <WeeklyTab grades={grades} schedule={schedule} meta={meta} />}
          {tab === "Features" && <FeaturesTab importance={importance} />}
        </>
      )}
    </div>
  );
}
