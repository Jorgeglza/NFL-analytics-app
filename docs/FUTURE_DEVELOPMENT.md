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

### Value Bets Backtest — scrapped (2026-08-03)

`ValueBets.tsx` (and `MatchupBets.tsx`) are player-stat **rank-mismatch** scores (offense rank vs.
defense-allowed rank, `score = defRank - offRank`), not a moneyline/spread edge calculator — there is no
"flag as value bet" probability threshold anywhere in the app to backtest. Grading that mismatch score
against real outcomes would need historical **sportsbook prop lines** (e.g. "over/under 65.5 receiving
yards") ingested into the pipeline; the pipeline currently stores only counting stats (`player_week`), not
prop odds.

**Decision: not building this.** Per explicit user direction (2026-08-03), no new data-import work is to
be scoped — this idea requires ingesting a new data source (historical sportsbook prop lines) with no
identified source, so it's dropped rather than left "blocked" pending one. If sportsbook prop-line data
becomes available through some other already-planned channel in the future, this section's original
design (bucket the rank-mismatch score by size, measure hit rate against the line outcome) is still valid
and can be revisited — but it is not on any roadmap.

### Decision for a future session

Build the Model Backtest half (fully unblocked, no new data) as its own page whenever there's room for it.
Value Bets Backtest is not being pursued (see above).
