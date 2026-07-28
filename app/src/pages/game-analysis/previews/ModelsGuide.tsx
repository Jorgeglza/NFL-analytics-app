// Models Guide — plain-language explanation of every prediction model used in
// Matchup Previews, with a live worked example: pick any game and see the
// actual inputs each model consumed and the probability it produced.
import { useEffect, useMemo, useState } from "react";
import { getSchedule, getGrades, getTeamWeek, getMeta, getPredictiveModelGames, getPredictiveModelMeta, type Row } from "../../../lib/data/loader";
import { Select } from "../../../components/filters/Select";
import { Loading } from "../../../components/Loading";
import { Card, FilterGroup } from "../../../components/ui";
import { MIN_N_BUCKET, MARKET_BUCKET_W, ATS_WINDOW, homeCoverFairProb, vigLeanProbHome, atsTrendProbHome } from "../../../lib/logic/probBlend";
import { edgeComposite, EDGE_WEIGHTS, EDGE_SCALE } from "../../../lib/logic/edgeComposite";
import { fairProbs, impliedProb } from "../../../lib/logic/moneyline";
import { pythWinPct, log5, PYTH_EXP } from "../../../lib/logic/pythagorean";
import { ELO_INIT, ELO_K, ELO_HFA } from "../../../lib/logic/elo";
import {
  buildHist,
  buildGradesIndex,
  buildTeamWeekIndex,
  buildScheduleEloIndex,
  bucketLabel,
  marketRate,
  atsRate,
  favoriteSide,
  defaultWeekNearToday,
  kickoffMs,
  probBundle,
  MODEL_COLORS,
  MODEL_KEYS,
  buildPredictiveIndex,
  type PredictiveIndex,
} from "./engine";

const pctf = (p: number | null | undefined, d = 1) => (p == null ? "—" : `${(100 * p).toFixed(d)}%`);
const numf = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));

