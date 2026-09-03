// Pick'em Recommendations — "Recommendations" sub-view. Per-week favorite /
// coin-flip picks: spreads wider than the threshold auto-recommend the
// favorite (default >5 pts, adjustable — the Story view's "honest
// conclusion" is that nothing beats a coin flip inside that zone, so this
// page doesn't try to auto-pick those games either, it surfaces the same
// FH/FA/UH/UA historical read and situational checklist the Story view's
// coin-flip conclusion points to instead).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSchedule,
  getPredictiveModelUpcoming,
  getPredictiveModelUpcomingMeta,
  type Row,
} from "../../../../lib/data/loader";
import { currentWeek } from "../../../../lib/logic/defaultWeek";
import { toGame, bucketOf, historicFavRate, type Game } from "../../../../lib/logic/spreadPicks";
import { WIN_TYPE_COLORS } from "../../../../lib/logic/winType";
import { Card, Kpi, RangeInput } from "../../../../components/ui";
import { Select } from "../../../../components/filters/Select";
import { Loading, ErrorRetry, Empty } from "../../../../components/Loading";

const POOL_COLOR = "#9a9d92";
const BIN_SIZE = 1.0;
const SIGNED = true;

const CHECKLIST_REMINDERS = [
  "Late-breaking inactives — Friday/Saturday injury news isn't reflected in this week's numbers.",
  "In-week line movement — where the spread opened vs. closed can say more than the closing number alone.",
  "Weather called closer to kickoff — wind/temp shown here are pre-week forecasts, not gametime readings.",
  "Situational spots — a letdown/lookahead game, a new play-caller, a backup QB's specific matchup fit.",
];

/** Small, subtle strip: one tick per this-week game at its |spread|, plus the
 * current threshold marker — a quick read on whether the slate runs tight or
 * wide before picking where to set the threshold. */
function SpreadStrip({ spreads, threshold }: { spreads: number[]; threshold: number }) {
  if (!spreads.length) return null;
  const max = Math.max(threshold, ...spreads, 1);
  const W = 160;
  const H = 18;
  const x = (v: number) => 4 + (Math.min(v, max) / max) * (W - 8);
  const min = Math.min(...spreads);
  const maxSpread = Math.max(...spreads);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">This week&apos;s spreads</span>
      <svg width={W} height={H} className="overflow-visible">
        <line x1={4} y1={H / 2} x2={W - 4} y2={H / 2} stroke="#e2e8f0" strokeWidth={1} />
        {spreads.map((s, i) => (
          <circle key={i} cx={x(s)} cy={H / 2} r={2.5} fill={POOL_COLOR} opacity={0.75} />
        ))}
        <line x1={x(threshold)} y1={2} x2={x(threshold)} y2={H - 2} stroke="#002f6c" strokeWidth={1.5} />
      </svg>
      <span className="text-[10px] text-slate-400">
        {min.toFixed(1)}–{maxSpread.toFixed(1)} pts &middot; line marks the {threshold}pt threshold
      </span>
    </div>
  );
}

interface UpcomingRow {
  home_win_prob?: number | null;
  market_home_fair?: number | null;
  elo_p_home?: number | null;
}

