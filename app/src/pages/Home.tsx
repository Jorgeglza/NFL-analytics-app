import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMeta, getSchedule, type Meta, type Row } from "../lib/data/loader";
import { NAV_GROUPS } from "../nav";
import { currentWeek, type CurrentWeek } from "../lib/logic/defaultWeek";

const GROUP_ICONS: Record<string, string> = {
  "Game Analysis": "🎯",
  "Player Analysis": "🏃",
  Data: "🧠",
};

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/60">{label}</div>
    </div>
  );
}

function gameLabel(g: Row): string {
  return `${g.away_team} @ ${g.home_team}`;
}

/** "This week" launchpad (audit §1: Home had no current-week entry point). */
function ThisWeek({ cw }: { cw: CurrentWeek }) {
  const played = cw.games.filter((g) => g.home_score != null).length;
  const days = [...new Set(cw.games.map((g) => String(g.gameday ?? "")).filter(Boolean))].sort();
  const dateRange =
    days.length > 1
      ? `${new Date(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(days[days.length - 1]).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : days[0]
        ? new Date(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : null;

  return (
    <div className="mt-8 max-w-2xl rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">This week</div>
          <div className="mt-0.5 text-lg font-bold">
            Week {cw.week}, {cw.season} — {cw.games.length} game{cw.games.length === 1 ? "" : "s"}
            {dateRange && <span className="font-normal text-white/60"> · {dateRange}</span>}
          </div>
          {played > 0 && played < cw.games.length && (
            <div className="mt-0.5 text-xs text-white/60">{played} of {cw.games.length} played so far</div>
          )}
        </div>
        <Link
          to={`/game_analysis/game_picks?season=${cw.season}&week=${cw.week}`}
          className="whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#002f6c] shadow-sm transition-transform hover:-translate-y-0.5"
        >
          See this week's picks →
        </Link>
      </div>
      {cw.games.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
          {cw.games.slice(0, 6).map((g) => (
            <span key={String(g.game_id)}>{gameLabel(g)}</span>
          ))}
          {cw.games.length > 6 && <span>+{cw.games.length - 6} more</span>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cw, setCw] = useState<CurrentWeek | null>(null);
  useEffect(() => {
    getMeta().then(setMeta).catch(() => setMeta(null));
    getSchedule().then((rows) => setCw(currentWeek(rows))).catch(() => setCw(null));
  }, []);

  const fmt = (n?: number) => (n == null ? "—" : n.toLocaleString());

  return (
    <div className="-mx-4 -my-6">
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#002f6c] via-[#0b3d85] to-[#164a9c] px-4 py-14 text-white">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-x-10 gap-y-8">
          <div className="min-w-72 flex-1">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">NFL Analytics</h1>
          <p className="mt-3 max-w-2xl text-white/75">
            Game picks, matchup previews, player prop analysis and Random Forest team grades —
            precomputed weekly from nflverse data, served fully static.
          </p>
          <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            <StatChip label="Seasons" value={meta ? `${meta.seasons[0]}–${String(meta.seasons[meta.seasons.length - 1]).slice(2)}` : "—"} />
            <StatChip label="Games" value={fmt(meta?.counts.schedule)} />
            <StatChip label="Team weeks" value={fmt(meta?.counts.team_week)} />
            <StatChip label="Model grades" value={fmt(meta?.counts.grades)} />
          </div>
          {meta && (
            <p className="mt-4 text-xs text-white/50">
              Data updated {new Date(meta.generated_at).toLocaleDateString(undefined, { dateStyle: "medium" })} · refreshed automatically every week
            </p>
          )}
          {cw && <ThisWeek cw={cw} />}
          </div>
          <img
            src={`${import.meta.env.BASE_URL}branding/jga-badge.png`}
            alt="JGA Fantasy Football"
            className="mx-auto h-48 w-auto drop-shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:h-56 lg:h-64"
          />
        </div>
      </section>

      {/* Page groups */}
      <section className="mx-auto max-w-screen-xl px-4 py-10">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-10 last:mb-0">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#002f6c]/8 text-lg">
                {GROUP_ICONS[group.label] ?? "📊"}
              </span>
              <h2 className="text-lg font-bold text-slate-800">{group.label}</h2>
              <span className="text-xs text-slate-400">
                {group.pages.filter((p) => p.implemented).length}/{group.pages.length} available
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.pages.map((page) => (
                <Link
                  key={page.path}
                  to={page.path}
                  className={`group relative rounded-2xl border bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    page.implemented ? "border-slate-200" : "border-slate-100 opacity-75"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#002f6c] group-hover:underline">{page.label}</span>
                    {!page.implemented && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        soon
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-slate-500">{page.description}</p>
                  <span className="absolute right-4 top-5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#002f6c]">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-2 flex justify-center border-t border-slate-100 pt-6">
          <Link
            to="/glossary"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#002f6c] shadow-sm transition-colors hover:border-[#002f6c]/40 hover:bg-[#002f6c]/5"
          >
            📖 Glossary — win types, stats & betting terms explained
          </Link>
        </div>
      </section>
    </div>
  );
}
