# Future development

Ideas scoped but deliberately not built yet, with enough design detail to pick back up later.

## Model Backtest + Value Bets Backtest (betting/model performance page)

Scoped during the Power Rankings / Team Trends / Season Outlook planning pass (session after M5).
Split into two halves with very different data readiness:

### Model Backtest — buildable today, not built yet

Game-level backtest of the prediction engine, needs no new data:

- For every completed game across all seasons, replay the model's probability bundle via
  `previews/engine.ts`'s `probBundle()` (+ its index builders `buildHist`, `buildGradesIndex`,
  `buildTeamWeekIndex`, `buildScheduleEloIndex` — already page-agnostic pure functions, not tied to
  the Matchup Previews page itself).
- Derive a picked winner: `pL >= pR ? away : home` — the same comparison already duplicated inline in
  `WeekPreviewTab.tsx`/`MatchupTab.tsx`. Worth factoring into a shared `pickWinner()` helper in
  `engine.ts` before this page is built, so all three call sites share one implementation.
- Compare the pick to the actual result and to the market favorite (`schedule.json`'s `spread_line`)
  for straight-up accuracy and ATS accuracy, by season and by week.
- Calibration chart: bucket predicted win probability (e.g. 5–10% buckets) vs. actual win rate in that
  bucket — the key "is the model well-calibrated" view.
- Since `probBundle` already returns all 6 sub-models (blend/trend/ml/elo/pyth/consensus), the backtest
  can compare them side by side, not just the blended pick.

Everything above is buildable today straight from `schedule.json` — no pipeline changes needed.

### Value Bets Backtest — blocked, needs new data

`ValueBets.tsx` (and `MatchupBets.tsx`) are player-stat **rank-mismatch** scores (offense rank vs.
defense-allowed rank, `score = defRank - offRank`), not a moneyline/spread edge calculator — there is no
"flag as value bet" probability threshold anywhere in the app to backtest. Grading that mismatch score
against real outcomes would need historical **sportsbook prop lines** (e.g. "over/under 65.5 receiving
yards") ingested into the pipeline; the pipeline currently stores only counting stats (`player_week`), not
prop odds.

**To unblock**: add a new pipeline stage + data contract for historical player prop lines (source TBD),
then bucket the rank-mismatch score by size and measure hit rate against the actual line outcome.

### Decision for a future session

Pick one:
1. Build the Model Backtest half now (fully unblocked) as its own page, and revisit Value Bets Backtest
   once prop-line data exists.
2. Wait and ship both halves together as originally scoped, once prop-line ingestion is in place.

**Status (2026-07-21): tabled.** No reliable historical prop-line data source has been found, and
Model Backtest alone was deprioritized in favor of scoping the Fantasy Draft page instead (see below).

## Fantasy Draft page (design doc written, not built)

Full design in `docs/fantasy-pipeline.md`: a Player Analysis-adjacent page ranking players for
the upcoming fantasy draft, aggregating multiple scraped ranking sources (CBS/ESPN/TheScore)
into a consensus rank/ADP/value table, plus a later draft-guidance tool (mark players drafted,
snake-order tracking). Deliberately built as a fully independent pipeline
(`pipeline/fantasy_pipeline/`, own sqlite/JSON output, own duplicated export utilities) run
**manually/on-demand only — no GitHub Actions automation** — so a fragile web scrape can never
break the main NFL data pipeline, build, or deploy. Pick up by reading
`docs/fantasy-pipeline.md` in full before starting.