export default function RecommendationsView() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [upcoming, setUpcoming] = useState<Row[]>([]);
  const [upcomingMeta, setUpcomingMeta] = useState<{ season: number | null; week: number | null; n_games: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [season, setSeason] = useState("");
  const [week, setWeek] = useState("");
  const [threshold, setThreshold] = useState(5);
  const seededRef = useRef(false);

  useEffect(() => {
    setLoadError(null);
    Promise.all([getSchedule(), getPredictiveModelUpcoming(), getPredictiveModelUpcomingMeta()])
      .then(([sch, up, meta]) => {
        setSchedule(sch);
        setUpcoming(up);
        setUpcomingMeta(meta);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }, [retryTick]);

  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const scheduleByGameId = useMemo(() => new Map(reg.map((r) => [String(r.game_id), r])), [reg]);
  const games = useMemo(() => reg.map(toGame).filter((g): g is Game => g != null), [reg]);

  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const weeksForSeason = useMemo(
    () => [...new Set(reg.filter((r) => Number(r.season) === Number(season)).map((r) => Number(r.week)))].sort((a, b) => a - b),
    [reg, season],
  );

  // Seed the default week once data is in: prefer the live upcoming export's
  // week, else this app's shared "current week" rule.
  useEffect(() => {
    if (seededRef.current || !reg.length) return;
    seededRef.current = true;
    if (upcomingMeta?.n_games && upcomingMeta.season && upcomingMeta.week) {
      setSeason(String(upcomingMeta.season));
      setWeek(String(upcomingMeta.week));
    } else {
      const cw = currentWeek(reg);
      if (cw) {
        setSeason(String(cw.season));
        setWeek(String(cw.week));
      }
    }
  }, [reg, upcomingMeta]);

  const upcomingByTeam = useMemo(() => {
    const m = new Map<string, UpcomingRow>();
    for (const r of upcoming) {
      if (String(r.season) === season && String(r.week) === week) m.set(`${r.home_team}|${r.away_team}`, r as UpcomingRow);
    }
    return m;
  }, [upcoming, season, week]);

  const pHatOf = useMemo(
    () => (season && week ? historicFavRate(games, Number(season), Number(week), BIN_SIZE, SIGNED) : null),
    [games, season, week],
  );

  const weekGames = useMemo(
    () => games.filter((g) => String(g.season) === season && String(g.week) === week).sort((a, b) => b.absSpread - a.absSpread),
    [games, season, week],
  );

  const favPicks = weekGames.filter((g) => g.favorite != null && g.absSpread > threshold);
  const coinFlips = weekGames.filter((g) => g.favorite == null || g.absSpread <= threshold);

  const avgModelProb = useMemo(() => {
    const probs = favPicks
      .map((g) => {
        const u = upcomingByTeam.get(`${g.homeTeam}|${g.awayTeam}`);
        if (!u?.home_win_prob) return null;
        const p = Number(u.home_win_prob);
        return g.favorite === "home" ? p : 1 - p;
      })
      .filter((p): p is number => p != null);
    return probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : null;
  }, [favPicks, upcomingByTeam]);

  if (loadError) return <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!reg.length) return <Loading label="Loading schedule…" />;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label="Season"
            value={season}
            onChange={(v) => {
              setSeason(v);
              setWeek("");
            }}
            options={seasons.map((s) => ({ value: String(s), label: String(s) }))}
          />
          <Select
            label="Week"
            value={weeksForSeason.map(String).includes(week) ? week : ""}
            onChange={setWeek}
            options={weeksForSeason.map((w) => ({ value: String(w), label: `Week ${w}` }))}
          />
          <RangeInput label={`Auto-pick favorite when spread > ${threshold} pts`} value={threshold} onChange={setThreshold} min={3} max={10} step={0.5} />
          <SpreadStrip spreads={weekGames.map((g) => g.absSpread)} threshold={threshold} />
        </div>
      </Card>

      {!weekGames.length ? (
        <Empty label="No games for this week yet." />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Kpi label="Favorite auto-picks" value={favPicks.length} accent={WIN_TYPE_COLORS["Favorite home"]} />
            <Kpi label="Coin-flip games" value={coinFlips.length} accent={POOL_COLOR} sub={`Spread ≤ ${threshold} pts`} />
            <Kpi label="Threshold" value={`${threshold} pts`} />
            <Kpi label="Avg. model confidence" value={avgModelProb != null ? `${Math.round(avgModelProb * 100)}%` : "—"} sub="On the auto-picked favorites" />
          </div>

          <div className="space-y-3">
            {weekGames.map((g) => {
              const isFavPick = g.favorite != null && g.absSpread > threshold;
              const favColor = g.favorite === "home" ? WIN_TYPE_COLORS["Favorite home"] : WIN_TYPE_COLORS["Favorite away"];
              const favTeam = g.favorite === "home" ? g.homeTeam : g.favorite === "away" ? g.awayTeam : null;
              const u = upcomingByTeam.get(`${g.homeTeam}|${g.awayTeam}`);
              const modelProb = u?.home_win_prob != null ? (g.favorite === "home" ? Number(u.home_win_prob) : 1 - Number(u.home_win_prob)) : null;

              if (isFavPick) {
                return (
                  <Card key={g.gameId} accent={favColor}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                          {g.awayTeam} @ {g.homeTeam} &middot; spread {g.spread > 0 ? "+" : ""}
                          {g.spread}
                        </div>
                        <div className="mt-0.5 text-lg font-bold text-slate-900">
                          Pick <span style={{ color: favColor }}>{favTeam}</span>
                          <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: favColor }}>
                            Favorite &middot; |spread| {g.absSpread.toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        {modelProb != null && <div>Model win prob: {Math.round(modelProb * 100)}%</div>}
                        {u?.market_home_fair != null && (
                          <div>Market fair: {Math.round((g.favorite === "home" ? Number(u.market_home_fair) : 1 - Number(u.market_home_fair)) * 100)}%</div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              }

              // Coin flip: no auto pick — FH/FA/UH/UA historical read + situational checklist.
              const bucket = bucketOf(g.spread, BIN_SIZE, SIGNED).label;
              const side = g.favorite ?? "none";
              const pFav = side !== "none" ? (pHatOf?.(bucket, side) ?? 0.5) : 0.5;
              const favLabel = g.favorite === "home" ? "Favorite home" : g.favorite === "away" ? "Favorite away" : null;
              const dogLabel = g.favorite === "home" ? "Underdog away" : g.favorite === "away" ? "Underdog home" : null;

              const raw = scheduleByGameId.get(g.gameId);
              const restDiff = raw?.home_rest != null && raw?.away_rest != null ? Number(raw.home_rest) - Number(raw.away_rest) : null;
              const divGame = raw?.div_game != null ? Number(raw.div_game) === 1 : null;
              const roof = raw?.roof != null ? String(raw.roof) : null;

              return (
                <Card key={g.gameId} accent={POOL_COLOR}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                          {g.awayTeam} @ {g.homeTeam} &middot; spread {g.spread > 0 ? "+" : ""}
                          {g.spread}
                        </div>
                        <div className="mt-0.5 text-lg font-bold text-slate-900">Coin flip</div>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: POOL_COLOR }}>
                        |spread| {g.absSpread.toFixed(1)} &le; {threshold}
                      </span>
                    </div>

                    {favLabel && dogLabel && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="font-semibold" style={{ color: WIN_TYPE_COLORS[favLabel] }}>
                            {favLabel} ({favTeam})
                          </div>
                          <div className="text-slate-500">Historically covers ~{Math.round(pFav * 100)}% at this spread</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="font-semibold" style={{ color: WIN_TYPE_COLORS[dogLabel] }}>
                            {dogLabel} ({g.favorite === "home" ? g.awayTeam : g.homeTeam})
                          </div>
                          <div className="text-slate-500">Historically wins ~{Math.round((1 - pFav) * 100)}% at this spread</div>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {divGame != null && (
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                          {divGame ? "Division game" : "Non-division"}
                        </span>
                      )}
                      {roof && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">Roof: {roof}</span>}
                      {restDiff != null && restDiff !== 0 && (
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                          {restDiff > 0 ? g.homeTeam : g.awayTeam} +{Math.abs(restDiff)} rest days
                        </span>
                      )}
                    </div>

                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer font-medium text-slate-600">Worth a human look, not a model (see the Story tab)</summary>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4">
                        {CHECKLIST_REMINDERS.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
