// Pick'em Recommendations — "The Story" sub-view. A recolored, paraphrased
// retelling of the user's "Model vs. the Pool" artifact: picking the
// favorite is table stakes, the real separator is upset-calling in tight
// games, and no model factor reliably beats a coin flip until the spread
// opens past ~5 points. Where this repo's own pipeline can reproduce a
// number (spread-bucket win rates, home/away splits, the edge-hunting factor
// rankings), it's recomputed live; the pool-vs-model comparison numbers have
// no live source in this app and are ported as a static 2025 reference — see
// lib/data/pickemPoolReference.ts's header for why.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, getPredictiveModelGames, getPredictiveModelGameFeatures, type Row } from "../../../../lib/data/loader";
import { toGame, type Game } from "../../../../lib/logic/spreadPicks";
import { WIN_TYPE_COLORS } from "../../../../lib/logic/winType";
import { joinGamesAndFeatures, edgeFactorsForZone, zoneModelAccuracy, zoneGameCount, coinFlipBand, type Zone } from "../../../../lib/logic/edgeFactors";
import { POOL_WEEKLY_2025, POOL_REFERENCE_SEASON, UPSET_CALL_RATES_2025, poolWeekReference } from "../../../../lib/data/pickemPoolReference";
import { Card, Kpi } from "../../../../components/ui";
import { Loading, ErrorRetry } from "../../../../components/Loading";

const NAVY = "#002f6c";
const POOL_COLOR = "#9a9d92";
const WINNER_COLOR = "#b3821a";
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function BarRow({ label, sub, value, max, color }: { label: string; sub?: string; value: number; max: number; color: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[140px_1fr_56px]">
      <div className="text-right text-xs text-slate-500">
        <div className="font-medium text-slate-700">{label}</div>
        {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
      </div>
      <div className="h-3.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
      <div className="text-right text-xs font-semibold text-slate-800">{pct(value)}</div>
    </div>
  );
}

/** Diverging bar around 50% with a shaded "coin flip" band — the edge-hunting charts. */
function DivergingRow({ label, sub, value, band, n }: { label: string; sub?: string; value: number; band: { lo: number; hi: number }; n: number }) {
  const lo = 0.35;
  const hi = 0.85;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const clears = value > band.hi || value < band.lo;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[170px_1fr_60px]">
      <div className="text-right text-xs text-slate-500">
        <div className="font-medium text-slate-700">{label}</div>
        {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
      </div>
      <div className="relative h-4 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 rounded-full bg-slate-200" style={{ left: pos(band.lo), width: `calc(${pos(band.hi)} - ${pos(band.lo)})` }} />
        <div className="absolute inset-y-0 w-px bg-slate-400" style={{ left: pos(0.5) }} />
        <div
          className="absolute top-0.5 h-3 w-1.5 -translate-x-1/2 rounded-full"
          style={{ left: pos(value), background: clears ? NAVY : POOL_COLOR }}
        />
      </div>
      <div className="text-right text-xs font-semibold text-slate-800">
        {pct(value)} <span className="text-slate-400">n={n}</span>
      </div>
    </div>
  );
}

const SPREAD_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "0–2", lo: 0, hi: 2 },
  { label: "3–4", lo: 3, hi: 4 },
  { label: "5–6", lo: 5, hi: 6 },
  { label: "7–9", lo: 7, hi: 9 },
  { label: "10+", lo: 10, hi: Infinity },
];

const ZONE_LABEL: Record<Zone, string> = { "0-3": "0–3 pt spread", "4-5": "4–5 pt spread", "7+": "7+ pt spread" };

