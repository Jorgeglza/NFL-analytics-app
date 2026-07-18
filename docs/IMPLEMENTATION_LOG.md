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

### M5 — Deploy + automation
- ✅ `.github/workflows/weekly-refresh.yml` (cron Tue 12:00 UTC + dispatch → pipeline → validate → auto-commit → explicit `gh workflow run deploy.yml` — GITHUB_TOKEN commits don't fire push triggers)
- ✅ `.github/workflows/deploy.yml` (build → GitHub Pages, SPA fallback + Vite `base`) — live since Session 1
- ✅ Dynamic season range: `config.SEASONS = range(2015, current_season()+1)` (rolls to the new season each September); `fetch_weekly` skips the newest season with a warning if unpublished; `validate` asserts 2015→current (one-season grace)
- ◐ First end-to-end weekly-refresh run verified via workflow_dispatch

## Session notes (newest first)

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
