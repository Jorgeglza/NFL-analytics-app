# Implementation Log

Status legend: ☐ not started · ◐ in progress · ✅ done · ⛔ blocked

## Roadmap

### M0 — Scaffold ✅
- ✅ git init, folder structure, .gitignore, README, CLAUDE.md, this log
- ✅ docs: known-issues, logic-reference, page-mapping, data-contracts, pipeline-runbook
- ✅ Vite app scaffold, GitHub Actions workflows written (not yet pushed/enabled)

### M1 — Pipeline parity ✅ (with documented caveats)
- ✅ `pipeline/nfl_pipeline/` modules (config, fetch, transform, grading, contributions, db, export_json, parity)
- ✅ venv `pipeline/.venv`; pins in requirements.lock.txt (pandas 3.0.0, numpy 1.26.4, sklearn 1.8.0 = pda-ie env; nfl_data_py installed --no-deps due to pandas<3 pin)
- ✅ `--stage all` end-to-end: 6003 team-weeks, 73900 player-weeks, 5662 grades, sqlite 35MB, JSON extracts all <2MB gz except player_week/2025 (1.1MB gz; nflreadpy has more cols — prune later if needed)
- ✅ parity vs old parquet: completed seasons (2015–2024) match exactly; in-progress 2025 excluded (nflverse restates stats weekly, old cache is stale snapshot). Duplicate (season,week,team) phantom rows exist upstream in BOTH frames — parity sorts on extra cols to compare deterministically.
- ⚠️ grades parity vs model_results.pkl: SKIPPED — old pkl unpicklable under pandas 3 (written by pandas 1.x; even the old app can't load it anymore). Parity relies on verbatim port + pinned sklearn. If exact confirmation needed: recompute grades inside `pda-ie` env from old code and diff.
- Compatibility fixes (behavior-preserving, documented): nflreadpy 2025 frame now ships game_id/game_type → dropped in fetch.py before schedule merge; pandas 3 groupby.apply drops keys → ranks computed via per-column groupby.rank (identical output).

### M2 — TS data layer + shared logic ✅ (zod schemas deferred)
- ✅ Vite + React + TS + Tailwind v4 + ECharts + TanStack Table + react-router (HashRouter for static hosting); `npm run build` green
- ✅ `src/lib/data/loader.ts` (compact column format), `src/lib/team/meta.ts` (colors/logos/WCAG)
- ✅ `src/lib/logic/`: winType, wilson, spreadBins, moneyline, probBlend, edgeComposite, gameId, ranks
- ✅ Vitest golden-fixture tests: `app/src/lib/logic/logic.test.ts` + `__fixtures__/golden.json` (fixtures generated from Python/numpy replicas of the old formulas — wilson, winType, moneyline, grade logistic/blend, polyfit slopes, edge composite, spread buckets, rank helpers). 42 tests green via `npm test`.
- ☐ zod schemas (loader currently returns untyped records) — deferred; not needed for parity

### M3 — Page-by-page parity (order = simplest data first)
- ◐ Home (functional; final design in M4)
- ✅ /game_analysis/game_picks — rewritten to match the old layout: win-type-tinted table rows, manual-winner checkboxes for unplayed games (localStorage `gamePicks.manualWinners`), counts bar with count/% labels + grey "No result yet" bucket, spread-by-win-type scatter with ×N collision markers. Week-18 2025 win-type counts verified vs the pipeline's Win Type column (9/3/3/1).
- ✅ /game_analysis/win_types — Season/Week toggle, per-block KPIs + stacked win-type bar (count|% labels, dashed Home-Favorite line) + spread scatter with ×N collision markers. Numbers verified vs pandas replica of old logic: KPIs exact on 4 seasons + 3 weeks; category counts exact for 2024 (season & week 1). Old-page quirks preserved (played pick'em → Underdog; played ties → "(No Score)" buckets; tie games count in win-% denominators).
- ✅ /game_analysis/spread_win_percentage — filters (multi season/week, win types, bin size, signed/abs, min-N, CI), 6 KPIs, calibration/stacked/heatmap/lift charts, bucket table, Weekly Picks panel. KPIs + bin aggregates + Wilson p̂ verified exact vs pandas replica. Grid-aligned buckets replace pd.cut edges (deviation: pandas silently dropped a game whose |spread| hit the exact top edge; we keep it).
- ✅ /data/grading_model (Season, Teams, Weekly, Features tabs) — contributions via contrib_params.json (weekContributions in lib/logic/contributions.ts). Weekly tab KPIs/rank/Z/percentile and Teams-tab avg scaled contributions (DAL 2025) verified exact vs pandas replica; season averages match.
- ✅ /game_analysis/team_comparison — 3-column layout, Prev/Total/Avg rows + squashed rank bars, substats, grades boxes, trend/matchup side charts. SF/CIN 2025 verified vs pandas (note: turnover_margin_rank is null in pipeline data → "--", faithful).
- ✅ /game_analysis/scorecards_teams — playstyle donuts + sparkline cards. DAL 2025 verified.
- ✅ /game_analysis/matchup_previews (Week Preview, Matchup, Model Overview tabs) — shared engine in pages/game-analysis/previews/engine.ts (hist market rate w/ per-week exclusion via count subtraction, grades index, trend features). CAR@TB 2025 wk18 bundle verified exact vs Python replica (blend 45%, trend 46%, ML 42%, avg 44%). Model Overview computes all games client-side (~2s) instead of the planned model_overview.json export.
- ✅ /player_analysis/prop_bets_players — pivot + set-line + player bar/donut. ARI 2025 passing_yards totals verified vs pandas.
- ✅ /player_analysis/build_parlay — multi-leg cards, hit-rate rings, product expected prob/odds. Brissett 250-yd leg (8/14=57%) verified. Quirks kept: Week dropdown unused in calc; player list ignores season_type.
- ✅ /player_analysis/player_team_stats — division-ordered team cards, top-5 players, shared x-axis.
- ✅ /player_analysis/matchup_bets — mismatch edges from carry-forward ranks (best edge CAR@TB wk18 = 52.0 verified), team totals, opponent allowed & rank chart, player pivot + detail. Deviation: browser-local tz for default week (not America/Monterrey).
- ✅ /player_analysis/value_bets — to-date-mean ranks, top-N mismatches (wk1 2025 receiving_yards: best 31, avg 27.0 verified), rank-comparison chart with logos + score labels, above-avg-highlighted player pivot, helper scatter.

**M3 page list complete** — all 12 pages + Grading Model tabs ported and number-checked.
Per page: run old app side-by-side (`pda-ie` env), match tables/KPIs/chart series on ≥3 filter combos (incl. unplayed games, week 1, multi-season). Log deviations in page-mapping.md.

### M4 — UI modernization (zero logic changes) ◐
- ✅ Route-level code splitting (React.lazy + Suspense) and vendor chunking (echarts/react) — initial JS ~15 kB + 164 kB react chunk; ECharts loads per page (was one 1.2 MB bundle).
- ✅ Shared `components/Loading` spinner applied to every page (replaces blank screens / ad-hoc text).
- ✅ `app/tsconfig.tsbuildinfo` untracked + gitignored.
- ✅ Design-system pass across all pages (zero data changes): shared UI kit in `components/ui.tsx` (Card, Kpi, Segmented, Chip, FilterBar, inputs) matching the navbar/home language — rounded-2xl white cards on slate-200 borders, navy #002f6c accents (h1 accent bars, KPI top-borders), uppercase micro-labels, unified pill segments/tab bars, consistent table headers (slate-50, tracking-wider). Verified per route via DOM audit (no legacy `rounded-xl`/old theads remain) and KPI spot checks (Weekly tab stats + Game Picks wk18 counts unchanged).
- ☐ Optional: screenshot-based visual QA (browser pane screenshot capture currently times out on this app).
- ◐ **UX audit — per-page items (§1–13) done; Cross-Page/Global items (bottom of `UX_AUDIT.md`) mostly open.** See "M4 cross-page/general audit items" note below (2026-07-20) for the itemized status and the still-missing list carried into `UX_AUDIT.md`'s "What's still missing" section.

### M3.5 — New analytics beyond old-app parity (not ports) ✅
- ✅ /game_analysis/power_rankings — composite of Elo + season-to-date Overall Grade + Pythagorean win% (`lib/logic/powerRankings.ts`), any-week filter, movement vs. prior week, rank-trend chart.
- ✅ /game_analysis/team_trends — weekly grade/stat trajectories, up to 3 teams (`pages/game-analysis/team-trends/shared.ts`).
- ✅ /game_analysis/season_outlook — Strength of Schedule (played vs. remaining opponent Elo) + Playoff Probability (2,000-iteration Monte Carlo, simplified tiebreaker) tabs (`pages/game-analysis/season-outlook/shared.ts`, `lib/logic/playoffSim.ts`).
- Deferred: Model Backtest + Value Bets Backtest — scoped but not built, see `docs/FUTURE_DEVELOPMENT.md` (blocked on historical prop-line data for the value-bets half).

### M5 — Deploy + automation
- ✅ `.github/workflows/weekly-refresh.yml` (cron Tue 12:00 UTC + dispatch → pipeline → validate → auto-commit → explicit `gh workflow run deploy.yml` — GITHUB_TOKEN commits don't fire push triggers)
- ✅ `.github/workflows/deploy.yml` (build → GitHub Pages, SPA fallback + Vite `base`) — live since Session 1
- ✅ Dynamic season range: `config.SEASONS = range(2015, current_season()+1)` (rolls to the new season each September); `fetch_weekly` skips the newest season with a warning if unpublished; `validate` asserts 2015→current (one-season grace)
- ◐ First end-to-end weekly-refresh run verified via workflow_dispatch

## Session notes (newest first)

### 2026-07-20 — Session 8 (cont.): Pythagorean split-bar, heatmap now starts at the selected week
Two direct follow-up requests:

- **Pythagorean section — split bar instead of a line chart**: the cumulative win% line chart didn't add much
  (the number was already shown elsewhere and the trend wasn't the point). Replaced with a
  `PythSplitBar` — a two-segment pill sized by `pythPct` (points-for side vs. points-against side, each
  labeled with the actual cumulative score), a "win share" badge, and a compact scrollable per-week game log
  (opponent, home/away, W/L, score) below it, reusing the `weeklyGrades` opponent/score fields already computed
  for the Grade card rather than adding new data. This directly answers "what's the score to date that produces
  this number" instead of a trend nobody asked for. Removed the now-unused `weeklyPyth`
  cumulative-per-week array and its `WeeklyPythDetail` type from `lib/logic/powerRankings.ts` — nothing else
  consumed it. Verified in pane: Rams wk10 shows 251/153 split, 76.4% win share (matches the table), and a
  9-row game log (Wk1 vs HOU W 14–9 … Wk10 @ SF W 42–26) that sums to the same 251/153.
- **Season Outlook heatmap — starts at the "as of" week, not week 1**: `computeOpponentHeatmap()` gained a
  `fromWeek` param and now filters games to `week >= fromWeek` before building the grid, so viewing week 10
  shows week 10 onward as the first column (the road ahead, matching the "Remaining strength of schedule"
  section right below it) instead of the whole season. Row sort (hardest first) is now based on the average
  over just the visible/filtered weeks rather than the full season. Heading updated to "Opponent difficulty,
  week {week} onward." Verified in pane at week 10 (heading correctly reads "week 10 onward") and at the
  week-18 edge case (single remaining column, no crash, no console errors).
- Tests unaffected (58/58 still green — this round was UI/derivation-parameter changes, not new pure-logic
  branches needing new tests). `npm run build` and `tsc --noEmit` clean.
- Not committed/pushed at time of writing this entry — commit only when the user asks.

### 2026-07-20 — Session 8 (cont.): Popup charts, opponent heatmap, nav reorder for storytelling
Follow-up round of direct user requests on the pages from earlier this session.

- **Power Rankings popup — charts + responsive width**: `components/Modal.tsx` gained a `wide` prop (grows up to
  `xl:max-w-6xl` instead of a fixed width) so the popup can lay out 2 columns on large screens. `DetailModal.tsx`
  now renders 4 ECharts instances instead of static text: a per-week Grade bar chart (tooltip shows that week's
  opponent/home-away/score alongside the grade), a cumulative Pythagorean win% line (tooltip shows the exact win
  share and points), and a Composite line comparing the team against the **league average** each week, plus the
  existing rank-evolution chart. `lib/logic/powerRankings.ts`'s `computeTeamBreakdown()` gained
  `weeklyGrades[].opponent/home/teamScore/opponentScore`, `weeklyPyth[]` (cumulative win share per week), and
  `weeklyComposite[]` (`{week, composite, leagueAvg}`, the league average computed the same way
  `computeTeamRankTrend` already recomputes rankings per week). Verified in pane: modal width 1152px on a
  1280px viewport (vs. previously fixed at ~672px), 4 canvases render, all breakdown numbers still match the
  table exactly (Rams wk10: composite 96.5, Elo 1650, grade 64.4 avg of 9 weeks, pyth 76.4% from 251–153).
- **Team Trends — Composite/Elo/Pyth metrics**: `team-trends/shared.ts` added a `power` metric source
  (composite/elo/pythPct, not real frame columns — computed via `computePowerRankings` per week and passed in as
  a precomputed `Map<week, PowerRankingRow[]>` so switching teams/metric doesn't re-run the ranking) and put
  these 3 metrics first in `METRICS`, making Composite Score the default metric everywhere (satisfies "default
  on composite" without needing a separate deep-link special case). `composite`/`pythPct` are stored 0-1 in
  `PowerRankingRow`, so `MetricDef` gained an optional `scale` (100 for those two) for readable axis values.
  Verified: Compare-ing the Rams from Power Rankings lands on Team Trends already showing Composite Score,
  values matching Power Rankings exactly week by week (wk10: 96.5).
- **Season Outlook — opponent-difficulty heatmap**: new first chart in the Strength of Schedule tab, above the
  existing remaining-SOS bar (which now colors each bar by the team's own color instead of flat navy).
  `season-outlook/shared.ts`'s `computeOpponentHeatmap()` builds a teams × weeks grid (rows sorted hardest
  average schedule first) directly from `buildEloIndex`'s per-game pre-game ratings (whole-season view,
  intentionally not `throughWeek`-scoped, unlike the SOS table below it). `HeatmapChart.tsx` is a new ECharts
  `custom` series (a plain `heatmap` series can't draw a logo per cell) — each cell renders a colored rect
  (green→yellow→red by opponent Elo), the opponent's logo centered, and the opponent's Elo rating as a small
  number in the bottom-right corner. Verified in pane: heatmap renders above the SOS bar chart with the stated
  caption; confirmed the canvas actually drew the cross-origin logo images (not just left them blank) via the
  browser correctly throwing a `SecurityError: canvas tainted by cross-origin data` on a pixel-readback probe —
  that error can only happen if an image was actually drawn to the canvas.
- **Game Analysis reorder + rename**: `nav.ts` reordered to tell a story — Game Picks → Win Types → Matchup
  Previews → Power Rankings → Team Comparison → Team Scorecard → Spread Win Percentage → Season Outlook (was
  previously Power-Rankings/Season-Outlook-first from when those were freshly added, then the original 6 ported
  pages). "Scorecards Teams" renamed to "Team Scorecard" (nav label + page `<h1>` + tab title; route/path left
  as `/game_analysis/scorecards_teams` since `TeamComparison.tsx` links to it directly). Added a one-line
  flow hint to each page: for the 6 pages that only ever had a bare `<h1>` (Game Picks, Win Types, Matchup
  Previews, Team Comparison, Team Scorecard, Spread Win Percentage) the hint is a `title` attribute on the
  heading — a native hover tooltip, deliberately invisible until hovered per the ask for "nothing obvious;" for
  Power Rankings and Season Outlook, which already had a visible `PageHeader` subtitle, a short clause was
  appended to the existing subtitle instead. No existing explanatory copy was rewritten. Verified: nav/Home show
  the new order (8/8 available), `Team Scorecard` label everywhere, and each page's `<h1 title="...">` hover
  text confirmed present in the DOM.
- **Tests**: no new pure-logic behavior needing golden/self-consistency tests beyond what Session 8's earlier
  entry already added — this round was UI/chart/ordering work. 58/58 tests still green, `npm run build` and
  `tsc --noEmit` clean.
- Not committed/pushed at time of writing this entry — commit only when the user asks.

### 2026-07-20 — Session 8 (cont.): Power Rankings team popup, Team Trends → Compare-only, Season Outlook backtesting
Three direct user requests on the pages just shipped:

- **Power Rankings — team detail popup**: clicking any row opens a new `components/Modal.tsx` (first modal in the
  app — overlay + scrollable panel matching the `ui.tsx` card language, Esc/backdrop close) showing
  `power-rankings/DetailModal.tsx`. `lib/logic/powerRankings.ts` gained `computeTeamBreakdown()` (that week's
  actual game score, both teams' pre-game Elo, HFA/K/MOV-multiplier/rating-delta, the full weekly-grade list
  feeding the season-to-date average, cumulative points for/against feeding the Pythagorean win%, and the
  min-max normalization range/value for all three signals) and `computeTeamRankTrend()` (the rank-evolution
  chart, now inside the popup instead of a separate always-visible section). The breakdown reuses
  `computePowerRankings`'s own row for the final composite/elo/grade/pyth numbers rather than recomputing them,
  so the popup can never disagree with the table. Verified in pane on Seattle 2025 wk18: Elo pre-game 1686 →
  post-game 1707 (matches table), grade average 62.5 over 17 weeks (wk8 correctly missing — bye week), points
  483 for/292 against → 76.7% Pythagorean (matches table), normalized (100%, 88.9%, 100%) average = 96.3 =
  displayed composite exactly.
- **Team Trends — Compare-only access**: removed from `nav.ts` (`NAV_GROUPS`) entirely (so it's off both the
  navbar and Home's launchpad, per the ask), route kept alive in `App.tsx` as a hidden `<Route>` (same pattern as
  Glossary/Models Guide/Matchup Bets). Power Rankings gained a small "Compare" link per row
  (`?team1=<team>`), and `TeamTrends.tsx` now reads `team1`/`team2`/`team3` from the URL once on mount — fixed a
  bug where only passing `team1` still fell back to the DAL/SF defaults for team2 (the `deepLinkApplied` ref was
  wrongly pre-seeded from `searchParams` before the effect ran); now team2/team3 correctly default to "— none —"
  unless also present in the URL. Team line colors now use each team's real color (`meta.color`) instead of a
  fixed 3-color palette, with a small ECharts scatter series per team (`symbol: image://<logo>`, silent, no
  legend/tooltip) placing that team's logo at the last plotted week. Verified: Power Rankings → Compare on
  Seattle lands on Team Trends with only SEA selected (not SEA+SF).
- **Season Outlook — backtestable week selector**: page now uses the shared `useSeasonWeek()` context for both
  season and week (defaults to the current week app-wide) instead of a season-only local state, with the same
  Week selector + prev/next steppers as Power Rankings. Both tabs take a `throughWeek` and split games by
  `week <= throughWeek` (backtest "as of") rather than by whether a score happens to be present — critical
  because the underlying data has every 2025 game already played, so a naive played/unplayed split couldn't
  backtest anything. Discovered and fixed a leakage bug while doing this: naively reusing `buildEloIndex`'s
  chronological per-game ratings for "remaining" games after `throughWeek` would silently incorporate real
  results from games between `throughWeek` and that game (since the index is built over the *entire* real
  schedule) — fixed by freezing every team's Elo rating *as of `throughWeek`* (`eloAsOf` from `powerRankings.ts`,
  now also imported by `playoffSim.ts` and `season-outlook/shared.ts`) and using that frozen rating for every
  remaining-game win probability, documented as a simplification (a team's strength doesn't evolve mid-sim; true
  week-by-week Elo update during the Monte Carlo loop would be more accurate but is out of scope). Verified in
  pane: backtesting 2025 at week 10 (vs. the actual week-18 finish) produces genuine probabilistic playoff odds
  (e.g. Eagles 99.8%, Vikings 13.5%, not the deterministic 100/0% seen when backtesting at the actual final
  week) and correct played/remaining SOS splits (9-10 played / 7-8 remaining per team at week 10 vs. 17/0 at
  week 18).
- **Tests**: `newAnalytics.test.ts` gained a `throughWeek backtesting` block — confirms a game that's actually
  completed in the data but falls after `throughWeek` gets simulated (not read from its real score), and that
  the real result is used once `throughWeek` reaches it; plus a `computeStrengthOfSchedule throughWeek` test
  confirming a game moves from remaining to played as `throughWeek` advances past its week. 58/58 tests green,
  `npm run build` and `tsc --noEmit` clean.
- Not committed/pushed at time of writing this entry.

### 2026-07-20 — Session 8: Power Rankings, Team Trends, Season Outlook (new analytics, not ports)
User asked what's missing from the rebuild for a more complete/robust analysis app. Since the rebuild had already
reached full parity with the old app (every page ported, per `docs/page-mapping.md`), this was scoped as new
analytics beyond the old app's feature set — narrowed via AskUserQuestion to team-level trends/rankings,
season outlook/simulation, and betting/model performance, using only data already in the pipeline (no new
ingestion). User picked 3 pages to build, ordered as a narrative arc (current state → trajectory → outlook), and
deferred the betting page to `docs/FUTURE_DEVELOPMENT.md`.

- **Shared prep**: `lib/logic/elo.ts` gained `scheduleToEloGames()` (schedule rows → chronological Elo game
  records, now shared by `previews/engine.ts`'s `buildScheduleEloIndex` instead of a duplicated inline mapper)
  and `buildEloRatingHistory()` (post-game rating per team per game — `buildEloIndex` only exposed pre-game
  win probabilities, but the new pages need a team's *current* rating).
- **Power Rankings** (`pages/game-analysis/PowerRankings.tsx`, `lib/logic/powerRankings.ts`): composite score =
  mean of min-max-normalized {Elo rating as of the selected week, season-to-date avg Overall Grade, Pythagorean
  win% from cumulative REG points for/against}, equal weights, missing signals skipped rather than zeroed (e.g.
  week 1 has no grade yet). Any-week filter (not just current), movement vs. prior week, rank-trend chart per
  team. Verified in pane on 2025 wk18 (fully completed season): rank 1 = Seahawks (composite 96.3, Elo 1707,
  matches being the top Elo/grade/pyth team), ranks form a clean 1–32 permutation, movement arrows present from
  week 2 onward.
- **Team Trends** (`pages/game-analysis/TeamTrends.tsx`, `team-trends/shared.ts`): weekly line chart + table for
  up to 3 teams, metric picker spanning `grades.json` (Overall/Offensive/Defensive Grade) and a curated
  `team_week` subset (points, points allowed, point margin, total yards for/against, turnover margin, EPA
  differential) — both sources already loaded elsewhere in the app, just never charted as a time series.
  Verified: DAL vs. SF Overall Grade by week for 2025 renders correctly (including a real gap at DAL wk10 —
  bye week, `—` not a bug).
- **Season Outlook** (`pages/game-analysis/SeasonOutlook.tsx`, two tabs): **Strength of Schedule**
  (`season-outlook/shared.ts`) — average opponent pre-game Elo, split played vs. remaining, using
  `buildEloIndex`'s existing per-game entries directly (leak-free by construction, no new logic needed).
  **Playoff Probability** (`lib/logic/playoffSim.ts`) — 2,000-iteration Monte Carlo, each remaining game's winner
  drawn from Elo `pHome`; a documented **simplified tiebreaker** (win% → head-to-head when lopsided → conference
  record → played-games point differential — not the full NFL rulebook: no strength of victory/schedule, no
  common-games rule) determines division winners (seeds 1–4) and wildcards (seeds 5–7) per conference. Verified
  in pane on 2025 (fully completed, so the sim is deterministic — 0 remaining games): 7-team playoff field per
  conference, Seahawks/Patriots as the 1-seeds match Power Rankings' top teams, playoff % correctly 100/0 with
  no in-between values (nothing left to simulate). Since no season in the dataset has games still remaining, the
  "games remaining" code path was verified via unit tests instead (see below) rather than in the live pane.
- **Tests**: new `lib/logic/newAnalytics.test.ts` (self-consistency checks, not golden fixtures — no Python
  replica exists for genuinely new analytics) — Power Rankings produces a complete rank permutation and no
  movement at week 1; Playoff Sim on a fully-played synthetic 8-team/4-division league deterministically seeds
  all 4 division winners plus the 3 closest wildcard losers by point differential, excludes the blowout loser,
  keeps every seed in 1–7, and (with one added unplayed game) produces genuine 0–1 probabilities instead of
  crashing. 55/55 tests green, `npm run build` and `tsc --noEmit` clean.
- New nav entries registered first in "Game Analysis" (Power Rankings, Team Trends, Season Outlook) ahead of the
  existing pages, so the nav order itself reads current-state → trajectory → outlook.
- Not committed/pushed at time of writing this entry.

### 2026-07-20 — Session 7 (cont.): Player Team Stats slider + leaderboard drill-down, Team Comparison zero-cue
Four direct user requests:

- **Player Team Stats week filter**: the two separate full-width `<input type="range">` bars (confusing — looked like duplicated controls) replaced with a new shared `components/RangeSlider.tsx` — one visual track, two thumbs, standard overlapping-native-inputs technique (`index.css` adds the `.range-thumb` pseudo-element rules: track hidden, only the thumb is interactive/visible). Reusable for any future start/end range filter.
- **League leaders hover + click-through**: each leaderboard row is now a button with a title tooltip showing `{player} — {value} ({pct}% of {team}'s team total) — click to jump to {team}` (the `pct` field already existed per-player from the team-total computation, just wasn't threaded through to the flattened leaders list). Clicking scrolls to that team's card below, reusing Win Types' jump-then-350ms-re-correction pattern (cards are lazy-mounted, so the placeholder height briefly differs from the real one). Each team card grid cell gained a stable `id="teamcard-{team}"` wrapper (outside `LazyMount`, since LazyMount's placeholder-vs-mounted DOM shapes differ and neither reliably carries an id on its own).
- **Team Comparison — reviewed the turnovers-allowed data**: fetched `team_week/2025.json` directly and cross-checked interceptions-allowed/turnovers-allowed sums against the page's displayed Total/Avg/Last for CAR and league-wide — the pipeline data and the page's aggregation are both correct (e.g. CAR interceptions-allowed sums to 15 across 17 games, matching the page exactly; only NYJ has a genuinely unusual season, 0 interceptions allowed all year — a real result, not a data gap, confirmed via `nullIntA: 0`). No pipeline or aggregation bug found. What *was* worth fixing: a true zero (data present, value 0 — e.g. "0 interceptions allowed last week") rendered identically to a normal number, easy to mistake for a glitch next to the low counts these stats naturally have. `StatCells`' `pill()` now takes the raw numeric value alongside the formatted string and gives confirmed zeros a distinct dashed border + muted italic styling + an explicit "confirmed zero (data present, not missing)" tooltip — applied uniformly to Last/Avg/Total across every stat and substat on the page.
- Verified in pane: dual-thumb slider renders with correct min/max/aria-labels; leaderboard tooltips show the exact wording with team %; click correctly calls `scrollIntoView` on the right `teamcard-{team}` element (confirmed via a monkey-patched `scrollIntoView` — the browser pane's headless environment doesn't animate `behavior:"smooth"`, a known pane limitation also affecting the pre-existing "Jump to division" feature, not a functional bug — `behavior:"instant"` scrolled correctly when tested directly); Team Comparison's zero-cue pills render with the dashed/italic/tooltip treatment on Turnovers Allowed → Interceptions Allowed's substats. Build green, 49/49 tests green.
- Not committed/pushed at time of writing this entry — committed separately, see below.

### 2026-07-20 — Session 7 (cont.): Game Picks cross-links, PropBets defense-stat fix, Parlay reset fix, Home glossary link
Four direct user requests, all verified in pane:

- **Game Picks cross-links**: new "Zoom in" table column, two small circular icon links per row — ⚔️ to Matchup Previews' Matchup tab (`?tab=matchup&season=&week=&game=`) and 🆚 to Team Comparison (`?season=&week=&team1=<away>&team2=<home>`). Team Comparison gained incoming `team1`/`team2`/`season`/`week` URL param support (mirrors the existing `pendingWeekRef` pattern; skips its own random-matchup effect entirely when deep-linked with explicit teams). Verified: link hrefs correct per row, clicking through lands Team Comparison on the exact season/week/teams from the row.
- **Prop Bets — random defense stat on first click only**: new `randomDefenseStat()` in `statPicker.ts`; a `defenseRandomizedRef` (one-shot per page load) fires only the *first* time the Defense toggle is clicked, picking a random curated defense stat instead of falling through to whatever column happens to sort first. Toggling back to Offense and then Defense again does not re-randomize (verified: same stat, "Def QB Hits", on both visits).
- **Parlay Builder — reset now re-randomizes the team**: root cause was that `LegCard`'s one-shot team-randomization ref survives across a reset (same React key ⇒ same component instance ⇒ ref already fired), so reset silently fell back to the alphabetically-first team. Fixed by keying `LegCard` on `${resetGen}-${i}` and bumping `resetGen` on every reset, forcing a real remount. Verified: three consecutive resets produced three different teams (HOU → JAX → CIN).
- **Home page glossary link**: new standalone `/glossary` route (`pages/GlossaryPage.tsx`, not in the navbar — same "hidden route" pattern as Models Guide) rendering the full shared glossary. Footer link added to the bottom of Home ("📖 Glossary — win types, stats & betting terms explained").
- Build green, 49/49 tests green throughout.
- Not committed/pushed at time of writing this entry — committed separately, see below.

### 2026-07-20 — Session 7 (cont.): ties get their own category (Win Types + Spread Win %)
User feedback on last session's tie fix: don't count ties as a favorite loss — give them their own category and exclude them entirely from every win-rate percentage on both pages. Confirmed via AskUserQuestion: exclude ties from the denominator (not just relabel), applied to both Win Types and Spread Win %.

- **Win Types** (`WinTypes.tsx`): `Category` gains an 8th value `"Tie"` (purple `#9333ea`), split out of the previous "(No Score)" buckets which conflated ties with genuinely unplayed games — `classify()` now checks `hs === as_` explicitly before falling through to the winner-null branch. `kpis()` and `splitKpis()` now exclude `category === "Tie"` from their populations (Favorite Win % / Home Win % / the home-vs-away split), so a tie no longer silently counts as a favorite loss. Glossary entries and in-page captions updated to match ("(No Score)" now means unplayed only).
- **Spread Win %** (`SpreadWinPct.tsx`): reverted last session's "ties count as a loss" change — `df` (already excludes ties via `winType != null`) now also feeds the headline KPIs directly (no more separate ties-inclusive `dfRate`), the verdict tiers require `winType != null` again, and Weekly Picks' historical population (`histPlayed`) matches `df` exactly. All four surfaces (KPIs, verdict, category charts/bucket table, Weekly Picks) now share one ties-excluded population.
- Verified in pane: fetched `schedule.json` directly and independently computed 2025 REG "Favorite Win %" (271 non-tie games, 1 tie correctly excluded from the denominator) → 65%, exactly matching both pages' displayed KPI and N. Build green, 49/49 tests green.
- **Matchup Bets default-week dedupe** (user follow-up, same session): confirmed the "browser-local time" default week is correct by design (`Date.now()` is a timezone-agnostic instant, not actually region-dependent) but was a copy-pasted duplicate of `defaultWeekNearToday()` from `previews/engine.ts`. Replaced the local computation with the shared import — zero behavior change, one less duplicate implementation to keep in sync. Verified deep-link still resolves correctly (`?season=2025&week=18&game=2025_18_KC_LV`); MatchupBets' bundle shrank slightly (20.19→20.10 kB) confirming it now shares the `engine` chunk instead of carrying its own copy.
- Explained but declined for now: color-blind-safe (non-color) encoding for win-type categories on Win Types/Spread Win % — user wants the explanation on record, not implemented this session.
- Not committed/pushed.

### 2026-07-20 — Session 7 (cont.): Prop Bets + Parlay Builder — full team names, randomized starting point
User request (not from the audit — direct ask): make Prop Bets and Parlay Builder's team dropdowns show full names for easier keyboard search, start both pages on a random team + random Passing/Rushing/Receiving stat (also re-randomized per new Parlay leg), keep defaulting to the top player for that stat, and drop Parlay Builder's inert Week control entirely (previously flagged in the audit as a control that visibly does nothing).

- `statPicker.ts`: new `randomItem<T>()` and `randomPassRushRecStat()` (random pick across Passing+Rushing+Receiving, excludes Fantasy) shared by both pages.
- **Prop Bets**: Team select now shows full names (`getTeamMetaMap()`, same convention as Scorecards/Team Comparison/Grading Model Teams tab — those three already did this; only Prop Bets and Parlay Builder were missing it). Starting team is now randomized once its team list loads (ref-guarded, one-shot); starting stat is a random Passing/Rushing/Receiving stat instead of always "Passing Yards" (skipped when deep-linked via `?team=`/`?stat=`). Player selection now resets to the stat's top player (already the existing sort-by-total default) whenever team or stat changes, not just on first load.
- **Parlay Builder**: same team-full-name + random-team + random-stat treatment per `LegCard` (each leg randomizes its own team independently once loaded). Clicking "+" now builds a genuinely new leg (random team, random stat, blank player) instead of duplicating the leg it was added from — previously identical legs were the norm. Removed the `Week` field from `Leg`, the dead `weeks` computation, and the Week `<Select>` — it never affected the calculation (documented old-app quirk) and existed only as a red herring; simpler to remove than keep explaining.
- Verified in pane: Prop Bets team select shows "Arizona Cardinals" etc. as options; reloading a few times shows different starting team/stat each time (confirmed MIN/interceptions vs SF/rushing_yards across reloads); Parlay Builder shows no Week control, starts on BAL/targets/Zay Flowers (BAL's target leader), clicking "+" added a second leg on LA/carries/Kyren Williams (LA's carries leader) — a fresh random leg, not a duplicate. Build green, 49/49 tests green.
- Not committed/pushed.

### 2026-07-20 — Session 7 (cont.): implemented most of the "still missing" list
User picked off 6 of the 7 items from the prior status audit. Build green, 49/49 tests green throughout.

- **Home "this week" launchpad**: new `lib/logic/defaultWeek.ts` (`currentWeek(schedule)`) extracts Game Picks' existing default-week rule (earliest in-progress week, else last completed REG week) into one shared helper. Home now loads `schedule.json` and renders a "This week" card in the hero (week/season, game count, date range, up to 6 matchups) with a "See this week's picks →" button linking to `/game_analysis/game_picks?season=&week=`. Game Picks now reads `useSearchParams` and trusts season/week from the URL when present, falling back to `currentWeek()` otherwise (and now uses the shared helper instead of its own inline copy).
- **Unified glossary**: new `lib/glossary.ts` (win-type categories + Passing/Rushing/Receiving/Fantasy/Defense/Advanced stat definitions, sourced verbatim from nflverse's own `nflreadr` data dictionaries — `dictionary_playerstats.csv`/`dictionary_playerstats_def.csv`, scraped from GitHub 2026-07-20 — plus authored Betting & Model Terms) and a shared `components/Glossary.tsx` (searchable, sectioned panel). Win Types' toggle panel and the Grading Model Features tab's "Not sure what a stat means?" callout (previously an external link to nflverse's docs site) both now open the *same* embedded glossary — single source of truth, no more offsite link.
- **Team Comparison cross-links + random default matchup**: each team column gained "Matchup preview →" (only shown when that team plays this selected week; links to Matchup Previews' Matchup tab prefilled via new `?tab=&season=&week=&game=` params) and "Scorecard →" (`?season=&team=`) links — the "explicitly deferred" gap is closed. `MatchupPreviews.tsx` now reads `?tab=` to open directly on a given tab; `MatchupTab.tsx` and `Scorecards.tsx` now read `useSearchParams` to seed their own season/week/game or season/team state (same convention as the Value Bets/Matchup Bets/Prop Bets trio). Team Comparison also now defaults team1/team2 to a **random real matchup from the current week** (away = team1, home = team2, re-randomized every fresh page load, not persisted) instead of the hardcoded SF/CIN — uses `currentWeek()` + a `pendingWeekRef` so the randomized week survives the existing "reset week to last available on season change" effect.
- **Spread Win % ties inconsistency (user-reported, root-caused)**: found the actual bug behind "the numbers don't add up around ties" — `Game.played` excluded tie games entirely from the headline KPIs/verdict tiers (`winType` is null for a tie, and the old filter required `winType != null`), while Weekly Picks' historical rate calc used a different, unaligned population (`scored`, ties included) that also didn't exclude pick'ems consistently. Win Types' `kpis()` — independently parity-verified — documents the actual old-app rule: ties count in the denominator as a favorite loss, pick'ems (no favorite) are excluded outright. Redefined `played` to include ties; added `dfRate` (ties always count, pick'ems excluded, win-type filter still scopes real categories) feeding the headline KPIs and verdict; aligned Weekly Picks' `histPlayed` to the same population. The category-based charts (calibration/heatmap/stacked/lift, bucket table) were **not** touched — they still require a real win-type category, so ties stay out of them exactly as before (zero risk to their already-verified-exact-vs-pandas numbers). This does *not* explain cross-page disagreement between Spread Win % and Matchup Previews (different games, different models, in the example previously cited — expected behavior, not a bug) — that engine-disagreement callout was explicitly declined by the user this session.
- **Parlay Builder reset**: added a "Reset" button next to the KPIs that clears all legs back to a single default leg (and clears the stored hit-rate percentages) — verified in pane (added a 2nd leg, hit Reset, back to 1 leg with no remove button).
- **Explained, not implemented**: win-type color-only encoding (item 6 from the prior audit) — user asked what it meant rather than requesting a fix; left as-is pending a follow-up ask.
- Verified in browser pane: Home shows "This week / Week 18, 2025 — 16 games · Jan 2 – Jan 3" with working link; Game Picks deep-link (`?season=2025&week=18`) loads directly; Team Comparison defaulted to a real KC@LV matchup (team1=KC away, team2=LV home) with correct cross-link hrefs; clicking through landed on Matchup Previews' Matchup tab prefilled to the same game; Win Types' glossary toggle renders all sections (Win Types/Passing/.../Betting & Model Terms); Parlay Builder Reset confirmed clearing 2 legs → 1.
- Not committed/pushed.

### 2026-07-20 — Session 7: M4 cross-page/general audit items — status audit (no code changes)
User request: confirm all UX-audit implementations and best practices are actually in place before moving to next steps. The per-page audit sections (§1–13 of `docs/UX_AUDIT.md`) were already implemented page-by-page across Sessions 4–6 (logged above); the audit's **Cross-Page Review / Global Opportunities / Prioritized Summary** section (the "general notes") had never been checked off item-by-item. Did a code-level verification (not just re-reading old session prose) and annotated `UX_AUDIT.md` inline with ✅/◐/☐ status per item. Read-only session — no application code touched.

**Confirmed done:**
- Shared curated stat picker (`statPicker.ts`) across all 5 player pages + Grading Model Teams tab.
- Shared player-pivot pattern + "N of M, X%" hit-rate/implied-odds phrasing (Prop Bets, Parlay, Matchup Bets).
- Matchup Bets ↔ Value Bets ↔ Prop Bets two-step journey with param-carrying links (`useSearchParams`).
- LazyMount render-on-demand (Win Types, Player Team Stats); `overflow-x-auto` wide-table convention applied broadly (10 files incl. `components/ui.tsx`, Team Comparison, Model Overview pick matrix).
- Model Overview: confidence-band summary added, per-cell % moved to hover-only (`title` attr) — both audit asks done, grid itself kept.
- Turnover-null data fix at pipeline source; Scorecards value/label pairing fix; Win Types comparative KPI-trend view; Player Team Stats league-leaders strip + jump nav.

**Confirmed NOT done (still open, verified against current source, not just the log):**
- **Home page has no "this week" launchpad** — still a static hero + stat chips + nav-group cards, zero week-context banner or param-carrying links (`app/src/pages/Home.tsx`).
- **No unified glossary** — Win Types' in-page glossary panel and Grading Model Features tab's external-link glossary are two independent implementations.
- **No cross-reference between the two "who wins this week" engines** (Spread Win % Weekly Picks vs. Matchup Previews Week Preview) — can silently disagree, nothing tells the user.
- **Team Comparison has zero outbound links** — cross-links to Matchup Preview/Scorecards were explicitly deferred in Session 5 and are still missing (`grep Link|useNavigate` on `TeamComparison.tsx` = 0 hits).
- **No app-wide shared week/season context or single default-week rule** — only the Value Bets/Matchup Bets/Prop Bets trio shares params; Matchup Bets still uses browser-local tz for its default week (documented deviation, never resolved); Home/Team Comparison/Scorecards/Win Types/Spread Win %/Matchup Previews aren't wired into any shared context.
- **Win Types and Spread Win % remain color-only for win-type category** — no text/pattern redundancy (Spread Win %'s code comment explicitly flags and defers this rather than fixing it).
- **Parlay Builder doesn't persist across visits** (`grep localStorage` on `app/src` = only `GamePicks.tsx`) — inconsistent with Game Picks' manual-winner persistence; the inert Week control / season-type-ignoring player list are also still un-revisited "preserved quirks."

Full itemized breakdown (repeated components / overlapping objectives / disconnected journeys / global opportunities / data inconsistencies / prioritized summary, each tagged ✅/◐/☐) is inline in `docs/UX_AUDIT.md`, ending in a "What's still missing (quick list for next session)" section.

**Next:** pick off the still-missing list above before considering M4 UX-audit work complete. Suggested order: Home launchpad + shared default-week rule (biggest navigation win per the audit's own prioritization) → engine-disagreement callout → unified glossary → Team Comparison cross-links → win-type color-independent encoding → Parlay persistence/quirk decision.

### 2026-07-19 — Session 6 (cont.): Grading Model — audit §13 implementation + Features tab redesign
User request: apply the UX audit's Grading Model comments, clean up tab navigation, and modernize/reorder the Features tab to explain the model and what feeds into it.
- **Tab navigation** (nav ask + consistency with Matchup Previews): the 4-tab pill bar replaced with the same prominent card-tabs pattern (icon + name + one-line description, full-width row, selected = filled navy).
- **Season tab** (audit 🟡 "front door has no doorplate"): new intro card — 2–3 sentence plain-language explainer of how a grade is built (3 weekly-retrained Random Forest models → normalized/weighted stats → 0–100 rescale) plus a 3-chip Overall/Offense/Defense legend. Sourced from `pipeline/nfl_pipeline/grading.py` to stay accurate (defense inverts at the end rather than applying directionality, per the file's own docstring).
- **Teams tab** (audit 🟡/🟡): 
  - Curated stat picker — `Select Stat` now uses the shared `statPicker.buildStatGroups` (prop-market sections first, "Advanced / other" alphabetical below) instead of the raw ~130-item list; the "third naming variant" is gone (labels now go through `statLabel`, matching player pages).
  - "Avg" vs "Avg. Cont." ambiguity: headers renamed to "Avg (raw)" / "Avg. contrib. (pts)" with tooltips, and the caption spells out that they're different units.
  - Bye-week columns: driver table now shows every week 1→(through-week) instead of only weeks with a grade row, so a bye renders as an explicit "Bye" cell instead of the column silently disappearing (verified: BUF/DAL 2025 W10 bye now shows "Bye" across all driver rows; averaging divisor unchanged — still computed over played weeks only).
- **Weekly ↔ Teams cross-link** (ties audit's "isolation" note to the nav ask): season/team selection lifted from Teams tab into the page container; Weekly tab's ranked table gained a "Drivers →" link per row that jumps to the Teams tab pre-scoped to that team/season. Verified: clicking BUF in the Week 18 2025 ranking table opens Teams tab on "Buffalo Bills – Overall Grade Contributions... (2025)".
- **Features tab redesign** (explicit ask — "modernize... order it to achieve its goal of explaining the model and showing what goes into it"): reordered to explain-then-show — model explainer card → grade-type selector (`FilterGroup`+`Segmented`, matches the app's control-grouping convention) → Top-20 drivers (now horizontal bars, all 3 model series per stat, `statLabel`-formatted names instead of raw snake_case) → cumulative-importance chart with an 80%-of-weight reference line and one-line caption → glossary promoted from a dangling footnote sentence to an actual callout card with a button link → full 281-row table gains a live search-by-name filter (own `useMemo`, feature-name substring match on both raw and label). Colors switched to the shared hit/miss-adjacent red/blue pair for consistency with the rest of the app.
- Verified in pane (2025, Week 18/BUF/DAL): all 4 tabs render via card-tab clicks, Teams tab W10 bye shows "Bye" not a gap, Weekly→Teams jump lands with correct team/season, Features search "epa" filters the 281-row table to EPA columns only, 2 canvases paint on Features tab. Tests 49/49, build green. Not committed/pushed.

### 2026-07-19 — Session 6 (cont.): Value Bets — "What to Target This Week" overview
User request: a top-of-page section (below Season/Week) answering "what stats to target in which games" before picking one stat, plus move the Stat/Top-N controls down to the single-stat section they drive.
- Refactored the to-date-mean rank computation out of the `mismatches` memo into a standalone `statRankMaps(base, tw, w)` so it's reusable.
- New `weekOverview` memo scans `CURATED_STATS` (`PROP_MARKET_SECTIONS.offense + .defense` from `statPicker.ts` — same curated list used everywhere else, not the raw ~130 columns) across every game of the selected week, keeps each game's top 3 offense-vs-defense picks by score, and sorts games by their best pick.
- New "What to Target This Week" card renders one tile per game (logos, Zoom-in link, top-3 stat picks as buttons showing offense team / stat / defense team / score). Clicking a pick sets `stat` — the "Stat Detail" section below (now titled with the live stat name) reacts immediately, so the overview acts as an index into the rest of the page rather than a separate view.
- Moved the Stat select and Top-N slider from the page's top filter bar down to a new "Stat Detail — {stat}" row directly above the KPIs, per user's ask to put the dropdown next to what it drives.
- Verified in pane (2025 wk1): overview renders 16 game tiles each with 3 ranked picks (e.g. "IND Carries vs MIA +31"); clicking "CIN Def Tackle Assists" pick updates the "Stat Detail —" heading to "Def Tackle Assists" immediately. Tests 49/49, build green.

### 2026-07-19 — Session 6 (cont.): Matchup Bets page restructure (user feedback)
User feedback on the merged page: "Stat" at the top only affected some charts, the mismatch section (flat 8-chip list + two rank-bar echarts) didn't make sense, and the stat-comparison controls were far from what they drove. Reworked `MatchupBets.tsx` into the requested top-to-bottom order:
1. **Game selection** — Season/Week/Game only; Stat/Set line moved down to the section they actually drive.
2. **General KPIs / game info** — team logos + matchup name + gameday, Best Mismatch and Avg Edge KPIs.
3. **Biggest mismatches, grouped by category** — new `categoryOf()` buckets each mismatch base into Passing/Rushing/Receiving/Other; single-open accordion (`openCategory` state, resets to the top category on game change) replaces the old always-on `mmRanksOption`/`mmScoreOption` echarts pair (which had overlapping axis labels and near-identical bar heights — no longer legible). Each open category lists its stats as a plain-CSS two-sided rank bar (offense strength vs. opponent-allowed) + edge/band chip — no chart library involved, so no axis/label rendering bugs.
4. **Stat Detail Comparison** — one bordered card containing the Stat + Set line controls at its header, then team totals (bar/donut), opponent-allowed-by-week, the player pivot table, and player detail (bar/donut) all nested inside — previously these were four separate un-related cards with the driving controls stranded at the top of the page.
Verified in pane (TB@ATL wk1 2025, receiving_yards): KPI header renders logos/gameday/Best Mismatch 64.0—Strong; Passing category auto-opens (tied-best with Receiving, stable sort keeps Passing first per `CATEGORY_ORDER`); clicking Receiving closes Passing and opens Receiving (single-open accordion confirmed); canvas count dropped from 7 to 5 (the two removed mismatch charts). Tests 49/49, build green.

### 2026-07-19 — Session 6: Matchup Bets merged into Value Bets as a drill-down (audit §11/§12)
- **Curated stat picker** (audit §11 🔴, applied to both pages): new `statPicker.buildMismatchStatGroups(cols)` — offense + defense prop-market sections combined (no side toggle on these pages), advanced/other alphabetical below. Replaces the raw ~130-item list on both Matchup Bets and Value Bets.
- **Edge score scale** (audit §11 🟡): edge = maxRank − offR + 1 + defR is mathematically bounded to [2, 2·maxRank] for a given league size (offR/defR ∈ [1, maxRank]) — used that fixed range instead of a this-week-population percentile. Each mismatch row now gets a `scalePct` (0–100 position on that range) and a qualitative band (Weak/Slight/Solid/Strong at 25/50/75% cutoffs), shown as colored chips under the KPIs and folded into the "Best Edge" KPI (e.g. "64.0 — Strong").
- **Matchup Bets → drill-down, not a nav page** (audit's "two-step journey" recommendation, user request "would like this page to live in Value Bets"): removed from `nav.ts`; route kept in `App.tsx` (same pattern as Models Guide) reachable only via "zoom in" links. `MatchupBets.tsx` now reads `season`/`week`/`game`/`stat`/`player` from `useSearchParams` to seed its filters, and shows a "← Back to Value Bets" link (carries season/week back).
- **Value Bets fixes** (audit §12):
  - 🔴 Pivot prioritized: players ranked within their team (`rankInTeam`), table shows top 3 per mismatched team by default with a "Show full roster (N more)" toggle — was every player on the two offenses, including near-zero roster noise.
  - 🟢 KPIs trimmed to the two that matter (Best Mismatch Score, Avg Mismatch) — Avg Opp Allowed / Avg per Player demoted to a small caption instead of full KPI cards.
  - 🟡 Added a callout explaining Value Bets (to-date average ranks, recomputed weekly) vs Matchup Bets (carry-forward ranks) aren't directly comparable — plus a "Zoom in" chip row (one per unique game among the week's mismatches) and a per-pivot-row "→" link, both carrying season/week/game/stat/player to Matchup Bets.
- **Prop Bets cross-link** (audit §11 🟢, Matchup Bets pivot rows): each player row gets a "→" link to Prop Bets with team/stat/player carried over; `PropBets.tsx` now seeds `season`/`team`/`stat`/`player` from `useSearchParams`.
- Verified end-to-end in pane: Value Bets wk1 2025 receiving_yards → "TB @ ATL →" chip → Matchup Bets opens prefilled (season=2025&week=1&game=2025_01_TB_ATL&stat=receiving_yards) with back-link, edge chips (64.0 — Strong), curated stat groups; pivot row → link opens Prop Bets prefilled (team=TB, stat=receiving_yards, player=Emeka Egbuka). Tests 49/49, build green.
- **Follow-up (user request):** the "Zoom in" chips only cover games with a standout mismatch that week — added a footer card ("Open Matchup Bets — pick any game →") linking with just season/week (no game), so the Game dropdown is left free for the user to browse any of the week's games, not only mismatched ones. Verified: link carries `season=2025&week=1`, Matchup Bets opens with Season/Week/Game/Stat all as live dropdowns (Game defaults to the week's first game).

### 2026-07-18 — Session 5 (cont.): Player Team Stats — audit §10 implementation
- **League-wide leaders strip** (audit 🟡): new card above the team grid — flat top-10 across all 32 teams for the selected stat, ranked with logo/name/team/shared bar scale (drawn from the existing per-team top-5 pool, since a league leader is necessarily their own team's leader). Answers the page's most common question ("who leads the league") that previously required scanning all 32 cards.
- **Conference/division jump nav** (audit 🟡): sticky chip row (`AFC East` … `NFC West`) under the filters; each block now has an anchor id (`block-{conf}-{div}`, `scroll-mt-24`) and chips call `scrollIntoView`.
- **Lazy-mounted team cards** (audit 🟢, render weight): extracted WinTypes' `LazyMount` (IntersectionObserver + scroll/resize/rAF fallback) into a shared `components/LazyMount.tsx` (WinTypes now imports it instead of its own copy); each of the 32 `TeamCard`s is wrapped individually, so only in-view cards mount their ECharts canvas — was the app's 2nd-heaviest page (32 always-rendered charts) after Win Types.
- **Curated stat picker** (cross-page audit item, applied here too): replaced the raw stat `<select>` with the shared `statPicker.ts` (`buildStatGroups`/`statLabel`) already used by Prop Bets/Parlay Builder — prop-market stats grouped first, advanced/other alphabetical below, Title-Case labels.
- **Bug fix while touching the stat filter**: same class of bug already fixed on Prop Bets — the offense keyword filter matched `def_*` columns by substring (`"sacks"` ⊂ `def_sacks`, `"interceptions"` ⊂ `def_interceptions`), leaking 3 defensive stats into the offense stat list. Excluded `def_*` explicitly from the offense side.
- Verified in pane: 2025 REG passing_yards league leaders (Stafford 4,707 → Mayfield 3,693) sane; grouped optgroups render; def_* no longer in offense list; jump chips present for all 8 divisions; LazyMount confirmed working (8 canvases in initial viewport → 24 after scrolling, `.rounded-2xl.border.border-white/20` mounted only for in-view cards — an earlier "0 canvases" reading was a CSS-selector escaping artifact in my own verification script, not a real bug). Tests 49/49, build green. Not committed/pushed.

### 2026-07-18 — Session 5 (cont.): Parlay Builder — same Prop Bets treatment; shared statPicker module
- New `pages/player-analysis/statPicker.ts`: PROP_MARKET_SECTIONS (Passing/Rushing/Receiving/Fantasy; Defense), `statLabel`, `buildStatGroups`, HIT/MISS/NEUTRAL colors, `americanOdds`, `headshotCrop`. PropBets refactored to import it (no behavior change).
- **Parlay Builder** leg cards: sectioned stat picker (+ def_* offense-leak fix), opponent second line on bar x-axis + tooltip wording, no-line state fixed (bars neutral navy instead of all-red; ring shows grey "—"/"Set a line" instead of 0%), ring caption "N of M · fair ±A", elevated Line input, 160px face-crop headshot with fallback. Calc quirks preserved (Week dropdown display-only; player list ignores season type; null stat weeks count as 0 — old-page parity).
- Verified in pane: optgroups (5/3/4/2/27), Brissett 250.5 → ring 57%, "8 of 14 · fair −133" (matches replica), 1 leg KPI 57.00%/1.75, 2 identical legs → 32.49%/3.08 (product ✓). Tests 49/49, build green.

### 2026-07-18 — Session 5 (cont.): Prop Bets audit §8 implementation
- **Curated stat picker** (audit 🔴): `Select` gained optional `groups` (native optgroup, backward-compatible). Stats now grouped "Prop markets" (curated ~14 sportsbook stats, ordered) / "Advanced / other" (alphabetical), with Title-Case labels via `statLabel()` (acronym handling: EPA/PACR/WOPR/…, `tds→TDs`, `2pt→2-pt`). Bug fixed in passing: offense keyword filter leaked `def_sacks`/`def_interceptions`/`def_sack_yards` into the offense stat list (`includes("sacks")`) — def_* now excluded on offense.
- **Opponent visibility** ("vs who"): team-level week→opponent map in the pivot; opponent shown under every week header in the pivot table and as a second line on the bar chart's x-axis labels (`W5` / `@DAL`), plus a footer note explaining @-notation and byes. Tooltips unchanged.
- **Coloring fixes**: with no line set, bars were all red (condition fell through) → now neutral navy; donut showed a misleading "0% / all Below" → replaced by a "set a line" placeholder. Colors standardized (#059669/#dc2626) and donut/bars share them.
- **Verdict sentence + implied odds** (audit 🟡): card between pivot and charts — "X cleared L <stat> in N of M games (P%) — implied fair odds ±A" (American odds from hit rate; hidden at 0/100%). Set-line input visually elevated (navy border, 0.5 step, real placeholder).
- **Headshot resolution**: page loaded the full-size NFL CDN PNG (3400×2450, ~4.3 MB) into a 56px avatar. Now requests a Cloudinary face crop (`w_160,h_160,c_fill,g_face` → 160×160, ~11 KB, verified 200 + sharp) with onError fallback to the original URL.
- Verified: Brissett/ARI 2025 passing_yards line 250.5 → 8/14, 57%, −133 — exact vs PowerShell replica over the raw JSON; pivot/table/labels/optgroups verified in pane DOM. Note: the embedded pane never paints ECharts *series* pixels (axes/text only — confirmed identical on untouched Game Picks), so bar/donut colors verified at option level + donut pixel colors. Tests 49/49, build green. Not committed/pushed.

### 2026-07-18 — Session 5 (cont.): branding + model-chip selection state
- **Branding assets** (`app/public/branding/`, processed with Pillow from the user's two ChatGPT logo PNGs in Downloads):
  - `jga-icon{,-256,-64}.png` — circular JGA mark. Source had a baked-in transparency checkerboard; circle detected from the blue disc (blue-pixel bbox, min-side radius) and cut with a 4× supersampled antialiased alpha mask → clean 1024² circle.
  - `jga-badge.png` — "JGA Fantasy Football 2024" badge; solid-black background converted to graded alpha (max<16 → 0, 16–48 ramp) and trimmed.
- **Integration**: favicon + apple-touch icon in index.html; navbar 🏈 emoji replaced with the 256px icon rendered at 36px (crisp on retina) with a subtle white ring; Home hero now a flex layout with the badge (h-48→64, drop shadow) beside the title.
- **Week Preview**: selected model KPI chip highlighted (ring + slight scale, full color), unselected chips at 55% opacity (hover restores).
- Tests 49/49, build green; verified images load (nav icon, hero badge, favicon) and chip opacity states in pane.

### 2026-07-17 — Session 5 (cont.): Matchup Previews polish round 2
- **Week Preview one-row KPIs**: dropped the primary-accuracy card and both legends; the six per-model record chips are now color-coded KPI tiles (tinted background/border/shadow in each model's color — same colors as the card dot-strips, so no legend needed; active model gets a ring) + the 4 win-type chips on the same row.
- **Matchup tab remade**: layout = verdict strip + snapshot → key stats → **Model breakdown** (6 cards, one per model: pick pill + "how it got there" visuals — market bucket/grade/blend prob bars with N, the trend-edge contribution chart, implied-vs-fair with vig, Elo rating bars + resulting p, Pythagorean expected-win% bars + log5, consensus mini-strip of all five) → **Additional stats** (modernized stat-comparison card with team-color headers + rounded rank pill, recent-form and head-to-head as styled cards with logos/W-L colors/score column). Gauges and the old Spread-Pick-Engine/Trend-Edge blocks removed (content absorbed into the breakdown).
- **Models Guide** removed from the navbar (nav.ts); route kept via an explicit Route in App.tsx — reachable only from the Matchup Previews header link.
- Tests 49/49, build green; verified in pane (6 tinted chips, no legends/gauges, breakdown numbers consistent: bucket 57% N=388 → blend 55%, ML fair 58%).

### 2026-07-17 — Session 5 (cont.): Matchup Previews follow-ups (5 user requests)
1. **Week Preview per-model accuracy**: "This week by model" chip strip — each of the 6 models graded on the week's completed games (✓/total, %); clicking a chip makes that model primary. 2025 wk18: most models 10/16, Trend Edge 8/16.
2. **New page `/game_analysis/models_guide`** (`previews/ModelsGuide.tsx`, registered in nav.ts + App.tsx, cross-linked from the Matchup Previews header): plain-language card per model (what it does, exact inputs incl. weights/constants) + a **live worked example** — pick any game and each card shows the real input values (bucket + N, grades, trend features, moneylines + vig, Elo ratings, PF/PA) and the resulting probability, all computed by the same engine code.
3. **Matchup tab decision card**: "Key stats — season to date (thru W{n-1})" — 6 side-by-side stats (points, allowed, yards, yards allowed, EPA diff, TO margin) with direction-adjusted league ranks and bold on the better side, plus each side's Elo rating and Pythagorean expected win% (the model inputs). Together with the verdict strip + engines + trends + H2H the tab now holds everything needed to call a winner.
4. **Filter grouping**: new `FilterGroup` fieldset component in `components/ui.tsx` (labeled legend, e.g. "Slate — which games" / "Model — which pick counts" / "Display — card order"); applied across all three tabs + the guide. Week Preview's Accuracy KPI now names the model it grades.
5. **Tab navigation**: the lost pill bar → three prominent card-tabs (icon + name + one-line description, selected = filled navy), full-width row under the title.
- Tests 49/49, build green; verified in pane (per-model strip values, key-stats card matches replicas — Elo 1399/1473, Pyth 38/45% — guide worked example consistent with verified bucket N=388).

### 2026-07-17 — Session 5 (cont.): Matchup Previews — audit §7 + model fixes + Elo & Pythagorean
- **New models** (user-approved; NOT ports — new analytics):
  - `lib/logic/elo.ts`: 538-style Elo (init 1505, K=20, HFA +48, MOV multiplier, ⅓ season regression, SD/OAK/STL alias carry-over). Pre-game ratings per game_id — no leakage. Verified exactly vs an independent pandas replica (CAR@TB 2025 wk18 pHome 0.6688 = app's 67%; final top-5 sane, SEA #1 = the SB winner).
  - `lib/logic/pythagorean.ts`: pyth win% (exp 2.37) through week−1 + log5 matchup prob. Verified (CAR@TB: pHome 0.569 = 57%).
  - Both added to `MODEL_KEYS`/`ProbBundle` and to the **consensus Average (now 5 models)** — consensus numbers intentionally changed. 7 new unit tests (49 total).
- **Bug fixes**: Matchup tab's Spread Pick Engine used grades through the game's own week (look-ahead — leaked the game's own grade into completed-game "predictions"); now week−1 like probBundle, grade boxes labeled "thru W{n-1}". Snapshot favorite now always shown as `TEAM −X.X` (away favorites displayed "+X.X").
- **Week Preview (7a)**: 4 prose chips per card → **model dot-strip** (each model's home prob as a colored dot on a 0–100% track, consensus as a bar, 50% tick) — disagreement visible at a glance; new **"Disagreement" sort** (max−min home prob); model-color legend + FH/FA/UH/UA decoder line above the grid.
- **Matchup (7b)**: **Model verdict strip** on top (each model's pick + confidence, consensus highlighted); Spread Pick Engine leads with a verdict pill, internals demoted to a `<details>` "Evidence" section; "All-Time Matchup" → "Head-to-Head (since 2015)"; Recent Form explains @-notation.
- **Model Overview (7c 🔴)**: "Does confidence pay off?" card — accuracy by confidence band over all completed games (Average: 53/57/66/67/75/81% for 50–55→80+; monotone and self-consistent → well-calibrated). Grid cells: % moved to hover, wrong picks get red bg + ✗ (was color-only white), Correct % column colored vs coin flip.
- Tests 49/49, build green; verified in pane (dot strips, sort reorder, verdict strip, bands, cell styling).

### 2026-07-17 — Session 5 (cont.): Spread Win % — conclusion-first layout (audit §6)
- **Verdict card** (new, top of page): plain-language takeaway generated from the current selection — favorite win % in three spread tiers (≤3 / 3.5–6.5 / 7+), sentences about whether reliability rises with spread and where underdog value lives, tier chips colored by strength (Wilson CI in tooltip), and an "Apply to a week" button that jumps to Weekly Picks. Computed from all played games in the season/week selection (ignores the win-type filter). Verified vs pandas (2025: 56%/63%/79%, N 97/92/82).
- **Two-filter duality framed** (audit 🔴): explanatory paragraph at the top of Weekly Picks — top filters = historical population, panel selectors = target week (excluded from its own history).
- **Picks graded** (audit 🟢): "Graded X✓ Y✗ (Z%)" chip + a Result column (✓ / ✗ with actual winner) for completed weeks (2025 wk18: 10✓ 6✗, 63%).
- **Heatmap/stacked merged** (audit 🟡): one "Outcome mix by bucket" card with a Stacked|Heatmap toggle; calibration + lift side by side above it.
- **Control literacy** (audit 🟡): tooltips (ⓘ) on Bin size / Spread mode / Min N / CI explaining each in plain language.
- Tests 42/42, build green; verified in pane (verdict values, graded chip, toggle, scroll anchor).

### 2026-07-17 — Session 5 (cont.): Scorecards full rework (audit §5 + modernization)
- Complete rewrite of `Scorecards.tsx` (old donuts/sparkline cards replaced; data sources unchanged: team_week + team_week_ranks + grades, REG only):
  - **Hero card**: logo/name/record + Points/Allowed per game with `#N of 32` ranks + the three model grades with league ranks (same season-average ranking as Team Comparison).
  - **Season journey chart** (new): weekly points-margin bars (green W / red L, opponent in tooltip) with the Overall grade overlaid on a second axis — the "movement through season" view.
  - **Playstyle**: 4 undisclosed-metric donuts → six labeled pass/rush split bars (play volume, first downs, yards; offense + defense) each with a dashed league-average marker.
  - **Stat panels**: 7 offense + 7 defense rows (incl. the newly-fixed Turnovers), each with explicit **per game / total (N gm) / league avg per game** labels (fixes the audit's 🔴 value↔label ambiguity), a tercile-colored rank chip (#1 always best), and a sparkline with dashed league-average line + green win dots and opponent tooltips.
  - Components hoisted to module scope (StatRow/StatSpark/SplitBar) — no nested-type remounts, hooks safe.
- Verified vs pandas (DAL 2025): totals/per-game (471 / 27.7 / 4,735 / 279), league avgs (23.0 / 342 / 225), wk18 ranks (points #7, total_yards #1, allowed #32), grades (55 #23 / 46 / 54). Tests 42/42, build green; 15 canvases painted in pane.

### 2026-07-17 — Session 5 (cont.): turnover data fix at source + Team Comparison interactions
- **Turnover data root cause found & fixed** (known issue resolved): only 2025 was null — nflreadpy (the 2025 fallback source) renamed nfl_data_py's `interceptions` to `passing_interceptions`, so `turnovers`/`turnover_margin`/`int_per_attempt` (+ ranks) computed to null for nflreadpy-sourced seasons. New `_normalize_weekly()` in fetch.py renames it back, applied to both fresh fetches and cached parquets. Full pipeline rerun from cache: 2025 turnovers 570/570 non-null, league margin sums to 0, all 32 wk18 ranks present.
  - **Consequence: 2025 grades changed** — the model now sees real turnover features instead of nulls (SF avg overall 55.0 → 58.1, rank #13 → #14; verified vs pandas). Numbers "verified" in earlier sessions for 2025 (grades, matchup blends) are superseded by this correction. 2015–2024 unaffected.
  - Team Comparison's "Data unavailable" badges disappeared on their own (generic hasData check) — turnover rows now show values + ranks.
- **Team Comparison — no scroll jump on stat click**: Section/StatRow/RankBar/StatCells/GradesBox were nested component *types* recreated every render → React remounted the whole subtree on every click (same bug as TeamColumn in Session 3). All converted to plain function calls; scroll position now stable (verified 900→900).
- **Grades clickable**: Ovr/Off/Def cells are buttons that chart the grade like any stat — trend chart = weekly grade evolution (win/loss point colors, shared y-scale), matchup card = "Grade vs opponent" avg/prev bars + league-rank bar (from gradeRanks). Active cell highlighted.
- Tests 42/42, build green; verified in pane (turnover values, no scroll jump, grade charts paint).

### 2026-07-17 — Session 5 (cont.): Team Comparison — audit §4 fixes + sticky layout
- **Sticky on scroll** (user request): filter bar (title + Season/Week) sticks under the navbar (`top-[53px]`, z-30, blur backdrop); both side team columns stick at `lg:top-[120px]` so grades + trend/matchup charts stay visible while the long center stat column scrolls (they release at the container bottom, standard sticky).
- **Dead turnover rows** (audit 🔴): stats with no data for either team (turnover family — all-null in pipeline, known issue) now render a "Data unavailable" dashed badge with an explanatory tooltip instead of `--`/0 pills and an empty rank bar. Generic check (`hasData` on both summaries), so it auto-heals when the pipeline is fixed.
- **Grade context** (audit 🟡): each Ovr/Off/Def grade shows its league rank (`#N`, tooltip "of 32, season-to-date average"), computed with the same ≤week averaging as the displayed grade. Verified exact vs pandas (SF 2025 wk18: 55 #13 / 39.9 #6 / 62.7 #20).
- **Shared trend scales** (audit 🟡): both teams' by-week charts now share one y-range (min/max across both series, 8% pad) so margins compare visually.
- Deferred: cross-links to Matchup Preview/Scorecards — needs the app-wide param-carrying link infrastructure (audit's shared-context theme).
- Gotcha: long-running Vite dev server failed to emit new Tailwind arbitrary-value utilities (`top-[53px]` etc.) via HMR — classes present in DOM but `top: auto`. Restarting the dev server fixed it; production build unaffected.
- Tests 42/42, build green; sticky + badges + rank chips verified in the browser pane.

### 2026-07-17 — Session 6: M5 backend automation (weekly refresh + rolling seasons)
- `config.py`: `SEASONS` now `range(FIRST_SEASON=2015, current_season()+1)`; `current_season()` = calendar year from September, else previous year. `fetch_weekly` skips only the *newest* season (warning) if both loaders fail (early-September grace); other failures stay fatal. `validate` additionally asserts meta seasons start 2015 and newest ≥ current−1.
- `weekly-refresh.yml`: added `actions: write` + explicit `gh workflow run deploy.yml` after the auto-commit (only if `changes_detected`) — commits pushed with the default `GITHUB_TOKEN` do **not** trigger `deploy.yml`'s push event, so the Pages site would never update otherwise. Pins already matched requirements.lock.txt. Runbook updated (season rule, CI flow, 60-day cron-pause note).
- Verified locally: `--stage all --refresh` → export done, `--stage validate` OK (SEASONS resolves 2015–2025 in July 2026); app build + 42 tests green. Also merged the user's concurrent Win Types favorite-split edit (deduped `splitKpis`, restored `SPLIT_DEFS`) — build was broken by a duplicate definition.

### 2026-07-17 — Session 5 (cont.): Win Types — restore full block list per user feedback
- User feedback: the single-block drill-down killed the "visually scan all seasons" workflow. Reworked to serve both:
  - **All blocks back** (seasons newest-first / weeks ascending), each wrapped in `LazyMount` — charts init only when scrolled near the viewport (IntersectionObserver + a getBoundingClientRect scroll/resize fallback for environments where IO never ticks, e.g. the browser pane). Initial render is 2 charts instead of ~22.
  - **Summary row improved**: KPI trend chart y-axis now auto-scales around the data (fixed 0–100 flattened the 50–70% swings — that was why it "said nothing"); added a second card: 100%-stacked **win-type mix by season/week** (composition shifts at a glance). Both charts + a "Jump to" chip row scroll to the matching block (instant jump + 350ms re-correction because lazy-mounting shifts layout; also dispatches a scroll event to nudge the fallback).
- Verified in pane: 2 canvases on load → blocks mount while scrolling, zero blank; chip/chart jump lands on the block (top = scroll-mt offset) with painted charts. Tests 42/42, build green.

### 2026-07-17 — Session 5: audit implementation — Game Picks close-out + Win Types rework
- **Game Picks** (remaining audit items; earlier Session-4 work already covered winner marking, picks record, stepper, spread bars):
  - Default week rule per audit §2: current in-progress week (earliest week with an unplayed game) while the season is live; last completed **regular-season** week once it's over — no more 1-row Super Bowl landing (2025 now opens on Week 18, 16 games).
  - Win-type color legend above the table + one-line hint explaining the manual-pick checkboxes.
  - Still open (needs cross-page work, deferred): model's pick per game (Matchup Previews engine) — part of the audit's shared-context/cross-link theme.
- **Win Types** (full audit §3 rework, "trends first, blocks second"):
  - New top card: the 3 KPIs (Favorite-is-Home / Favorite-Win / Home-Win %) as trend lines across all seasons (or weeks), with dashed all-time-average markLines. Clicking a point (or its axis label) selects that group.
  - Per-group block (KPIs + stacked bar + scatter, unchanged logic) is now an on-demand drill-down for **one** selected group via Select/chart-click — was ~22 always-rendered charts (the app's worst render weight), now 3.
  - Collapsible win-type glossary (7 categories + inherited edge cases: played pick'em → Underdog, ties → "(No Score)" buckets, ties in win-% denominators).
  - Week mode now states its population ("pools all seasons 2015–2025 per week number").
  - Trend values reuse the exact `kpis()` used by the blocks (same rows, same denominators) — no new logic; block KPIs remain parity-verified.
- `useECharts` gained an optional `{ onInit }` hook (used for trend-chart click-to-select; handler routed through a ref so mode switches don't leave a stale closure).
- Tests 42/42 green; build green. Verified in browser pane: Win Types renders 3 painted canvases (season + week modes), Game Picks defaults to 2025 wk18. Note: browser-pane cold load can still leave canvases at width 0 (ResizeObserver never ticks there) — hash-navigate once to repaint; real browsers unaffected. Not committed/pushed.

### 2026-07-17 — Session 4: UX audit + Game Picks improvements
- New `docs/UX_AUDIT.md`: full page-by-page UX/analytical audit of all 13 routes (objectives, content, hierarchy, visuals, prioritized opportunities) + cross-page consistency review. Guide for a later implementation phase; no logic prescriptions.
- **Game Picks** (first page implemented from the audit + user direction):
  - Spread chart reworked: horizontal bars, one row per game (games on Y, spread on X), colored by win type, dynamic height (28px/game); "Game time | Spread" sort toggle right of the chart title. ×N collision markers no longer needed (each game has its own row).
  - Charts split into two cards (win-type counts bar unchanged).
  - Winner now explicit in the table (bold + ✓ on winning team), not color-only.
  - "Your picks" record chip in the header: manual picks graded vs final scores (✓/✗/%, pending count). Verified vs 2025 wk18 results.
  - Prev/next week stepper buttons beside the Week select.
  - `useECharts`: re-measure (rAF resize) after every option change — container height can depend on the same state as the option, and some environments never fire ResizeObserver.
- Tests 42/42 green; build green. Not committed/pushed.

### 2026-07-17 — Session 3: chart-rendering fix + Team Comparison center redesign
- **Bug (all pages):** every ECharts chart rendered blank since the M4 Loading-spinner change. `useECharts` initialized the chart in a mount-only effect, but pages now return `<Loading/>` on first render, so the chart div didn't exist when the effect ran (and never re-ran). Rewrote `useECharts` with a **callback ref** (init/dispose when the node attaches/detaches, latest option applied on init) + a `requestAnimationFrame` resize after init (node can attach at width 0; some environments never deliver the initial ResizeObserver tick — the browser pane here is one). Verified painted canvases (non-blank pixel counts, zero zero-width) on Team Comparison, Spread Win %, Win Types, Grading Model.
- **Team Comparison:** center stat cells redesigned — old red/green/blue bootstrap cells → neutral rounded pills with LAST/TOTAL/AVG micro-labels inside each pill (header row replaced by team-color legend + "Last · Total · Avg — bar = league rank" hint), rank bars now rounded-full with `#N` rank labels, section labels restyled, +/– breakdown buttons circled. Zero data changes (SF/CIN 2025 wk18 values verified unchanged: -10/66/3.9 vs -4.6/-78/-2, ranks #9/#26). Also: `TeamColumn` now invoked as a plain function (was a nested component type recreated every render → full subtree remount).
- Tests 42/42 green; build green. Not yet committed/pushed.

### 2026-07-16 — Session 2 (cont.): all remaining M3 pages
- Implemented in order: Spread Win Percentage, Grading Model (4 tabs), Team Comparison, Scorecards, Matchup Previews (3 tabs + shared engine), Prop Bets, Build Parlay, Player Team Stats, Matchup Bets, Value Bets, and finished Game Picks TODOs. Every page number-checked against a pandas replica of the old logic (details inline above); one commit per page.
- New shared pieces: `components/filters/MultiSelect`, `lib/logic/contributions.ts`, `pages/grading-model/shared.ts` + `charts.tsx`, `pages/game-analysis/previews/engine.ts`.
- **Next (M4):** responsive/UI polish pass, golden-fixture Vitest for lib/logic, add `app/tsconfig.tsbuildinfo` to .gitignore. M5 workflows already live (Pages deploy on push); weekly-refresh cron still unverified.

### 2026-07-16 — Session 2: Win Types page
- New `app/src/pages/game-analysis/WinTypes.tsx`; route registered in App.tsx, nav.ts marked implemented; `npm run build` green.
- Parity: schedule.json extract already carries Winner/Favorite/Win Type but the page recomputes locally like the old one (7-category "Win Type Full"). Verified KPIs (Favorite-is-Home/Favorite-Win/Home-Win %) exact vs pandas on seasons 2025/2024/2018/2015 and weeks 1/2/18; bar category counts exact for season 2024 total and week 1.
- Gotcha: browser-pane `screenshot` times out on this page (many ECharts canvases); use get_page_text / javascript_tool (canvas.toDataURL) instead.
- **Next:** /game_analysis/spread_win_percentage (then grading model per M3 order); Game Picks TODOs (manual-winner checkboxes, ×N badges) still open.

### 2026-07-15 — Session 1 (cont.): deploy + nav/home UI
- Repo pushed to github.com/Jorgeglza/NFL-analytics-app (public); Pages enabled (Source = GitHub Actions); live at https://jorgeglza.github.io/NFL-analytics-app/
- New grouped dropdown navbar (Game Analysis / Player Analysis / Data, per-page descriptions, "soon" badges, mobile menu) + redesigned Home (hero with live meta stats, grouped page cards). Routes now generated from `app/src/nav.ts` — when a page is implemented, register its component in `IMPLEMENTED` in App.tsx and set `implemented: true` in nav.ts.
- Verified live: assets on /NFL-analytics-app/ base, data endpoints 200, dropdown navigation to Game Picks works.

### 2026-07-15 — Session 1
- Explored old app fully; plan approved. Decisions: Python pipeline + TS app, SQLite+JSON, Vite/React/Tailwind/ECharts.
- Built M0 + M1 (pipeline runs end to end, parity green for completed seasons) and most of M2.
- First page (Game Picks) implemented and building; dev server verified serving app + data.
- **Next steps:** (1) finish Game Picks TODOs and number-check vs old app; (2) Win Types page; (3) golden-fixture Vitest for lib/logic; (4) proceed down the M3 page list. Run the old app with `"..\NFL app\NFL app run.bat"` for side-by-side comparison.
- Gotchas for future sessions: run pipeline via `pipeline/.venv/Scripts/python`; preview tooling chokes on spaces in repo path — use `npm run dev` in `app/` and open http://localhost:5173; repo is inside OneDrive (consider excluding from sync if git misbehaves).