export default function StoryView() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [pmGames, setPmGames] = useState<Row[]>([]);
  const [pmFeatures, setPmFeatures] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setLoadError(null);
    Promise.all([getSchedule(), getPredictiveModelGames(), getPredictiveModelGameFeatures()])
      .then(([sch, g, f]) => {
        setSchedule(sch);
        setPmGames(g);
        setPmFeatures(f);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }, [retryTick]);

  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const games = useMemo(() => reg.map(toGame).filter((g): g is Game => g != null && g.played && g.favorite != null), [reg]);
  const currentSeason = useMemo(() => (reg.length ? Math.max(...reg.map((r) => Number(r.season))) : POOL_REFERENCE_SEASON), [reg]);

  const spreadChart = useMemo(
    () =>
      SPREAD_BUCKETS.map((b) => {
        const inBucket = games.filter((g) => g.absSpread >= b.lo && g.absSpread <= b.hi);
        const wins = inBucket.filter((g) => g.favWin).length;
        return { ...b, n: inBucket.length, favWinRate: inBucket.length ? wins / inBucket.length : 0 };
      }),
    [games],
  );

  const homeAway = useMemo(() => {
    const rate = (pred: (g: Game) => boolean) => {
      const pool = games.filter(pred);
      return pool.length ? pool.filter((g) => g.favWin).length / pool.length : 0;
    };
    return {
      homeFav: rate((g) => g.favorite === "home"),
      awayFav: rate((g) => g.favorite === "away"),
      homeDog: 1 - rate((g) => g.favorite === "away"), // home is the dog when away is favored; home wins = away favorite loses
    };
  }, [games]);

  const joined = useMemo(() => joinGamesAndFeatures(pmGames, pmFeatures), [pmGames, pmFeatures]);
  const zones: Zone[] = ["0-3", "4-5"];
  const zoneData = useMemo(
    () =>
      Object.fromEntries(
        zones.map((z) => {
          const n = zoneGameCount(joined, z);
          return [
            z,
            {
              n,
              band: coinFlipBand(n),
              factors: edgeFactorsForZone(joined, z),
              accuracy: zoneModelAccuracy(joined, z),
            },
          ];
        }),
      ) as Record<Zone, { n: number; band: { lo: number; hi: number; halfWidth: number }; factors: ReturnType<typeof edgeFactorsForZone>; accuracy: ReturnType<typeof zoneModelAccuracy> }>,
    [joined],
  );
  const zone7 = useMemo(() => edgeFactorsForZone(joined, "7+"), [joined]);

  const poolRow = poolWeekReference(1); // header reference example not needed; per-week table below

  if (loadError) return <ErrorRetry onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!reg.length) return <Loading label="Loading…" />;

  const zone03 = zoneData["0-3"];
  const zone45 = zoneData["4-5"];
  const bestZone03 = zone03.factors[0];
  const bestZone45 = zone45.factors[0];

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm leading-relaxed text-slate-600">
          Picking the favorite is table stakes — nearly everyone does it, most weeks. What actually separates a weekly winner from the pack
          is how often they call the games where the spread barely leans one way. This page checks the model, the market line, and a plain
          Elo rating against that same question, using this app&apos;s own historical data (2018–{currentSeason}) instead of a one-off study.
        </p>
      </Card>

      <Card
        title={`Pool reference — ${POOL_REFERENCE_SEASON} season`}
        subtitle="A static snapshot from a private 98-entrant pick'em pool the user tracks — not derived from this app's data, and not updated automatically. For a current-season week not yet played, the number shown is last year's winning score for that same week, as a rough target."
      >
        <div className="flex flex-wrap gap-3">
          <Kpi label="Weeks in reference" value={POOL_WEEKLY_2025.length} accent={WINNER_COLOR} />
          <Kpi
            label={`${currentSeason > POOL_REFERENCE_SEASON ? "Week 1 target (from " + POOL_REFERENCE_SEASON + ")" : "Week 1 winning score"}`}
            value={poolRow ? `${poolRow.humanBest}/${poolRow.games}` : "—"}
            sub="Pool's top score that week"
          />
          <Kpi label="Season avg. winning score" value={(POOL_WEEKLY_2025.reduce((s, w) => s + w.humanBest, 0) / POOL_WEEKLY_2025.length).toFixed(1)} />
        </div>
      </Card>

      <Card title="The favorite is the floor, not the edge" subtitle="Favorite win rate by closing spread, all regular-season games on file. Tight spreads land close to a coin flip; wide ones are close to automatic.">
        <div className="space-y-2.5">
          {spreadChart.map((b) => (
            <BarRow key={b.label} label={`${b.label} pts`} sub={`n=${b.n}`} value={b.favWinRate} max={1} color={NAVY} />
          ))}
        </div>
      </Card>

      <Card title="Home field isn't a tiebreaker" subtitle="Once you know who's favored, home field adds little on top — computed live from the same games above.">
        <div className="space-y-2.5">
          <BarRow label="Home favorites" value={homeAway.homeFav} max={1} color={WIN_TYPE_COLORS["Favorite home"]} />
          <BarRow label="Away favorites" value={homeAway.awayFav} max={1} color={WIN_TYPE_COLORS["Favorite away"]} />
          <BarRow label="Home underdogs" value={homeAway.homeDog} max={1} color={WIN_TYPE_COLORS["Underdog home"]} />
        </div>
      </Card>

      <Card
        title="Where winners actually separate themselves"
        subtitle={`Static ${POOL_REFERENCE_SEASON} reference: how often each entrant type correctly called a game the favorite lost. This is the one number that explains why model-style pickers rarely win a week outright.`}
      >
        <div className="space-y-2.5">
          <BarRow label="Weekly winner(s)" value={UPSET_CALL_RATES_2025.winner} max={UPSET_CALL_RATES_2025.winner} color={WINNER_COLOR} />
          <BarRow label="Pool average" value={UPSET_CALL_RATES_2025.pool} max={UPSET_CALL_RATES_2025.winner} color={POOL_COLOR} />
          <BarRow label="Model" value={UPSET_CALL_RATES_2025.model} max={UPSET_CALL_RATES_2025.winner} color="#2a78d6" />
          <BarRow label="Market" value={UPSET_CALL_RATES_2025.market} max={UPSET_CALL_RATES_2025.winner} color="#eb6834" />
          <BarRow label="Elo" value={UPSET_CALL_RATES_2025.elo} max={UPSET_CALL_RATES_2025.winner} color="#1baf7a" />
        </div>
      </Card>

      <Card title="The playbook" accent={WINNER_COLOR}>
        <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-600">
          <li>
            <strong className="text-slate-800">Auto-pick the favorite past ~6 points.</strong> It wins {pct(spreadChart[3]?.favWinRate ?? 0)}–
            {pct(spreadChart[4]?.favWinRate ?? 0)} of the time on file — not worth a second thought.
          </li>
          <li>
            <strong className="text-slate-800">Treat a 3-point-or-tighter spread as a real coin flip.</strong> Nothing tested below beats one
            there; a 4–5 point spread is a softer favorite and the model/Elo read it correctly more often than not.
          </li>
          <li>
            <strong className="text-slate-800">Don&apos;t outsource the tightest games to a power rating.</strong> Model/market/Elo call only{" "}
            {pct(UPSET_CALL_RATES_2025.model)}–{pct(UPSET_CALL_RATES_2025.elo)} of upsets right ({POOL_REFERENCE_SEASON} reference) — worse than
            an average human ({pct(UPSET_CALL_RATES_2025.pool)}).
          </li>
          <li>
            <strong className="text-slate-800">Weigh situational factors on the tightest games</strong> — rest, injuries, a letdown/lookahead
            spot — that's where winners separate ({pct(UPSET_CALL_RATES_2025.winner)} upset-call rate vs. the pool average).
          </li>
          <li>
            <strong className="text-slate-800">Don&apos;t use home field as a tiebreaker</strong> — home ({pct(homeAway.homeFav)}) and away (
            {pct(homeAway.awayFav)}) favorites win at nearly the same rate.
          </li>
        </ol>
      </Card>

      <Card title="Hunting for an edge in the coin-flip zone" subtitle="Every played game 2018–present, split into a 0–3 and a 4–5 point closing-spread band, checked feature family by feature family against what actually happened.">
        <div className="flex flex-wrap gap-3">
          <Kpi label="0–3 pt games on file" value={zone03.n} sub="Coin-flip band" accent={POOL_COLOR} />
          <Kpi label="4–5 pt games on file" value={zone45.n} sub="Soft-favorite band" accent={NAVY} />
        </div>
      </Card>

      <Card title="0–3 points: grouped factors, ranked" subtitle="Each bar is a family of related model features (see method note). Shaded band = the range a coin flip alone would land in ~95% of the time at this sample size — a bar has to clear it to count as a real signal.">
        <div className="space-y-2.5">
          {zone03.factors.map((f) => (
            <DivergingRow key={f.key} label={f.label} sub={`n≈${f.n}`} value={f.hit} band={zone03.band} n={f.n} />
          ))}
        </div>
        {zone03.accuracy && <p className="mt-3 text-xs text-slate-500">Model straight-up accuracy here: {pct(zone03.accuracy.accuracy)} ({zone03.accuracy.hits}/{zone03.accuracy.n}) — inside the coin-flip band.</p>}
      </Card>

      <Card title="4–5 points: a different story" subtitle="Widen the spread by a point or two and several factor families clear the coin-flip band with room to spare.">
        <div className="space-y-2.5">
          {zone45.factors.map((f) => (
            <DivergingRow key={f.key} label={f.label} sub={`n≈${f.n}`} value={f.hit} band={zone45.band} n={f.n} />
          ))}
        </div>
        {zone45.accuracy && <p className="mt-3 text-xs text-slate-500">Model straight-up accuracy here: {pct(zone45.accuracy.accuracy)} ({zone45.accuracy.hits}/{zone45.accuracy.n}) — a real edge, not noise.</p>}
      </Card>

      <Card title="Same factors, three zones" subtitle="The same feature families climb steadily as the spread widens — priced into the line in proportion to how much room the line has to move.">
        <div className="table-wrap overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="pb-2">Factor family</th>
                {(["0-3", "4-5", "7+"] as Zone[]).map((z) => (
                  <th key={z} className="pb-2 text-right">
                    {ZONE_LABEL[z]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zone7.slice(0, 5).map((f7) => {
                const f03 = zone03.factors.find((f) => f.key === f7.key);
                const f45 = zone45.factors.find((f) => f.key === f7.key);
                return (
                  <tr key={f7.key} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-700">{f7.label}</td>
                    <td className="py-1.5 text-right text-slate-500">{f03 ? pct(f03.hit) : "—"}</td>
                    <td className="py-1.5 text-right text-slate-500">{f45 ? pct(f45.hit) : "—"}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-800">{pct(f7.hit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="The honest conclusion" accent={POOL_COLOR}>
        <div className="space-y-3 text-sm leading-relaxed text-slate-600">
          <p>
            The real coin-flip zone is narrower than the spread number suggests. Inside 3 points, the best factor family (
            <strong className="text-slate-800">{bestZone03?.label ?? "—"}</strong>) hits just {bestZone03 ? pct(bestZone03.hit) : "—"} — inside
            the coin-flip band, not a real signal — and the model itself is statistically indistinguishable from a coin flip there.
          </p>
          <p>
            Move out to 4–5 points, though, and the market hasn&apos;t fully flattened things yet:{" "}
            <strong className="text-slate-800">{bestZone45?.label ?? "—"}</strong> clears the band at {bestZone45 ? pct(bestZone45.hit) : "—"},
            and the model itself hits {zone45.accuracy ? pct(zone45.accuracy.accuracy) : "—"} — a real, statistically significant edge.
          </p>
          <p>
            Practically: a 3-point-or-tighter line really is a coin flip, no matter what you look at — treat it like one. A 4–5 point line is a
            soft favorite the model and Elo both still read correctly more often than not. If a real edge exists in the true 0–3 zone, it
            isn&apos;t sitting in this feature set — worth a human look instead:
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Late-breaking inactives — this data freezes recent-form stats mid-week.</li>
            <li>In-week line movement — this dataset only sees a single closing spread.</li>
            <li>Weather called closer to kickoff — wind/temp here are pre-week forecasts.</li>
            <li>Situational spots — letdown/lookahead, a new play-caller, a backup QB&apos;s matchup fit.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
