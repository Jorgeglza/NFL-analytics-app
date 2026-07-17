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
- ☐ `.github/workflows/weekly-refresh.yml` (cron Tue 12:00 UTC + dispatch → pipeline → validate → auto-commit)
- ☐ `.github/workflows/deploy.yml` (build → GitHub Pages, SPA fallback + Vite `base`)
- ☐ Push to GitHub, first workflow run verified

## Session notes (newest first)

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