function ModelCard({
  color,
  title,
  what,
  inputs,
  children,
}: {
  color: string;
  title: string;
  what: React.ReactNode;
  inputs: string[];
  children: React.ReactNode; // worked example
}) {
  return (
    <Card accent={color} title={<span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />{title}</span>}>
      <p className="text-sm text-slate-700">{what}</p>
      <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Inputs</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
        {inputs.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Worked example — selected game</div>
        <div className="space-y-1 text-xs text-slate-700">{children}</div>
      </div>
    </Card>
  );
}

const Res = ({ team, p }: { team: string; p: number | null }) => (
  <div className="mt-1.5 inline-block rounded-full bg-[#002f6c] px-2.5 py-0.5 text-[11px] font-bold text-white">
    Result: {team} {pctf(p, 0)}
  </div>
);

export default function ModelsGuide() {
  const [schedule, setSchedule] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [teamWeekBySeason, setTeamWeekBySeason] = useState<Map<number, Row[]> | null>(null);
  const [season, setSeason] = useState("");
  const [week, setWeek] = useState("");
  const [gameId, setGameId] = useState("");
  const [predIdx, setPredIdx] = useState<PredictiveIndex | null>(null);
  const [predictiveUnavailable, setPredictiveUnavailable] = useState(false);
  const [predictiveCoverage, setPredictiveCoverage] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [s, g, mt] = await Promise.all([getSchedule(), getGrades(), getMeta()]);
      setSchedule(s);
      setGrades(g);
      const tw = await Promise.all(
        mt.seasons.map(async (yr) => [yr, (await getTeamWeek(yr)).filter((r) => r.game_type === "REG" || r.game_type == null)] as [number, Row[]]),
      );
      setTeamWeekBySeason(new Map(tw));
    })();
    Promise.all([getPredictiveModelGames(), getPredictiveModelMeta()])
      .then(([rows, m]) => {
        setPredIdx(buildPredictiveIndex(rows));
        setPredictiveCoverage(m.test_seasons.length ? { min: Math.min(...m.test_seasons), max: Math.max(...m.test_seasons) } : null);
      })
      .catch(() => setPredictiveUnavailable(true));
  }, []);

  const reg = useMemo(() => schedule.filter((r) => r.game_type === "REG"), [schedule]);
  const seasons = useMemo(() => [...new Set(reg.map((r) => Number(r.season)))].sort((a, b) => b - a), [reg]);
  const sel = season || String(seasons[0] ?? "");
  const s = Number(sel);
  const weeks = useMemo(() => [...new Set(reg.filter((r) => Number(r.season) === s).map((r) => Number(r.week)))].sort((a, b) => a - b), [reg, s]);
  const defWeek = useMemo(() => defaultWeekNearToday(reg, s) ?? weeks[weeks.length - 1], [reg, s, weeks]);
  const selWeek = weeks.map(String).includes(week) ? week : String(defWeek ?? "");
  const w = Number(selWeek);
  const wkPlayed = Math.max(0, w - 1);
  const games = useMemo(
    () => reg.filter((r) => Number(r.season) === s && Number(r.week) === w).sort((a, b) => kickoffMs(a) - kickoffMs(b)),
    [reg, s, w],
  );
  const game = games.find((g) => String(g.game_id) === gameId) ?? games[0];

  const hist = useMemo(() => (schedule.length ? buildHist(schedule) : null), [schedule]);
  const gradesIdx = useMemo(() => (grades.length ? buildGradesIndex(grades) : null), [grades]);
  const twIdx = useMemo(() => (teamWeekBySeason ? buildTeamWeekIndex(teamWeekBySeason) : null), [teamWeekBySeason]);
  const eloIdx = useMemo(() => (schedule.length ? buildScheduleEloIndex(schedule) : null), [schedule]);

  const ex = useMemo(() => {
    if (!game || !hist || !gradesIdx || !twIdx || !eloIdx) return null;
    const away = String(game.away_team);
    const home = String(game.home_team);
    const spread = game.spread_line == null ? null : Number(game.spread_line);
    const fav = favoriteSide(spread);
    const bucket = spread != null && fav != null ? bucketLabel(spread) : null;
    const market = bucket && fav ? marketRate(hist, bucket, fav, s, w) : null;
    const gA = gradesIdx.avgOverall(away, s, wkPlayed);
    const gH = gradesIdx.avgOverall(home, s, wkPlayed);
    const pMarketHome = market == null || fav == null ? null : fav === "home" ? market.pHat : 1 - market.pHat;
    const homeCoverFair = homeCoverFairProb(
      game.away_spread_odds == null ? null : Number(game.away_spread_odds),
      game.home_spread_odds == null ? null : Number(game.home_spread_odds),
    );
    const pVigLeanHome = vigLeanProbHome(homeCoverFair);
    const atsHome = atsRate(hist, home, s, wkPlayed);
    const atsAway = atsRate(hist, away, s, wkPlayed);
    const pAtsTrendHome = atsTrendProbHome(atsHome != null && atsAway != null ? atsHome - atsAway : null);
    const fa = { ...twIdx.features(away, s, wkPlayed), grade: gA };
    const fh = { ...twIdx.features(home, s, wkPlayed), grade: gH };
    const edge = edgeComposite(fa, fh);
    const mlA = game.away_moneyline == null ? null : Number(game.away_moneyline);
    const mlH = game.home_moneyline == null ? null : Number(game.home_moneyline);
    const fair = fairProbs(mlA, mlH);
    const eloE = eloIdx.get(String(game.game_id)) ?? null;
    const pfpa = (team: string) => {
      const rows = twIdx.rowsFor(team, s).filter((r) => Number(r.week) <= wkPlayed && r.points != null && r.points_allowed != null);
      return rows.length
        ? { pf: rows.reduce((sm, r) => sm + Number(r.points), 0), pa: rows.reduce((sm, r) => sm + Number(r.points_allowed), 0) }
        : null;
    };
    const ppA = pfpa(away);
    const ppH = pfpa(home);
    const pythA = ppA ? pythWinPct(ppA.pf, ppA.pa) : null;
    const pythH = ppH ? pythWinPct(ppH.pf, ppH.pa) : null;
    const pAwayPyth = pythA != null && pythH != null ? log5(pythA, pythH) : null;
    const bundle = probBundle(game, s, w, hist, gradesIdx, twIdx, eloIdx, predIdx ?? undefined);
    return { away, home, spread, fav, bucket, market, gA, gH, pMarketHome, homeCoverFair, pVigLeanHome, atsHome, atsAway, pAtsTrendHome, fa, fh, edge, mlA, mlH, fair, eloE, ppA, ppH, pythA, pythH, pAwayPyth, bundle };
  }, [game, hist, gradesIdx, twIdx, eloIdx, s, w, wkPlayed, predIdx]);

  if (!schedule.length || !teamWeekBySeason || !ex) return <Loading label="Loading all seasons…" />;

  const { away, home } = ex;
  const pickOf = (pair: [number | null, number | null]) => (pair[0] != null && pair[1] != null ? (pair[0] >= pair[1] ? away : home) : "—");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]"><span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />Models Guide</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            How each Matchup Previews model works, what data it consumes, and — for any game you select — the exact inputs and the probability it produced.
            All models use <b>pre-game information only</b> (stats through the previous week).
          </p>
        </div>
        <a href="#/game_analysis/matchup_previews" className="rounded-full border border-[#002f6c]/25 px-3 py-1.5 text-xs font-semibold text-[#002f6c] hover:bg-[#002f6c]/5">← Back to Matchup Previews</a>
      </div>

      <FilterGroup label="Example game — used in every card below">
        <Select label="Season" value={sel} onChange={setSeason} options={seasons.map((x) => ({ value: String(x), label: String(x) }))} />
        <Select label="Week" value={selWeek} onChange={setWeek} options={weeks.map((x) => ({ value: String(x), label: `Week ${x}` }))} />
        <Select label="Game" value={String(game.game_id)} onChange={setGameId} options={games.map((g) => ({ value: String(g.game_id), label: `${g.away_team} @ ${g.home_team}` }))} />
      </FilterGroup>

      <div className="grid gap-5 lg:grid-cols-2">
        <ModelCard
          color={MODEL_COLORS.blend}
          title="Market-calibrated"
          what={`Mostly how often favorites at this exact spread have won historically, plus a ${Math.round((1 - MARKET_BUCKET_W) * 100)}% dose of two market reads ML Fair doesn't see: the spread bet's own vig lean and each team's recent against-the-spread trend. A pure grading-model blend was tried and dropped (didn't beat pure market history); a pure vig+ATS model was also tried and dropped (too weak alone) — this minority-dose version keeps bucket history's accuracy while staying distinct from ML Fair.`}
          inputs={[
            "The betting spread → a 1-point bucket (e.g. −7.0 to −6.0) and which side is favored",
            `Historical favorite win % in that bucket (Wilson-smoothed, this week excluded) — weight ${Math.round(MARKET_BUCKET_W * 100)}%`,
            `Spread-odds vig lean: vig-free "home covers" probability from the spread's own odds (e.g. away −111 / home +101)`,
            `Team ATS trend: each team's cover rate over its last ${ATS_WINDOW} played games, home minus away`,
            `The two extras are averaged, then given the remaining ${Math.round((1 - MARKET_BUCKET_W) * 100)}% weight`,
            `Sample size flagged as low-confidence below ${MIN_N_BUCKET} historical games`,
          ]}
        >
          <div>Spread {ex.spread == null ? "—" : ex.spread.toFixed(1)} → bucket <b>{ex.bucket ?? "—"}</b>, favorite: <b>{ex.fav === "home" ? home : ex.fav === "away" ? away : "—"}</b></div>
          <div>History: favorites in this bucket won <b>{pctf(ex.market?.pHat ?? null)}</b> of <b>{ex.market?.n ?? "—"}</b> games{(ex.market?.n ?? 0) < MIN_N_BUCKET ? " (low-N)" : ""}</div>
          <div>Vig lean: home covers <b>{pctf(ex.homeCoverFair)}</b> (fair) → home win read <b>{pctf(ex.pVigLeanHome)}</b></div>
          <div>ATS trend (L{ATS_WINDOW}): {home} <b>{pctf(ex.atsHome)}</b> vs {away} <b>{pctf(ex.atsAway)}</b> → home win read <b>{pctf(ex.pAtsTrendHome)}</b></div>
          <Res team={pickOf(ex.bundle.blend)} p={ex.bundle.blend[0] != null && ex.bundle.blend[1] != null ? Math.max(ex.bundle.blend[0], ex.bundle.blend[1]) : null} />
        </ModelCard>

        <ModelCard
          color={MODEL_COLORS.trend}
          title="Trend Edge"
          what="A recent-form composite: five differences (away minus home), each weighted, summed into an edge and squashed into a probability. Captures who is playing well right now. Variables, windows and weights are fit from a backtest against actual game outcomes (2015-2025), not hand-picked — see docs/IMPLEMENTATION_LOG.md."
          inputs={[
            `Overall grade difference, season-to-date (weight ${EDGE_WEIGHTS.grade})`,
            `Points margin, mean of last 6 games (${EDGE_WEIGHTS.pmL6})`,
            `EPA differential, mean of last 6 (${EDGE_WEIGHTS.epaL6})`,
            `Win rate, mean of last 6 (${EDGE_WEIGHTS.winL6})`,
            `Turnover margin, mean of last 6 (${EDGE_WEIGHTS.tomL6})`,
            `Logistic scale ${EDGE_SCALE} converts the summed edge to a probability`,
          ]}
        >
          <div>{away}: grade {numf(ex.gA, 1)}, PM-L6 {numf(ex.fa.pmL6)}, EPA-L6 {numf(ex.fa.epaL6)}, Win%-L6 {numf(ex.fa.winL6)}, TO-L6 {numf(ex.fa.tomL6)}</div>
          <div>{home}: grade {numf(ex.gH, 1)}, PM-L6 {numf(ex.fh.pmL6)}, EPA-L6 {numf(ex.fh.epaL6)}, Win%-L6 {numf(ex.fh.winL6)}, TO-L6 {numf(ex.fh.tomL6)}</div>
          <div>Weighted edge (away − home): <b>{numf(ex.edge.edge)}</b> → 1 / (1 + e^(−{EDGE_SCALE} × edge))</div>
          <Res team={pickOf(ex.bundle.trend)} p={Math.max(ex.bundle.trend[0]!, ex.bundle.trend[1]!)} />
        </ModelCard>

        <ModelCard
          color={MODEL_COLORS.ml}
          title="ML Fair"
          what="What the sportsbook itself believes, extracted from the moneyline odds with the bookmaker's margin (vig) removed. The market consensus in probability form."
          inputs={[
            "Away and home moneyline odds",
            "Implied probability of each (e.g. −150 → 60%)",
            "Both normalized so they sum to 100% (removes the ~4–5% vig)",
          ]}
        >
          <div>Moneylines: {away} <b>{ex.mlA == null ? "—" : ex.mlA > 0 ? `+${ex.mlA}` : ex.mlA}</b> · {home} <b>{ex.mlH == null ? "—" : ex.mlH > 0 ? `+${ex.mlH}` : ex.mlH}</b></div>
          <div>Implied: {away} {pctf(impliedProb(ex.mlA))} · {home} {pctf(impliedProb(ex.mlH))} (sum &gt; 100% = vig {ex.fair.overround == null ? "—" : pctf(ex.fair.overround)})</div>
          <div>Fair (vig removed): {away} <b>{pctf(ex.fair.awayFair)}</b> · {home} <b>{pctf(ex.fair.homeFair)}</b></div>
          <Res team={pickOf(ex.bundle.ml)} p={ex.bundle.ml[0] != null && ex.bundle.ml[1] != null ? Math.max(ex.bundle.ml[0], ex.bundle.ml[1]) : null} />
        </ModelCard>

        <ModelCard
          color={MODEL_COLORS.elo}
          title="Elo"
          what="A rolling power rating updated after every game since 2015: beat a strong team and your rating jumps; lose to a weak one and it drops. Bigger margins move it more; ratings drift back toward average between seasons."
          inputs={[
            `Every game result since 2015 (start ${ELO_INIT}, K=${ELO_K})`,
            `Home-field advantage: +${ELO_HFA} Elo to the home side`,
            "Margin-of-victory multiplier (log of the margin, dampened for mismatches)",
            "Between seasons each team keeps ⅔ of its rating (⅓ regresses to the mean)",
          ]}
        >
          <div>Pre-game ratings: {away} <b>{ex.eloE ? Math.round(ex.eloE.eloAway) : "—"}</b> · {home} <b>{ex.eloE ? Math.round(ex.eloE.eloHome) : "—"}</b> (+{ELO_HFA} home bonus)</div>
          <div>p(home) = 1 / (1 + 10^(−(eloHome + {ELO_HFA} − eloAway)/400))</div>
          <Res team={pickOf(ex.bundle.elo)} p={ex.bundle.elo[0] != null && ex.bundle.elo[1] != null ? Math.max(ex.bundle.elo[0], ex.bundle.elo[1]) : null} />
        </ModelCard>

        <ModelCard
          color={MODEL_COLORS.pyth}
          title="Pythagorean"
          what="Teams that outscore opponents win — points differential is more predictive than win-loss record. Converts each team's points for/against into an expected win rate, then combines the two with the log5 formula."
          inputs={[
            `Points scored and allowed through the previous week (exponent ${PYTH_EXP})`,
            "log5 formula turns the two expected win rates into a head-to-head probability",
            "No home-field term (Elo already carries that)",
          ]}
        >
          <div>{away}: PF {ex.ppA?.pf ?? "—"} / PA {ex.ppA?.pa ?? "—"} → expected win% <b>{pctf(ex.pythA)}</b></div>
          <div>{home}: PF {ex.ppH?.pf ?? "—"} / PA {ex.ppH?.pa ?? "—"} → expected win% <b>{pctf(ex.pythH)}</b></div>
          <div>log5({pctf(ex.pythA, 0)}, {pctf(ex.pythH, 0)}) → {away} <b>{pctf(ex.pAwayPyth)}</b></div>
          <Res team={pickOf(ex.bundle.pyth)} p={ex.bundle.pyth[0] != null && ex.bundle.pyth[1] != null ? Math.max(ex.bundle.pyth[0], ex.bundle.pyth[1]) : null} />
        </ModelCard>

        {!predictiveUnavailable && (
          <ModelCard
            color={MODEL_COLORS.predictive}
            title="Predictive (margin regression)"
            what={
              <>
                A walk-forward linear regression that fits point margin (home score − away score) from 41 pre-game features
                (Elo, rolling EPA/success rate, injuries, rest, weather, divisional game). Win probability comes from a fitted
                normal residual distribution around the predicted margin. <b>Research finding: no confirmed edge over the
                market</b> — see the <a className="underline" href="#/data/predictive_model">Predictive Model page</a> and{" "}
                <code>docs/predictive-model.md</code> for the full investigation. Historical only — no prediction is produced
                for upcoming/unplayed games yet, so it silently sits out of the Average for those.
              </>
            }
            inputs={[
              "Elo rating differential (dominant feature by an order of magnitude)",
              "Rolling EPA / success-rate / explosive-play-rate differentials (last 3 games)",
              "Rest days, divisional game, weather (temp/wind/roof), QB-starter continuity, injury counts",
              `Coverage: seasons ${predictiveCoverage ? `${predictiveCoverage.min}–${predictiveCoverage.max}` : "—"} only (precomputed by the pipeline, not computed live in the browser)`,
            ]}
          >
            <div>Predicted home win probability (precomputed): <b>{pctf(ex.bundle.predictive[1])}</b></div>
            <div className="text-slate-400">{ex.bundle.predictive[1] == null ? "No prediction for this game (outside coverage or unplayed)." : "Loaded from the export's precomputed normal-CDF probability — nothing is refit in the browser."}</div>
            <Res team={pickOf(ex.bundle.predictive)} p={ex.bundle.predictive[0] != null && ex.bundle.predictive[1] != null ? Math.max(ex.bundle.predictive[0], ex.bundle.predictive[1]) : null} />
          </ModelCard>
        )}

        <ModelCard
          color={MODEL_COLORS.consensus}
          title="Average (consensus)"
          what="The simple mean of every model that has data for the game, re-normalized so the two sides sum to 100%. Historically the best calibrated: on ~2,300 games its accuracy rises steadily with its confidence (53% in the 50–55% band up to 81% in the 80%+ band)."
          inputs={[
            "All six model probabilities above (missing ones — including Predictive outside its coverage — are skipped)",
            "Equal weights — no model is trusted more than another",
          ]}
        >
          <div>
            {MODEL_KEYS.filter(([k]) => k !== "consensus" && !(predictiveUnavailable && k === "predictive")).map(([k]) => (
              <span key={k} className="mr-3 inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[k] }} />
                {pctf(ex.bundle[k][1], 0)}
              </span>
            ))}
            <span className="text-slate-400">(home-side probs)</span>
          </div>
          <Res team={pickOf(ex.bundle.consensus)} p={ex.bundle.consensus[0] != null && ex.bundle.consensus[1] != null ? Math.max(ex.bundle.consensus[0], ex.bundle.consensus[1]) : null} />
        </ModelCard>
      </div>
    </div>
  );
}
