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
- ✅ /game_analysis/spread_win_percentage (now **Spread Analytics**, 2 tabs) — Win Rate & Calibration tab: filters (multi season/week, win types, bin size, signed/abs, min-N, CI), 6 KPIs, calibration/stacked/heatmap/lift charts, bucket table, Weekly Picks panel. KPIs + bin aggregates + Wilson p̂ verified exact vs pandas replica. Grid-aligned buckets replace pd.cut edges (deviation: pandas silently dropped a game whose |spread| hit the exact top edge; we keep it). 2026-07-22: added a compact "Recommended vs Actual vs Historic" chart inside Weekly Picks (between the KPI row and the details table) — per-week pick logic factored into `computeWeekPicks()` (shared with the single-week table). Iterated same day: an initial version averaged Recommended/Actual across every graded week up to the selection (192 weeks by Week 18), which barely moved between weeks — replaced with per-selected-week Recommended (from `reco.chips`) vs that week's own graded Actual outcomes vs the long-run Historic baseline, so the chart now visibly reflects each week's own spreads. Also removed a redundant per-week count chart (chips already showed it) and labeled the chips "Recommended distribution." No pipeline/data changes; computed entirely client-side from `schedule.json`. 2026-08-03: renamed to Spread Analytics, moved to `spread-analytics/WinRateTab.tsx` (near-verbatim) with a new Weekly Breakdown tab alongside it — see that session's log entry.
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

### M4 — UI modernization (zero logic changes) ✅
- ✅ Route-level code splitting (React.lazy + Suspense) and vendor chunking (echarts/react) — initial JS ~15 kB + 164 kB react chunk; ECharts loads per page (was one 1.2 MB bundle).
- ✅ Shared `components/Loading` spinner applied to every page (replaces blank screens / ad-hoc text).
- ✅ `app/tsconfig.tsbuildinfo` untracked + gitignored.
- ✅ Design-system pass across all pages (zero data changes): shared UI kit in `components/ui.tsx` (Card, Kpi, Segmented, Chip, FilterBar, inputs) matching the navbar/home language — rounded-2xl white cards on slate-200 borders, navy #002f6c accents (h1 accent bars, KPI top-borders), uppercase micro-labels, unified pill segments/tab bars, consistent table headers (slate-50, tracking-wider). Verified per route via DOM audit (no legacy `rounded-xl`/old theads remain) and KPI spot checks (Weekly tab stats + Game Picks wk18 counts unchanged).
- ✅ Screenshot-based visual QA — closed 2026-08-01 via M6's full route audit. The Browser pane's `screenshot` tool still times out in this environment ("the Browser pane is not displayed, so the page is not compositing frames") — a standing tooling limitation, not something this session could fix — so the audit substituted the DOM-based methodology used throughout M6 (per-route `scrollWidth`/`clientWidth`, `read_console_messages`, `get_page_text`) across all 18 routes at 375×812/768×1024/1280×800. Found and fixed 3 pre-existing mobile overflow bugs in the process (`Home.tsx` hero margin, `Scorecards.tsx` select row, `SpreadWinPct.tsx` tier cards + Weekly Picks Graded pill). See `docs/MOBILE_READINESS.md`'s "M6 close-out" section for full detail.
- ✅ **UX audit — per-page items (§1–13) and Cross-Page/Global items both done.** Reconciled 2026-07-21 against current source (not just log claims) — see the "Next" note above and `docs/UX_AUDIT.md`'s prioritized summary. Two items remain intentionally unimplemented by explicit user decision (win-type color-only encoding, engine-disagreement callout), not gaps.

### M3.5 — New analytics beyond old-app parity (not ports) ✅
- ✅ /game_analysis/team_trends — weekly grade/stat trajectories, up to 3 teams (`pages/game-analysis/team-trends/shared.ts`).
- ✅ /game_analysis/season_outlook — 3 tabs, each own sub-URL (`/game_analysis/season_outlook/<power_rankings|strength_of_schedule|playoff_probability>`, `:tab` route in `App.tsx`, old `/game_analysis/power_rankings` URL redirects): **Power Rankings** (composite of Elo + season-to-date Overall Grade + Pythagorean win%, `lib/logic/powerRankings.ts`, moved here 2026-07-28 from its own standalone page — logic/component reused as-is in `season-outlook/PowerRankingsTab.tsx`, old `pages/game-analysis/PowerRankings.tsx` deleted), **Strength of Schedule** (played vs. remaining opponent Elo) + **Playoff Probability** (2,000-iteration Monte Carlo, simplified tiebreaker) tabs (`pages/game-analysis/season-outlook/shared.ts`, `lib/logic/playoffSim.ts`).
- Deferred: Model Backtest + Value Bets Backtest — scoped but not built, see `docs/FUTURE_DEVELOPMENT.md` (blocked on historical prop-line data for the value-bets half).

### M5 — Deploy + automation ✅
- ✅ `.github/workflows/weekly-refresh.yml` (cron Tue 12:00 UTC + dispatch → pipeline → validate → auto-commit → explicit `gh workflow run deploy.yml` — GITHUB_TOKEN commits don't fire push triggers)
- ✅ `.github/workflows/deploy.yml` (build → GitHub Pages, SPA fallback + Vite `base`) — live since Session 1
- ✅ Dynamic season range: `config.SEASONS = range(2015, current_season()+1)` (rolls to the new season each September); `fetch_weekly` skips the newest season with a warning if unpublished; `validate` asserts 2015→current (one-season grace)
- ✅ First end-to-end weekly-refresh run verified (2026-07-21, via GitHub Actions API): `weekly-refresh.yml` run `29833256531` fired on `schedule`, completed with `conclusion: success`; the matching `deploy.yml` `workflow_dispatch` run (13:12:37 UTC, same window) also succeeded — full cron → pipeline → validate → commit → deploy chain confirmed working end-to-end, not just inferred from a data commit.

### M6 — Mobile readiness ✅
Full work list, with per-item checkboxes and severities: **`docs/MOBILE_READINESS.md`** — that document is the source of truth for this milestone; tick items there as they land, and mirror phase-level status here.

- ☐ Audit complete (2026-07-29). No fixes implemented yet.
- Finding: M4 closed as ✅ but its scope was visual *consistency*, not *responsiveness* — see the M4 note above. There are ~53 responsive utilities across 16,842 lines of TSX, all `sm:`/`lg:`/`xl:` (`md:` only in `Navbar.tsx`); **no breakpoint below 640px exists anywhere**, so 375px is the un-designed default. All of `pages/player-analysis/` (5 routes, 2,391 lines) has zero responsive prefixes; ~60 ECharts instances use fixed heights up to 700px, and exactly one chart has a width breakpoint.
- Decisions (with user): full mobile-first pass across all 17 routes · charts adapt density per breakpoint via ECharts `media` queries (extending `pages/grading-model/charts.tsx:118`) · wide pivots get a sticky first column + scroll affordance · payload work is **frontend-only**, no pipeline changes.
- ✅ **Phase 1 shared infrastructure (2026-07-29)** — all 11 items (P1.1–P1.11) done, see `docs/MOBILE_READINESS.md` for the full per-item writeup. Summary: `useECharts.ts` now runs a `normalizeOption()` pass on every `setOption` (tooltip confine, scrollable legends, `hideOverlap` axis labels, walks `baseOption`); new `charts/responsive.ts` (`withMobile()`, `MOBILE_MAX`) and `charts/sizing.ts` (`chartH`, `rowChartH`) primitives, not yet consumed by any chart — that's Phase 2; `Modal.tsx` is a bottom sheet below `sm` with body scroll lock, single scroll container, focus trap, and a11y attrs; new `TabBar.tsx` replaces the identical hand-rolled tab-card grid in `SeasonOutlook.tsx`/`GradingModel.tsx`/`PredictiveModel.tsx`/`MatchupPreviews.tsx` with a mobile pill strip + the original sm+ card grid; new `FilterSheet.tsx` (bottom-sheet filter collapse, not yet wired into any page — Phase 5) and `InfoDot.tsx` (tap-toggled popover, promoted from `PerformanceTab.tsx`'s private one and now used there); `ui.tsx` primitives gained responsive sizing plus `stickyColCls`/`scrollHintCls` exports for Phase 6, and the zero-importer `FilterBar` was deleted; `index.css` enlarges range-slider thumbs to 24px under `(pointer: coarse)` and adds safe-area utilities; `App.tsx` gutters and `index.html` (`theme-color`, `viewport-fit=cover`, ESPN CDN preconnect) got the remaining polish items. Verified: `tsc --noEmit`/`npm run build`/60-test Vitest suite all green; browser-pane smoke test at 375×812 on Season Outlook and Predictive Model showed zero console errors, zero horizontal overflow, working `TabBar` tab-switch, and a functional `InfoDot` tap popover.
- ✅ **Phase 2 chart size/axes/legends (2026-07-30)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 2 section. Summary: list-driven chart bars (`SeasonTab`/`WeeklyTab`/`SosTab`/`GamePicks`/`HeatmapChart`/`ModelPickerTab`) now size via the shared `rowChartH()` helper instead of one-off fixed pixels or duplicated inline formulas; aspect-driven charts (off/def scatters, misses-heatmap, reliability/granular charts, `TeamsTab`/`FeaturesTab`/`ExplanationTab` bars) moved to the `chartH.*` responsive tokens; 7 chart-option builders in `PerformanceTab.tsx` plus `ModelPickerTab.tsx`'s heatmap and season-outlook's `HeatmapChart.tsx` wrapped in `withMobile()` to shrink hardcoded gutters/nameGap/visualMap placement under 520px instead of reserving desktop-sized gutters (worst case: `ModelPickerTab`'s 110px label gutter, now 60px + truncated labels on mobile); `ParlayBuilder.tsx`'s one hardcoded `w-[360px]` chart is now `w-full sm:w-[360px]`. Axis-label density (P2.8/P2.9) turned out to already be handled by Phase 1's `normalizeOption()` (auto-fills `hideOverlap: true` on every category axis), confirmed by code read rather than re-implemented; legend overlap (P2.10) is likewise mostly covered by Phase 1's `legend.type: "scroll"`, with one explicit `grid.bottom` bump added in `MatchupBets.tsx` as insurance. Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane check (still no screenshot capture on this app, per the M4 note — used `scrollWidth`/canvas-dimension/console-error checks instead) at 375×812 across Grading Model (all 4 tabs), Predictive Model Performance (both Points/% modes), Season Outlook SOS, Build Parlay, and Matchup Previews Model Picker — zero console errors, and the only two overflow cases found were pre-existing and out of Phase 2's chart-only scope (Model Picker's `TabBar`/table flex-containment gap, and an unrelated Build Parlay toolbar row) — flagged for Phase 5/6, not fixed here. Desktop 1280×800 regression check on Grading Model: `TeamsTab` charts landed byte-identical (exact `chartH.lg` tier match at 520px); other migrated charts shift modestly (documented per-chart in `MOBILE_READINESS.md`) as an explicitly-flagged, intentional consequence of routing through the shared Phase-1 size tokens instead of one-off pixel values.
- ✅ **Phase 3 bin correctness (2026-07-30)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 3 section. Summary: new shared `components/charts/histogram.ts` (`buildHistogramBins()` snaps bin edges to a nice 1/2/5×10^k step; `sturgesBinCount()`; `histogramBarSeries()` draws bars via an ECharts `custom` series + `renderItem`, since `barWidth` doesn't size to axis units on a value axis) — `WeeklyTab.tsx`'s grade histogram and `ConfidenceTab.tsx`'s residual histogram both moved from a `category` axis (raw min/max edges, duplicate-label-prone) to a `value` axis with round edges. This fixed the real defect: `WeeklyTab.tsx`'s mean/median `markLine`s were placed by integer bin index on the category axis, landing at the containing bin's **center** rather than the true value (off by up to half a bin width, wrong on desktop too) — they now use `{ xAxis: stats.mean }`/`{ xAxis: stats.med }` directly. Also fixed the over-binning (16 bins for 32 teams → Sturges-rule `sturgesBinCount()`, ~6 bins). `PerformanceTab.tsx`'s margin heatmap (`buildMarginHeatmap`) now computes a second, coarser grid (`bucketWidth = 10` vs desktop's `5`) and swaps it in under the existing `withMobile()` media query — a real 9×9 mobile grid instead of just shrinking the same 18×18 cell count. Three hygiene fixes: deleted dead `lib/logic/spreadBins.ts` (zero importers, confirmed via grep); consolidated the two `percentile` functions (`ModelPickerTab.tsx`'s local 0–1-convention copy deleted, call sites switched to `lib/logic/contributions.ts`'s 0–100-convention version); `predictive-model/shared.ts`'s `reliabilityBuckets()` bucket-edge convention now genuinely matches the pipeline's `np.digitize(..., right=True)` (`(lo,hi]`) instead of just having its comment claim so. No calculated model/grade/prediction value changed — only bin edges, bar-rendering mechanism, markLine placement, mobile heatmap density, and the three hygiene items. Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane check at 375×812 and 1280×800 on Grading Model → Weekly and Predictive Model → Performance/Confidence — zero console errors at either width.
- ✅ **Phase 4 touch & interaction (2026-07-30)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 4 section. Summary: `PerformanceTab.tsx`'s existing `InfoDot` usages (P1.7) turned out already touch-reachable, confirmed by reading rather than re-fixed. Everywhere else a hover-only `title` was the *only* carrier of information, added a tap-reveal path: `ModelOverviewTab.tsx`'s pick matrix, `PropBets.tsx`/`ValueBets.tsx`/`MatchupBets.tsx`'s pivot cells, `ExplanationTab.tsx`'s feature-name tables, and `ModelPickerTab.tsx`'s scenario matrix all get a tappable cell/row plus a dismissible detail panel; `SpreadWinPct.tsx`'s 4 control labels and `TeamsTab.tsx`'s 2 column headers swapped their `title`-only glyphs for the shared `InfoDot`; the 6 page-title decorative hints (`WinTypes`/`SpreadWinPct`/`Scorecards`/`TeamComparison`/`GamePicks`/`MatchupPreviews`) got the same `InfoDot` treatment; `WeekPreviewTab.tsx`'s "view matchup →" hover affordance is now always visible below `sm`. `PerformanceTab.tsx`'s zrender drag-to-set-cutoff gained a `RangeInput` bound to the same `thresholdPct` state — works on every device, drag survives as a desktop nicety. All ~15 sub-44px tap targets flagged in the audit (steppers, zoom links, jump chips, table rows, checkboxes) were bumped to 44px below `sm` only (`sm:` reverts to the original desktop size) across `SeasonOutlook`/`GamePicks`/`ParlayBuilder`/`MultiSelect`/`WinTypes`/`PlayerTeamStats`/`ValueBets`/`TeamComparison`/`PerformanceTab`/`WeeklyTab`/`PowerRankingsTab`/`PlayoffTab`/`Scorecards`/`PropBets`/`MatchupBets`; two of the five clickable-row tables gained a mobile-only chevron they were missing. `MultiSelect.tsx` now closes on `touchstart` too and clamps its panel to the viewport width. `GradingModel.tsx`/`PredictiveModel.tsx` tab state moved to the same `?tab=` pattern as `MatchupPreviews.tsx` — verified `#/data/grading_model?tab=weekly` and `#/data/predictive_model?tab=confidence` deep-link correctly. Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane check at 1280×800 and 375×812 across Grading Model, Predictive Model (Performance + Confidence), Matchup Previews → Model Overview (tap-panel exercised end-to-end via `form_input`/click), Prop Bets Players, and Spread Win Percentage — zero console errors. All mobile-only sizing is `sm:`-gated so desktop is pixel-identical; the additive changes (tap panels, `InfoDot` swaps, `touchstart` listener) don't reposition any existing desktop element.
- ✅ **Phase 5 per-page layout (2026-07-30)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 5 section. Rather than blanket-adding `sm:` prefixes to every surface the pre-Phase-1 audit flagged as "zero responsive prefixes," each page was checked live at 375×812 for actual overflow first — several (Player Analysis's `PropBets`/`ValueBets`/`MatchupBets`, `GamePicks`, `TeamTrends`, all 3 Season Outlook tab bodies, all of Phase 5.4's polish list) already rendered correctly, since Phase 1's shared primitives (`Select`, `Kpi`, `TabBar`, table `overflow-x-auto` wrappers) had already given them baseline responsiveness. Real, verified overflow got fixed in: `ParlayBuilder.tsx` (header KPI boxes + Reset button forced a non-wrapping row 36px past the viewport — added `flex-wrap` + a 2-up mobile pattern matching `Kpi`'s), `PlayerTeamStats.tsx` (League Leaders row had ~408px of fixed-width content in a 351px container — shrunk name/team/stat columns on mobile, hid the redundant %-of-team column below `sm`), `previews/MatchupTab.tsx` (two hardcoded `grid-cols-3` blocks → `grid-cols-1 sm:grid-cols-3`), `TeamComparison.tsx` (fixed a real 4px page-level bleed from a sticky-bar gutter mismatch with P1.10's `px-3` mobile gutter, then shrunk the wide comparison rail's stat chips/center column so its necessary internal scroll dropped from ~300px+ to ~56px), and `season-outlook/DetailModal.tsx` (remaining-schedule rows' fixed `w-14`/`w-28`/`w-24` columns left only ~43px for the win-probability bar — shrunk two columns for mobile, hid the supplementary Elo-comparison text below `sm`). Also deduped `PerformanceTab.tsx`'s and `ExplanationTab.tsx`'s hand-rolled `<select>`s onto the shared `components/filters/Select.tsx` (which gained an optional `minWidthClassName` prop for the one caller needing a wider floor than the default). Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane check at 375×812 across all 10 touched/audited page groups confirmed `document.body.scrollWidth === clientWidth` (no page-level horizontal overflow) and zero console errors; 1280×800 regression checks (computed styles) confirmed every touched shared-component default and fixed pixel value is unchanged at desktop widths.
- ✅ **Phase 6 tables (2026-07-30)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 6 section. Summary: new `stickyColCls`/`stickyColHeadCls` (`ui.tsx`) pin the identifying column — Team/Player/Feature/row-label, not a decorative logo-only column 1 — of all 7 widest pivots (`ValueBets`, `MatchupBets`, `TeamsTab`, `PropBets`, `Scorecards`, `ModelOverviewTab`, `ModelPickerTab`), using a `box-shadow` divider instead of a border (borders on sticky cells have nothing to anchor to once scrolled) and `border-separate` where it wouldn't double up existing per-cell borders; rows with a click-to-select highlight get the sticky cell's background set explicitly per-row so the highlight still shows through. New `ScrollHint` component adds a self-hiding right-edge fade (via a `ResizeObserver` on the wrapper's *content*, not the wrapper itself — the wrapper's own box is fixed-size, so a naive `ResizeObserver(wrapper)` never fires when a table grows inside it) to all 7 tables; the one-time "Swipe →" text hint was deliberately descoped (would need localStorage-backed dismissal state for a POLISH item). `previews/MatchupTab.tsx`'s two tables missing `overflow-x-auto` got wrapped; `FeaturesTab.tsx`/`TeamTrends.tsx` were verified live (not by grep) to already be correctly wrapped. **Also fixed, found live during verification:** the shared `Segmented` component had no width constraint, so a long-label consumer (`ModelPickerTab.tsx`'s "Axis" control) rendered at its full 492px content width regardless of viewport — this was the exact pre-existing "Model Picker ~655px scrollWidth" issue flagged out-of-scope in Phase 2. Fixed with a viewport-relative `max-w-[calc(100vw-2rem)]` cap plus `overflow-x-auto` (a `min-w-0`-up-the-flex-chain fix didn't work since the nearest sized ancestor was itself auto-width). A new, unrelated ~137px overflow on `SpreadWinPct.tsx` was found in passing and flagged for a future pass, not fixed (out of Phase 6's table-scoped remit). Verified: `tsc --noEmit`/`npm run build`/60-test suite green; browser-pane check at 375×812 and 1280×800 across all touched tables and the `Segmented` fix — zero page-level horizontal overflow, zero console errors, sticky/scroll-hint behavior confirmed via direct `getBoundingClientRect`/`scrollLeft` measurement rather than visual inspection alone.
- ✅ **Phase 7 mobile performance (2026-08-01)** — full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 7 section. `loader.ts`'s `toRecords`/`getPlayerWeek` gained an opt-in `cols?` projection param (default behavior byte-identical); deliberately **not** wired into any of the 5 player-analysis pages after finding all 5 dynamically discover their stat-dropdown options by scanning every numeric column at runtime, and 2 of them (`ValueBets`, `MatchupBets`) apply no keyword filter at all — narrowing the fetch would have silently dropped real stat options (kicking/punting/penalty columns) from those pages, so the infra shipped without a forced consumer rather than risk a functional regression. `MatchupPreviews.tsx`'s two independent per-season fetch batches (`getTeamWeek`, `getTeamWeekRanks`) merged into one concurrent `Promise.all` instead of running sequentially (`ModelsGuide.tsx` checked and found to not have the same issue — only one season-batch, already can't start before `getMeta()`). `PredictiveModel.tsx` no longer fetches `game_features.json` (906 KB gz) up front for all 4 tabs — deferred to a separate effect that only fires when the Explanation tab (its only consumer) is active, with its own loading state. Every team-logo/headshot `<img>` in the app now has `loading="lazy" decoding="async"` (16 call sites touched; 2 above-the-fold local branding images in `Navbar.tsx`/`Home.tsx` intentionally excluded). `LazyMount` (previously used in only 2 places) extended to `PerformanceTab.tsx`'s 9 chart containers and 4 below-the-fold charts on `SpreadWinPct.tsx`, deferring `echarts.init()` until scroll-visible — verified live that top-of-page charts mount immediately while lower ones stay as placeholder divs until a scroll event reaches them. New `components/Skeleton.tsx` (`Skeleton` + composed `PageSkeleton`) replaces the bare spinner on all 5 player-analysis pages' top-level loading gate, each confirmed to be a genuine "still loading" state (not a real empty state) before swapping. Verified: `tsc --noEmit`/`npm run build`/60-test suite green throughout; browser-pane checks via `read_network_requests`/`read_console_messages`/DOM queries confirmed the deferred fetches, the lazy-chart mount/placeholder split, and zero console errors on Predictive Model, Matchup Previews, Power Rankings, Spread Win Percentage, and Prop Bets Players.
- ✅ **M6 close-out — full route audit (2026-08-01)** — ran the §Verification checklist across all 18 routes (17 nav routes + Home) at 375×812/768×1024/1280×800. Screenshot capture is still broken in this environment (a standing tooling limitation), so used the DOM-verification methodology already established across M6 (`scrollWidth`/`clientWidth`, `read_console_messages`, `get_page_text`) instead — flagged explicitly per the doc's own requirement. Found and fixed 3 pre-existing mobile overflow bugs: `Home.tsx`'s hero `-mx-4` full-bleed wrapper hadn't been updated for P1.10's `px-3` mobile gutter change (4px bleed, same class of bug as `TeamComparison.tsx`'s P5.6 fix); `Scorecards.tsx`'s Season/Team select row had no wrap (3px overflow); `SpreadWinPct.tsx` had two causes (tier-cards row, and the Weekly Picks Season/Week/Graded row — the latter restructured, per explicit user request, so the "Graded" record pill stacks below the two dropdowns on mobile instead of squeezing onto one row). All 3 verified fixed at 375px and pixel-identical to their pre-fix layout at 1280px. Zero remaining horizontal overflow and zero console errors across all 18 routes at all 3 breakpoints; `tsc --noEmit`/`npm run build`/60-test suite green. **This closes M6 entirely** — see `docs/MOBILE_READINESS.md`'s "M6 close-out" section for the full route list and per-bug detail. Also closes the M4 visual-QA item above.
- Verified as already correct, do not churn: viewport meta; **Tailwind v4 wraps `hover:` in `@media (hover: hover)` by default** (checked in `node_modules/tailwindcss/dist/lib.mjs`, v4.3.2) so hover states do not stick on touch; `Navbar.tsx` mobile menu; `useECharts` ResizeObserver; 17 of 19 tables already wrapped in `overflow-x-auto`.
- ✅ **Phase 8 data loading reliability & payload (2026-08-02)** — a post-close-out follow-up (users reported mobile data "sometimes won't load"), full per-item writeup in `docs/MOBILE_READINESS.md`'s Phase 8 section. Root-caused three independent issues: (1) `player_week/2025.json` was 13.7 MB (~7x every other season) because a silent `nfl_data_py`→`nflreadpy` fallback for 2025 only pulled in every position plus 91 extra stat columns — fixed at the `export_json.py` export layer only (no `fetch.py`/model/parity impact), confirmed via `git status` that only `player_week/2025.json` changed after a full re-export; (2) `loader.ts`'s `fetchJson` had no timeout/retry and cached failures forever — added a 15s `AbortController` timeout, 2x retry-with-backoff on network/timeout failures only, cache eviction on final failure, and a new `ErrorRetry` UI component instead of an infinite spinner; (3) `MatchupPreviews.tsx`/`ModelsGuide.tsx` eagerly fetched every season's `team_week`/`team_week_ranks` (~14 MB/~9 MB) regardless of device — now gated by a new `useIsMobileViewport()` hook (mirrors the `sm`/640px breakpoint): mobile fetches only `meta.current_season` eagerly and the rest in the background, desktop reproduces the original single eager fetch with zero code-path change (verified via `read_network_requests` at both 375px and 1280px). **Also found and fixed live during verification**: `meta.json`'s `seasons` list included the current (unpublished, post-August-rollover) season even though no data files existed for it — a pre-existing bug, invisible before this session's reliability work made failures visible instead of an infinite hang, now fixed by deriving `meta.seasons` from the seasons that actually got exported. Documented both fixes in `docs/known-issues.md` #17-18. Verified: `tsc --noEmit`/`npm run build`/60-test suite green; pipeline `--stage export`/`--stage parity`/`--stage validate` green; browser-pane checks at 375px and 1280px on Matchup Previews, Models Guide, and Prop Bets Players confirmed zero console errors and correct fetch-pattern split. **Follow-up P8.4 (same day)**: wired the same `loadError`/`retryTick`/`ErrorRetry` pattern into the 5 player-analysis pages (`PropBets`, `ValueBets`, `MatchupBets`, `ParlayBuilder`, `PlayerTeamStats`), which had only gotten the invisible half of P8.2 (bounded failure, no visible recovery). Verified live with a real failure simulation — patched `fetch` to reject `player_week` requests, confirmed `ErrorRetry` renders after retries exhaust, then confirmed clicking Retry genuinely re-fetches and recovers (not just a pattern-matching inspection). **Follow-up P8.5 (same day)**: same gap existed on the two "Data" pages (`GradingModel.tsx`, `PredictiveModel.tsx`) — no multi-season payload problem there, but the same missing `ErrorRetry`. Wired identically (`PredictiveModel.tsx` got two independent error states since its Explanation-tab `game_features.json` fetch already had its own deferred loading state from P7.3). Live failure-path re-test wasn't possible for these two given a tooling limitation (both files were already cached in-tab, and a full reload needed to force a fresh request also wipes a monkey-patched `fetch` before React's effect fires) — documented as such rather than faked; confidence rests on the pattern being identical to P8.4's already-live-tested one. **Follow-up P8.6 (same day)**: a full route sweep found the identical gap in the remaining 7 routes with data fetches — `TeamTrends`, `SeasonOutlook`, `GamePicks`, `WinTypes`, `SpreadWinPct`, `TeamComparison`, `Scorecards` (none have the multi-season payload problem; `Home.tsx` already degrades gracefully and didn't need it; `GlossaryPage` has no fetch). Wired identically across all 7. Live failure-path re-tested successfully on `TeamTrends.tsx` (block → switch season to force a fresh fetch → `ErrorRetry` renders → unblock → Retry recovers). This test also caught a pure tooling artifact worth remembering: a transient dev-server HMR reconnect left the browser-automation tool's cached element ref stale, so a coordinate-based Retry click silently no-opped until a direct `element.click()` via `javascript_tool` confirmed the retry mechanism itself was correct all along — not a code bug. This closes out `ErrorRetry` coverage across every route in the app that fetches data.

### F1 — Fantasy Draft page — ⛔ scrapped (2026-08-03)
- Was scoped as a fully independent pipeline scraping consensus rankings from CBS/ESPN/TheScore.
  Per explicit user direction (2026-08-03: "for the fantasy draft page, drop all plans") this is
  dropped entirely, not just deferred — `docs/fantasy-pipeline.md` (the design doc) deleted. Not
  on any future roadmap; would need re-scoping from scratch if ever revisited.

### P1 — Predictive model research spike (independent track, non-blocking) ⛔
- ✅ Design doc + result written (`docs/predictive-model.md`, 2026-07-24).
- Deliberately isolated: own `pipeline/predictive_model/` package, own cache
  (`data/raw_cache_predictive/`), own output dir (`data/predictive_model/`), reads
  `data/nfl.sqlite` read-only, run **manually only** — no GitHub Actions, no changes to
  `pipeline/nfl_pipeline/*`, `engine.ts`, or `ModelPickerTab.tsx`.
- Walk-forward HistGradientBoosting + LogisticRegression, leakage-safe features (Elo,
  rolling EPA/success/explosive rate from play-by-play, season-to-date grades, rest days,
  weather, div-game, QB-starter-continuity, injury severity) — free nflverse data only, per
  user decision (no paid odds APIs).
- ⛔ **Result: no edge found.** Trained models underperform the market's own vig-free
  moneyline on straight-up accuracy (season 2024: market 71.3% vs. best trained model 68.8%;
  season 2025: market 65.4% vs. 64.0%); ATS accuracy for every model (trained or trivial)
  sits within noise of 50%, below the ~52.4% breakeven at standard -110 vig. Full numbers
  and next-step options in `docs/predictive-model.md`'s decision-gate section.
- Per the approved plan, no UI was built (gate: only proceed to a "Predictive Model" page,
  kept separate from Model Picker, if a walk-forward ATS edge appeared) — tabled pending a
  decision on `docs/predictive-model.md`'s follow-up options (snap-count-weighted injury
  severity, richer tracking features, accept free-data ceiling, or more held-out seasons).
- ✅ P2: exploration page built anyway (`/data/predictive_model`, historical-only) — see
  below.
- ✅ P3 (2026-07-25): folded into the Matchup Previews consensus as a 7th model
  (`"predictive"` in `engine.ts`'s `MODEL_KEYS`/`probBundle`), per explicit user decision
  to include it despite the "no edge" finding. Historical-only (reuses the existing
  `predictive_model/games.json` export as a lookup — no live/upcoming-game prediction, no
  TS model port); games outside coverage are silently excluded from that game's average,
  and the whole model gracefully disappears from the UI (with a small disclosure note) if
  the export fails to load. Live prediction + weekly-refresh automation are explicitly
  deferred — see `docs/predictive-model.md`'s "P3" section.
- ⛔ Follow-up (2026-07-24): added Next Gen Stats (tracking-derived: time-to-throw, CPOE,
  aggressiveness, rush yards over expected, separation/cushion, YAC above expectation;
  2016-2025) + FTN charting (motion/play-action/RPO/box-count/blitz/drop rate; 2022-2025
  only) as an "extended" feature set, A/B tested against the baseline on identical
  walk-forward splits (`pipeline/predictive_model/compare_feature_sets.py`). **Did not
  help** — straight-up accuracy unchanged-to-slightly-worse, ATS accuracy worse in both
  test seasons (2024: 51.3%→48.4%; 2025: 51.3%→48.0%), though McNemar's test says none of
  these deltas are statistically significant (all p > 0.05) — so no evidence either
  direction is real, but no improvement found. Elo dominates permutation importance by an
  order of magnitude over every other feature, new or old. Full numbers and a hypothesis
  for why (FTN's short 2022-2025 history diluting a much larger training set) in
  `docs/predictive-model.md`.
- Also ran a slice analysis (`analyze_slices.py`) checking whether any team/week/scenario
  subset of the original baseline model clears ATS breakeven — a few teams and weeks
  looked good (SEA 68.6%, PHI 65.7%, week 10 64.3%) but on ~30-game samples across 32
  teams/18 weeks tested, consistent with pure sampling noise (multiple-comparisons trap),
  not a real pattern. Away-favorite / small-spread slices were directionally plausible
  (matches known market bias) but still below breakeven.
- Round 3 (2026-07-24): added snap-count-weighted injury severity (name-matched join
  between `load_injuries`/`load_snap_counts`, 96.7% match rate), pass/rush EPA split,
  starting field position + expected points, red-zone/third-down/pressure situational
  features (`compare_models_pca.py`), applied PCA (fit per walk-forward fold only, kept
  23/33 columns for 90% variance), and tried 5 model types (HGB, LogisticRegression,
  RandomForest, SVM, MLP) with/without PCA. **Straight-up accuracy improved measurably**:
  logreg/mlp (no PCA) beat the original baseline HGB in *both* individual test seasons,
  pooled 66.8% vs. 64.5% (still below market's 68.5%) — McNemar p=0.166, directionally real
  but not statistically confirmed at this sample size. **No confirmed ATS edge**: several
  configs individually cleared the 52.4% breakeven in one season (e.g. hgb+PCA hit 54.2% in
  2025) but the same configs were among the *worst* in the other season (hgb+PCA: 46.9% in
  2024) — a cross-season consistency check (checking pooled numbers and per-season
  agreement, not just cherry-picking each season's best of 10 tested configs) shows this is
  noise, the same multiple-comparisons trap as the earlier team/week slice analysis. Full
  numbers in `docs/predictive-model.md`.
- Round 4 (2026-07-24): reviewed 3 external papers (`Predictive model papers.docx`:
  Streitmatter 2023, Bouzianis 2019 UNH thesis, Ruscio & Brady 2021 TCNJ) and implemented
  the two most concrete ideas plus checked a third. **Nonlinear transforms** (signed
  square/sqrt of Elo, starting field position/EP, season grade — Bouzianis' single most
  consistent finding across 32 per-team models): small non-significant nudge for HGB
  (64.2%→65.0% pooled straight-up, McNemar p=0.42), no help for LogisticRegression or ATS.
  **Calibration table** (Ruscio & Brady's reliability-diagram method, added to
  `evaluate.py`): Round 4 HGB is well-calibrated for straight-up picks (r=0.9964, matching
  their "r>.99" bar); the same metric on ATS predictions is a meaningless ±1.0000 —
  an artifact of only 2 populated probability bins, itself more evidence of "no real
  signal" for that target rather than a calibration problem. **Feature selection vs. PCA
  check** (`compare_selection_methods.py`, custom leakage-safe `L1FeatureSelector`):
  confirmed **PCA should be dropped** — it costs ~2pts of accuracy vs. raw features or
  L1 selection (63.3% vs. 65.2%/65.9% pooled, McNemar p=0.21 pca-vs-l1) with no offsetting
  benefit found anywhere this session. L1 selection ≈ raw for HistGradientBoosting (p=1.00,
  no difference — tree ensembles already do their own implicit selection). Streitmatter's
  margin-regression + Monte Carlo simulation idea (derive both win-prob and ATS-prob from
  one fitted score-margin distribution instead of two disconnected classifiers) was
  reviewed but not implemented this round — flagged as the most conceptually important
  idea from the literature; implemented next as Round 5 (below). Full numbers and paper
  summaries in `docs/predictive-model.md`.
- Round 5 (2026-07-24): implemented the margin-regression + Monte Carlo simulation idea
  (`pipeline/predictive_model/margin_regression.py`) — one regression on point margin,
  residual (uncertainty) distribution estimated from out-of-fold training predictions,
  win-prob and ATS-cover-prob both derived from that single fitted distribution (Monte
  Carlo resampling of actual residuals, plus a closed-form normal-CDF cross-check).
  **Straight-up accuracy matches the best two-classifier result** (65.9% pooled vs. 66.8%
  for round3 logreg, both well above the original 64.2% baseline) with one unified model
  instead of two separately-tuned ones — the architectural payoff the approach promised.
  Residual diagnostics were a pleasant surprise: σ≈13.3 points, skew≈0.05, kurtosis≈0.33
  (close to normal) — and this σ **independently lands almost exactly on Ruscio & Brady's
  own published PFR "uncertainty" constant (13.40-13.45)**, an unplanned cross-validation
  against the literature. **Still no ATS edge** (pooled ~49-50%) — but a more informative
  negative result than the classifiers': the margin-regression model actually expresses a
  wide range of ATS confidence (10%-90%, not clustered at ~50% like the classifiers), and
  that confidence still doesn't track outcomes (calibration r is negative, -0.14 to -0.33,
  though on small per-bin samples) — stronger evidence the market has already priced in
  whatever signal these features carry. Full numbers in `docs/predictive-model.md`.
- Round 6 (2026-07-24): reviewed 5 more papers (Beal/Norman/Ramchurn 2020, Harville 1980,
  Song/Boulier/Stekler 2007, Boulier & Stekler 2003, Szalkowski & Nelson 2012) and
  implemented 3 concrete items. **Naive Bayes + AdaBoost** (`compare_new_models.py`):
  AdaBoost is now the best straight-up performer on the Round 4 feature set (66.4% pooled,
  McNemar p=0.18 vs. the original baseline — the most encouraging non-significant result
  yet); Naive Bayes did NOT repeat Beal's benchmark result (67.53%) here, likely because
  our feature set is far more collinear than their simpler 42-feature set, which hurts
  Naive Bayes's independence assumption more. **Weighted ensemble** (`ensemble_models.py`,
  hgb+logreg+naive_bayes+adaboost, equal vs. Brier-inverse-weighted): tied but did not beat
  the single best model on either target — these models share a feature set, so their
  errors are correlated rather than complementary, the precondition ensembling needs to
  pay off. **Home-underdog backtest** (`home_underdog_backtest.py`, full 2015-2025 history,
  n=1110 home-dog games — much larger than any slice tried earlier this session): the
  classic 53.5% (2002-2011) home-underdog cover-rate bias has fully diminished to a
  coin-flip ~50.2% in current data (not significant vs. 50%). A different pattern initially
  appeared — home favorites under-covering — **but this did not survive a Round 7
  data-quality fix (see below) and is now non-significant too**; corrected in place in
  `docs/predictive-model.md`. Item 4 from this round's review (an "overreaction" feature —
  the market overreacts to a team's most recent large-margin result, per Vergin 2001) was
  queued for next. Full numbers and paper summaries in `docs/predictive-model.md`.
- Round 7 (2026-07-24): implemented the queued overreaction feature, and along the way
  **found and fixed a real data-quality bug affecting every round since Round 1**.
  `team_week` carries a small number of duplicate `(team, season, week)` "phantom" rows (a
  documented upstream nflverse quirk, correctly preserved verbatim in the parity-critical
  main `nfl_pipeline` — not a bug there). `build_team_features` merges multiple frames
  derived from `team_week`; merging two frames that both carry the same duplicate keys
  produces a Cartesian product for those keys, not just an addition, so every merge added
  since Round 1 silently inflated the dataset a little more. Fixed by deduplicating in
  `predictive_model/features.py`'s `load_team_week()` — safe here since this package has no
  parity requirement, unlike `nfl_pipeline`. **Verified against ground truth**: the
  schedule table has exactly 2,895 completed REG games for 2015-2025, matching the fixed
  pipeline exactly (was silently returning 2,968-3,114 depending on which round's merges
  were active). **Impact**: re-running the original baseline after the fix moved HGB from
  64.2%→~64.6% pooled straight-up and ATS from 51.3%→~49.9% — the largest shifts found by
  spot-check; no qualitative conclusion from this session changes (market still leads,
  still no confirmed ATS edge anywhere), except Round 6's home-favorite finding (z=-2.04)
  which drops to non-significant (z=-1.75) on corrected data. Treat all pre-Round-7
  percentages as accurate to roughly ±0.5-1.5 points, not exact.
  **The overreaction feature itself** (`surprise_points_margin`/`surprise_epa_diff` — how
  much of an outlier a team's last game was vs. its own established baseline, computed
  leakage-safe): tested the hypothesis directly first (`test_overreaction_hypothesis.py`,
  full 2015-2025 history) — Pearson correlation between surprise and market bias was
  **r=-0.02** for both point-margin and EPA framings, essentially zero, no monotonic
  pattern. Confirmed with a walk-forward retest (`retest_round5_surprise.py`, AdaBoost +
  HGB): all 8 McNemar comparisons not significant (p=0.29-1.00), feature added nothing to
  either target. Read together: this isn't "didn't help by chance," it's "the underlying
  bias this feature targets doesn't show up in our data" — same pattern as the diminished
  home-underdog bias. Full numbers in `docs/predictive-model.md`.
- **Final results (2026-07-24)**: re-ran every Round 1-6 script on the corrected (deduped)
  data to produce one authoritative comparison table (`docs/predictive-model.md`'s "Final
  results" section). **Best configuration found across the entire session: AdaBoost on the
  Round 4 feature set, 66.73% pooled straight-up accuracy** (vs. 64.52% for the original
  Round 1 baseline, vs. 68.57% for the market). Final McNemar test (best vs. baseline, both
  on corrected data): p=0.1344 — the most encouraging result of the whole investigation,
  still not statistically significant at n=544. Every other configuration tested (NGS/FTN,
  PCA, margin regression, ensembling, the overreaction feature) falls at or below this,
  within a tight 62-67% band, and nothing gets within 1.8 points of the market. **Conclusion:
  not yet worth adding to the app** — the promising result isn't confirmed, and even if it
  were, it still wouldn't beat the market. Recommended next steps if pursuing further: more
  held-out test seasons (thin 2-season sample for a 2-point effect), or accept the free-data
  ceiling as a settled null result.
- **Round 8 (2026-07-24): robustness check across 7 seasons.** Took 6 distinct configs from
  the final results table and re-ran walk-forward across 2019-2025 (n=1,871) instead of just
  2024-2025 (n=544) — `robustness_top6.py`. **The absolute numbers came back down**:
  AdaBoost's 66.73% (2 seasons) drops to 64.40% pooled over 7 — 2024 turned out to be an
  unusually easy season for every config (68-70% across the board), which had flattered the
  2-season table. **But the relative improvement over the original baseline got *more*
  credible, not less**: AdaBoost vs. baseline reaches **McNemar p=0.0436 on the 7-season
  sample — the first result in this entire session to clear conventional significance**
  (2-season McNemar was p=0.13-0.18). All 6 configs beat the baseline (+0.5 to +1.7pt), and
  5 of 6 are more season-to-season stable than the baseline's std=0.0386 (least accurate
  *and* least consistent of everything tested). Margin regression tied for best accuracy
  (64.40%) with the lowest variance of all (std=0.0280, even beating the market's own 0.0301)
  despite being the most architecturally complex config — complexity bought stability here,
  not just accuracy. **Still no beating the market** (66.38% pooled over the same 7 seasons)
  — the gap narrowed from -3.69pt (baseline) to -1.98pt (best) but never closed. Full table
  in `docs/predictive-model.md`'s Round 8 section.
- **Model decision (2026-07-24)**: margin regression, LogReg-style, chosen as the go-to
  model; AdaBoost documented as the close runner-up (see `docs/predictive-model-decision.md`).
  Tied on accuracy (64.40% pooled, 7 seasons) but margin regression is more stable
  (std=0.0280 vs. 0.0323) and gives much richer material for the planned predictive-model
  page (predicted point margin instead of just win/loss, linear coefficients instead of
  split-based importances, a real fitted confidence distribution) — see the decision doc for
  the full reasoning. AdaBoost kept as fallback if the margin-regression machinery proves
  hard to productionize. Next: P2 below, the predictive-model page itself.
- Same-day follow-up: isolated NGS-only and FTN-only (vs. the combined set above) —
  `compare_feature_sets.py` now runs baseline/ngs_only/ftn_only/combined together. On
  straight-up accuracy, isolating each source shows a small non-significant uptick in 3 of
  4 season/set combos (best: FTN-only 2025 at +1.5pt) that vanishes once combined —
  consistent with "too many columns for ~2,700 training games" rather than "the data is
  useless." **On ATS, isolating doesn't help either** — every configuration sits at or
  below the baseline's 51.3%, and permutation importance for the ATS target stays
  negligible across all three feature sets. This line of investigation (NGS/FTN, alone or
  combined) is exhausted with no ATS edge found; see `docs/predictive-model.md` for the
  full numbers and remaining options (snap-count-weighted injuries, accept the free-data
  ceiling, or more held-out seasons).

### P2 — Predictive Model page (independent track, follows P1) ✅
- Model decision made: margin regression, LogReg-style (`docs/predictive-model-decision.md`).
- ✅ Built `/data/predictive_model` (4 tabs: Overview, Performance, Explanation, Confidence),
  historical-only per user decision (no live/upcoming-week predictions — the pipeline has no
  `predict_upcoming()` capability, out of scope for this pass), backtest widened to all
  available history (2018-2025, n=2,127 walk-forward predictions — wider than any window used
  during research). New export step: `pipeline/predictive_model/export_page.py`, writes to
  `app/public/data/predictive_model/*.json` (games, season_summary, importance, calibration,
  meta), reusing `margin_regression.py`'s `lin_reg` walk-forward loop. Nav entry added under
  "Data"; loaders added to `lib/data/loader.ts`. Pooled numbers this run: 64.3% straight-up
  (n=2,127) vs. market 66.4%, Elo 63.6%; ATS 50.0% (n=2,075) — same "no confirmed edge"
  conclusion as every research round, stated plainly on the Overview tab rather than implied
  otherwise. Verified in browser preview (all 4 tabs load real data, filters work, no console
  errors); `npm run build`, `tsc --noEmit`, and the 58-test Vitest suite all green. Full
  writeup in `docs/predictive-model.md`'s "P2: the exploration page itself" section.
- Re-run `python pipeline/predictive_model/export_page.py` manually once a season completes
  (not on the weekly cron — this package still has no GitHub Actions wiring).
- **Redesign (2026-07-25), per user feedback that Overview was over-informative for a landing
  tab**: Overview now leads with KPIs + accuracy-by-season table + a model-vs-market-vs-Elo
  trend chart; the full research narrative (the "what this page is" blurb + the 8-config
  complexity/accuracy table) moved into a click-to-expand section at the bottom, collapsed by
  default. Performance gained: a hover-only "i" info marker next to "Predicted vs. actual
  margin" explaining what the two numbers mean (matches the app's existing native-`title`
  hover convention); an "Accuracy by week" bar chart; and a "What's different about the
  misses?" section (accuracy by |predicted margin| confidence bucket, plus a correct-vs-wrong
  comparison of avg confidence/spread/margin error) — confirms misses cluster in low-
  confidence, low-spread games rather than in a pattern suggesting a deeper problem.
  Explanation gained a **Game inspector**: pick any season/week/matchup and see an exact
  per-game linear decomposition (`export_page.py` now also computes and exports
  `game_features.json` — each feature's post-impute/scale value times the fitted `lin_reg`
  coefficient, i.e. its exact point contribution to that game's predicted margin; the
  intercept + all contributions sum to the predicted margin exactly, verified in the browser
  preview). This is a genuinely different explanation than permutation importance (global,
  averaged) — it's local and exact, only possible because the chosen model is linear.
  Verified: `tsc --noEmit`, `npm run build`, 58-test Vitest suite all green; browser preview
  click-through of the collapsible, the new charts, and the game inspector (including
  reactivity when switching weeks) with zero console errors.
- **Performance-tab follow-up (2026-07-25)**: three more rounds of direct feedback.
  (1) Fixed the predicted-vs-actual scatter's axis labels — they used ECharts' default
  `nameLocation: "end"` with only 10-20px of grid padding, which is exactly the layout bug
  the codebase's own established heatmap convention (`SpreadWinPct.tsx`) avoids by always
  using `nameLocation: "middle"` with an explicit `nameGap` and generous grid padding; applied
  that same pattern here (`grid: {left:60,right:30,top:40,bottom:60}`, both axis names
  centered with gap), and added a real chart legend (two named "Correct pick"/"Wrong pick"
  scatter series instead of one series with inline-only colors) so the blue/red meaning isn't
  only in the subtitle text.
  (2) Converted "What's different about the misses?" from a 1D confidence-bucket bar chart
  into a **2D predicted-vs-actual margin heatmap** (5-point buckets, `buildMarginHeatmap` in
  `shared.ts`): each cell shows N games, outlined blue when the majority of that cell's games
  were correct picks and red otherwise (per explicit instruction, an exact 50/50 split renders
  red — `isCellCorrect()` uses `correctShare > 0.5`, not `>=`), with the same dashed
  "predicted == actual" diagonal reference line as the scatter, now traced across identical
  category-axis bucket edges on both axes.
  (3) Added a **Points / % toggle** to the Performance tab's filter bar (`Segmented`,
  alongside season/team): "%" mode swaps in probability-flavored parallels of every existing
  view — a predicted-win-probability-vs-actual-outcome scatter (jittered binary outcome, 50%
  decision line in place of the diagonal), a **calibration**-by-season table and
  calibration-by-week chart (avg predicted probability vs. observed win rate — answers "is the
  % itself accurate," a different question from pick accuracy), and a probability-bucket ×
  actual-outcome heatmap reusing the same blue/red/tie-goes-red grammar. New `shared.ts`
  helpers: `buildProbabilityHeatmap`, `calibrationBySeason`, `calibrationByWeek`,
  `isCellCorrect` (shared by both heatmaps). Verified in a clean browser tab (no console
  errors — a stale-HMR console error surfaced during iteration and was confirmed non-issue via
  a fresh tab): both view modes render, toggle switches correctly, all chart/table numbers
  sane (e.g. correct picks show higher avg confidence than wrong picks, calibration gaps
  mostly under 5pt). `tsc --noEmit`, `npm run build`, 58-test suite all green.
- **"%" mode chart redesign (2026-07-25)**: user feedback that the "%" view's charts weren't
  as clean/useful as the "Points" view's. Replaced the jittered predicted-probability-vs-
  binary-outcome scatter and the 2-row probability×outcome heatmap (both bespoke, neither a
  standard visualization) with the actual purpose-built tool for "is this probability
  accurate": a **reliability diagram** (`shared.ts`'s new `reliabilityBuckets()`, ports
  `pipeline/predictive_model/evaluate.py`'s `calibration_table` client-side so it can be
  scoped to the season/team filter, not just the pooled global number already on the
  Confidence tab) — 10 probability bins plotted as bubbles (size = N) against the
  perfect-calibration diagonal, blue within 10pt of the diagonal / red beyond it. The misses
  section became a **calibration-gap bar chart** (predicted − observed per bucket, diverging
  around zero, same blue/red rule) built from the same bucket data — removed
  `buildProbabilityHeatmap` entirely (unused after the swap, deleted rather than left dead).
  Also added the predicted win probability to the Points-mode scatter's hover tooltip
  (`pct(g.home_win_prob)` alongside the existing predicted/actual margin line) per direct
  request. Verified in a clean browser tab: 3 chart instances render in both modes, zero
  console errors, `tsc --noEmit`/`npm run build`/58-test suite all green.
- **Granular per-game "%" chart (2026-07-25)**: the reliability diagram is bucketed (10 games'
  worth of confidence per dot); added a second "%" mode chart, "Predicted probability vs.
  actual margin — by matchup type," plotting every individual game (x = predicted home win
  probability, y = actual margin — continuous, so no jitter hack needed). Colored by the same
  home/away favorite/underdog categories used everywhere else in the app (Game Picks, Win
  Types, Spread Win %) — imports `WIN_TYPE_COLORS`/`winType()` directly from
  `lib/logic/winType.ts` rather than duplicating hex values (the established DRY convention
  per that file's own comments). `winType()` normally takes raw home/away scores, but since it
  only compares their sign, calling it as `winType(actual_margin, 0, spread_line)` reproduces
  the exact same classification from the margin already on hand — no new data needed. Ties/
  missing-spread games get the app's existing neutral gray uncategorized color. Verified in a
  clean browser tab: 4 chart instances in "%" mode (up from 3), zero console errors in either
  mode, `tsc --noEmit`/`npm run build`/58-test suite all green.
- **Correctness outline on the granular chart (2026-07-25)**: the matchup-type colors alone
  didn't show which dots were actually correct picks. Added a bold dark outline
  (`borderColor: "#0f172a"`, `borderWidth: 2`, slightly larger `symbolSize`) to correct picks,
  no outline on wrong ones — fill color still encodes matchup type, the outline is a second,
  independent channel for correctness (same "outline = correctness" idea already used by both
  heatmaps, just applied to individual points instead of aggregated cells). Each category's
  points are sorted wrong-first/correct-last before rendering so a correct pick's outline is
  never hidden under an overlapping wrong one from the same series. Tooltip and subtitle/info
  text updated to explain both channels. Verified: `tsc --noEmit`/`npm run build`/58-test suite
  green, clean browser tab shows zero console errors in either view mode.
- **Category KPIs + weekly breakdown on the granular chart (2026-07-25)**: first confirmed the
  colors were already correctly closing-spread-derived — `spread_line` in
  `pipeline/predictive_model/features.py`'s game table comes straight from the `schedule`
  table's `spread_line` (home-perspective, negated at load — `pipeline/nfl_pipeline/
  transform.py`'s `load_schedule_df`), the same nflverse closing-line field and sign
  convention `lib/logic/winType.ts` and Game Picks already use; no bug, no change needed
  there. Added: (1) a clickable KPI chip row above the granular chart — one per category
  (`shared.ts`'s new `categoryStats()`), showing straight-up accuracy and n, doubling as the
  chart's category filter/legend (clicking dims a chip and drops that category's series from
  the chart — the native ECharts legend was removed since these chips now do that job, plus
  show numbers a bare legend can't); (2) a grouped bar chart below it, "Accuracy by category,
  per week" (`categoryStatsByWeek()`), same categories/colors/toggle state, answering "does
  the model do better/worse on (say) home favorites as the season progresses." First real
  output was itself a useful sanity check: Favorite home/away sit at 89.6%/79.8% accuracy vs.
  Underdog home/away at 27.5%/17.6% (pooled, all seasons) — exactly the pattern expected from
  a model whose predictions correlate with the market (it calls favorites right most of the
  time and, definitionally, upsets almost never), which also confirms the categorization is
  wired to the spread correctly. Verified in a clean browser tab: 5 chart instances, chip
  click toggles `opacity-40` styling and removes/restores the corresponding chart series with
  zero console errors, `tsc --noEmit`/`npm run build`/58-test suite all green.
- **Category section correction + redesign (2026-07-25)**: user feedback that a prior attempt
  to turn the KPI chips into a stacked-bar chart was a misstep — the chips were "perfect,"
  reverted to them exactly. The stacked-correct-vs-wrong bar idea (x=N, solid=correct, lighter
  tint=wrong, label=correct% only on the correct segment) belonged on the **weekly** breakdown
  chart instead, replacing its old grouped-bar-by-accuracy design. Rebuilt "Games and accuracy
  by category, per week" as a grouped-and-stacked bar: for each active category, two series
  (`"category — correct"`/`"category — wrong"`) sharing a per-category `stack` id, so ECharts
  groups the categories side by side within each week while each category's own correct/wrong
  split stacks together. `CategoryStat` (`shared.ts`) gained explicit `correct`/`wrong` integer
  fields (previously only `acc`) so the stack heights are exact counts, not values re-derived
  from a rounded percentage. Iterated twice more same-session: axes flipped so weeks read left
  to right on the x-axis (N game count on y) per follow-up request, and the correct-segment's
  percentage label rotated 90° for legibility in the now-narrow grouped columns, suppressed
  entirely at exactly 0% (an upright "0%" on a sliver segment was pure clutter) per further
  feedback. Verified after each change: `tsc --noEmit`/`npm run build`/58-test suite green;
  clean browser tab confirmed chips render with their original accuracy/n numbers, toggling a
  chip dims it (`opacity-40`) and updates both the granular scatter and the weekly chart, zero
  console errors.
- **Granular tooltip: score, category code, predicted margin (2026-07-25)**: the granular
  %-mode chart's per-game hover only showed the matchup name, predicted probability, and
  actual margin. `pipeline/predictive_model/export_page.py` now also exports raw
  `home_score`/`away_score` per game (present in `features.build_game_table()`'s output
  already, just not previously carried into `games.json`) — re-ran the export
  (`games.json` 148KB → 160KB). Tooltip is now 4 lines: matchup name (bold predicted winner /
  green actual winner, from the earlier round), the final score directly below in the same
  away-home order (`shared.ts`'s new `scoreLabel()`), the category code (`categoryCode()`,
  reusing `lib/logic/winType.ts`'s existing `CATEGORY_CODES` — "FH"/"FA"/"UH"/"UA" — bold and
  green only when that pick was correct), then predicted win probability, predicted margin
  (newly added), and actual margin. Verified: `tsc --noEmit`/`npm run build`/58-test suite
  green, clean browser tab loads the updated `games.json` with zero console errors; the score
  fields themselves spot-checked directly in the regenerated JSON (e.g. PHI 18 – ATL 12,
  `actual_margin` 6.0, consistent). Tooltip hover content itself couldn't be pixel-verified —
  this environment's browser tool can't screenshot or coordinate-click/hover on canvas
  elements (same limitation noted earlier this session), so this rests on code review + a
  clean render rather than a visual check.
- Research artifacts (`data/predictive_model/*.csv`, `metrics.json`, `report.txt` — the
  per-round result tables that back every number in `docs/predictive-model.md`) are now
  **git-tracked** (2026-07-25) — removed from `.gitignore` and committed (~63 KB). Only
  `data/raw_cache_predictive/` (18 MB of raw nflreadpy pulls, purely rebuildable) stays
  ignored. Rationale: these CSVs are small, deterministic (`random_state=42`), and otherwise
  unverifiable without rerunning 8 rounds of scripts — committing them costs nothing at
  build/runtime since `data/` isn't part of the app bundle (only `app/public/data/` is).

### P3 — Live/upcoming-week predictions (independent track, follows P2) ✅
- ✅ Pipeline automation done (2026-07-25/26). Scope split per user decision: this round
  covers *only* the pipeline/automation side (item (c) below resolved as "own independent
  weekly cron").
- ✅ **Frontend surfacing done (2026-08-03)**, per user direction to implement this as the top
  priority follow-up. `predictive_model/games.json` (historical) and the new `upcoming.json`
  (live, from this section's export) are simply concatenated before
  `engine.ts:buildPredictiveIndex()` — both already carry the same
  `season/week/home_team/away_team/home_win_prob` shape, so no new lookup logic was needed, just
  merging the two row sets at the two places that build the index
  (`MatchupPreviews.tsx`/`ModelsGuide.tsx`). This means the predictive model's pick now appears
  live everywhere `probBundle()` is already consumed — Week Preview cards, the Matchup tab's
  model-breakdown card, Model Overview's "Upcoming only" filter, and the Models Guide worked
  example — with no per-page special-casing. New shared `PredictiveCoverage` type +
  `predictiveDisclaimer()` helper (`engine.ts`) replace the 4 near-duplicated "historical only"
  footer strings across `WeekPreviewTab`/`MatchupTab`/`ModelOverviewTab`/`ModelsGuide` with one
  wording that now also states the live week when present (`ModelPickerTab`'s footer is
  deliberately unchanged — that tab only ever grades completed games, so upcoming coverage
  doesn't change its behavior). New loaders `getPredictiveModelUpcoming()` /
  `getPredictiveModelUpcomingMeta()` in `loader.ts`.
  New "This week" card on `/data/predictive_model`'s Overview tab (`OverviewTab.tsx`, fetched
  independently in `PredictiveModel.tsx` so a missing/malformed export just hides the card
  instead of blocking the historical page) — one row per upcoming game: market spread, predicted
  home margin, model home win%, market fair home win%, plus the fitted residual σ. Same
  "no confirmed edge, exploration not picks" framing as the rest of the page.
- **Bug found and fixed while regenerating real data**: `export_upcoming.py` crashed
  (`TypeError: unorderable types for comparison` in `np.sign`) the first time it ran against a
  season with zero completed games (2026, pre-kickoff) — `features._field_position_situational()`
  returns an empty `pd.DataFrame(columns=[...])` when no play-by-play exists yet for that season,
  and merging that all-`object`-dtype frame onto `feats` left `l3_start_field_pos`/`l3_start_ep`
  as `object`-dtype `None` instead of `float64` `NaN`, which `np.sign()` can't handle. Fixed at
  the root in `_signed_square()`/`_signed_sqrt()` (`features.py`) with a `pd.to_numeric(...,
  errors="coerce")` first — real `NaN` and `object`-`None` now behave identically (propagate
  through, imputed downstream like any other missing feature). This bug would have hit
  `predictive-refresh.yml`'s live cron the same way the first time a new season's Week 1 export
  ran, so it's a real production fix, not just a local-repro issue.
- Verified: real 2026 Week 1 export produced (16 games, σ≈13.1, 2895 training games) after the
  fix; `tsc --noEmit`, `npm run build`, and the 60-test Vitest suite all green; browser-pane
  check across Predictive Model → Overview, Matchup Previews (Week Preview / Matchup / Model
  Overview "Upcoming only"), and Models Guide — live predictions render correctly (e.g. NE @ SEA
  → SEA 62% home win prob, consistent across every surface), zero console errors anywhere.
- Built: `features.build_upcoming_game_table(season, week)` + `features.next_unplayed_week()`
  — reuses `build_team_features()` unchanged (every per-team feature already excludes the
  current week's own result via `shift(1)`, so this is a filter change on `build_game_table`'s
  `home_score.isna()` side, not a feature-engineering change, confirmed by cross-checking its
  output against `build_game_table()`'s for the same games with scores masked — byte-identical
  `elo`/`diff_elo` etc.). New `pipeline/predictive_model/export_upcoming.py` fits `lin_reg` on
  all completed REG games and scores the next unplayed week, writing
  `app/public/data/predictive_model/upcoming.json` + `upcoming_meta.json` (kept separate from
  `games.json` so `engine.ts`'s existing `predictiveIdx` — historical-only — is untouched).
  Item (b) from the original scope note (persist the fitted pipeline instead of refitting)
  turned out unnecessary: this stays a batch CI export like every other page's JSON, so
  refitting once per scheduled run is cheap and simpler than persisting model artifacts.
- Automation: new `.github/workflows/predictive-refresh.yml`, twice-weekly cron (Tuesday
  14:00 UTC — early pass, right after `weekly-refresh.yml`'s Tuesday commit, though injury/
  starting-QB data for the upcoming week is largely not posted yet; Friday 18:00 UTC —
  re-scores the same week after the NFL's official Friday injury report finalizes). Fully
  independent of `weekly-refresh.yml`: separate file, separate schedule, commit scoped only
  to the two `upcoming*.json` files, read-only against `data/nfl.sqlite`. Same auto-commit +
  explicit `gh workflow run deploy.yml` dispatch pattern (`GITHUB_TOKEN` commits don't trigger
  push-based workflows).
- Verified: local dry run against the real `data/nfl.sqlite` correctly found zero unplayed
  games (offseason — 2026 schedule not fetched yet, `current_season()`'s August cutover
  hasn't hit) and wrote a valid empty `{"cols":[],"rows":[]}` rather than erroring. Separately,
  end-to-end smoke-tested by monkeypatching `load_schedule()` to mask a real played week
  (2025 week 10) as unplayed: `export_upcoming.main()` ran fetch→fit→predict→export cleanly,
  produced 14 games with sane `predicted_margin`/`home_win_prob`/`home_covers_prob` values
  consistent with the real spread lines for that week. Not yet dispatched live in GitHub
  Actions (nothing to score until the 2026 season enters `SEASONS` in August) — do that as a
  `workflow_dispatch` smoke test once games are scheduled.
- **Bug caught during review, fixed before push**: `_qb_continuity`'s `qb_changed` flag
  (`features.py`) compared `qb_id != prev_qb_id` without also requiring `qb_id.notna()`.
  Harmless for `build_game_table()` (always-played games always have an announced/recorded
  QB), but `build_upcoming_game_table()` can call this on a genuinely future game whose
  starting QB isn't announced yet — pandas' `NaN != x` evaluates `True`, so an unannounced QB
  was being mislabeled "changed" instead of "unknown, no signal." Added the `qb_id.notna()`
  guard; re-ran both the masked-week feature cross-check (still byte-identical to
  `build_game_table()`) and the real dry run against `data/nfl.sqlite` after the fix.
- Committed and pushed to `main` (2026-07-26) so the `predictive-refresh.yml` cron schedule
  is live — GitHub Actions only evaluates `on.schedule` triggers for workflow files present
  on the default branch.
- Plan: `C:\Users\Jorge\.claude\plans\need-to-plan-the-cheerful-papert.md`.

## Session notes (newest first)

### 2026-08-07 — Season fallback: Prop Bets / Value Bets / Player Team Stats / Matchup Bets

- **Bug:** the shared season/week (`SeasonWeekContext`, seeded from `currentWeek()` in
  `lib/logic/defaultWeek.ts`) reads only `schedule.json`, which already lists season 2026 —
  but the pipeline hasn't produced 2026 `player_week`/`team_week` extracts yet. Pages that
  fetched stats for the shared `season` with no fallback (Prop Bets, Value Bets, Player Team
  Stats, Matchup Bets — all in `pages/player-analysis/`) 404'd straight to `ErrorRetry`
  instead of falling back to last season's data, unlike Team Comparison/Scorecards which
  already handled this.
- Extracted the "decrement season and retry, bounded at 3 tries, reset on `retryTick`,
  optionally force `week` to `"0"` so a page's weeks-fixing effect re-snaps" pattern —
  previously duplicated verbatim in `TeamComparison.tsx` and `Scorecards.tsx` — into a new
  shared hook `lib/hooks/useSeasonFallback.ts`. Applied it to all four broken pages, and
  refactored `TeamComparison.tsx`/`Scorecards.tsx` to use it too, so the logic now lives in
  one place instead of six.
- Verified in the browser pane with no query params (so each page seeds off the shared
  season/week context, currently 2026 wk1 with no data): Prop Bets, Value Bets, Player Team
  Stats, Matchup Bets (via a Value Bets zoom-in link), Team Comparison, and Scorecards all
  fall back to season 2025 and render normally, zero console errors. `tsc -b`, `vite build`,
  and the 62-test Vitest suite all green. Not committed/pushed.

### 2026-08-03 (cont. x5) — Team detail popup: include the current/unplayed game too
- Follow-up: the popup's game-by-game table only listed graded seasons, skipping the
  current/unplayed one entirely (e.g. no 2026 row for Week 1). `teamGamesDetail`'s `g.played`
  filter dropped — now includes every season's occurrence of that team in that week number,
  with `teamScore`/`oppScore`/`win` going through as `null` for the ungraded one (rank/spread/
  opponent still populate normally, since those are known pre-kickoff). `TeamWeekModal`'s
  `TeamWeekGame` type updated to `number | null` / `boolean | null`; every derived cell (score,
  result, win-type chip) renders "—" for a null game; win-timeline chip gets a neutral slate
  "–" marker instead of W/L/T. Record/Win%/loss-count math tightened to check `g.win === false`
  explicitly (an unplayed `null` was previously falling through into the loss bucket via
  `!g.win`). Verified: KC's Week 1 popup now runs 2015–2026 (12 rows), with 2026 showing
  `vs DEN, -3, —, —, —` while the graded 9-2 record is unaffected; zero console errors; `tsc
  --noEmit`/62-test suite/build green.

### 2026-08-03 (cont. x4) — Team performance table: click a team for its Week N detail popup
- New `spread-analytics/TeamWeekModal.tsx`, opened by clicking any row on the "Team performance"
  table (`WeeklyBreakdownTab.tsx`) — reuses the shared `Modal` component (same one Power
  Rankings' team-detail popup uses). Order: headline KPIs (Record, Win %, Avg spread from the
  team's own side — negative = favored, Home/Away split) first, then a chronological win
  timeline (oldest→newest color chips, W/L/T per season — deliberately the opposite sort
  direction from the page's other newest-first tables, since a timeline reads forward), then
  the full game-by-game table (Season, Rank-within-that-week, Opponent, Spread, Score, Result,
  Win Type). Rank reuses `bySeasonForWeek`'s existing per-season grouping instead of
  recomputing it. Detail rows (`teamGamesDetail`) are only built once a team is actually
  clicked — same "don't compute what nobody asked for" rule as the collapsed full table.
  `getTeamMetaMap()` added back to this tab (only for the modal's logo/color) after being
  dropped in an earlier pass as unused. Verified: clicking KC on Week 1 opens the popup with
  the correct 9-2 record, 11-season timeline, and a game-by-game table whose Spread/Win-Type
  columns are internally consistent (e.g. 2023 `vs DET -4` "Underdog away" = KC favored by 4 at
  home, DET upset them); Escape/backdrop/✕ close correctly; zero console errors; `tsc
  --noEmit`/62-test suite/build green.

### 2026-08-03 (cont. x3) — Team performance table: join relocated franchises
- User spotted LV and OAK (Raiders) as separate rows on the new per-team Week N table — same
  franchise, different eras. Fixed by reusing `eloTeamKey()` (`lib/logic/elo.ts` — the alias Elo
  already carries pre-relocation ratings through: `SD->LAC, OAK->LV, STL->LA`) to normalize
  `home_team`/`away_team` before aggregating in `teamStats`, rather than adding a second parallel
  mapping. No other team-aggregated-across-seasons view exists in this app yet (checked — every
  other page is per-season or per-game, not summed across all-time by team), so this was the only
  spot needing it. Verified: table now shows exactly 32 rows (was 35, with LV/OAK/LAC/SD/LA/STL
  split), each with 11 games (2015–2025) instead of a partial split across the old/new abbreviation.
  `tsc --noEmit`/62-test suite/build green; zero console errors.

### 2026-08-03 (cont. x2) — Weekly Breakdown: collapsed full table + per-team Week N history
- Two follow-ups on the same tab. (1) The "every season" full game-by-game table (added the
  previous session) is now collapsed behind a "Show ▼" toggle (same pattern as Predictive
  Model Overview's "Why this model?" disclosure) — its row-building `useMemo` is gated on the
  open state (`showFullTable`) so the flatten/sort/rank work and the ~15+ rows/season of table
  markup are only paid for once opened, not on every visit to the tab. The always-on per-season
  summary chart got its own lighter `weekAcrossSeasonsSummary` memo so it isn't blocked by the
  same gate. (2) In the table's old always-visible spot: a new "Team performance — Week N
  historically" panel — straight-up win/loss record per team for the selected week number,
  aggregated across every REG season, with Best/Worst Week-N-performer callouts (min 3 graded
  games). First pass included an against-the-spread (ATS) variant (final score margin vs.
  closing spread_line) per the user's literal "best/worst vs spread" phrasing — user then asked
  to drop it: this page's whole convention is straight-up only (no ATS metric anywhere else in
  the app, an explicit decision from the previous session), so ATS was removed rather than kept
  as an option. `teamStats`/`teamHighlights` now straight-up only, aggregated directly from raw
  `schedule` rows (needs final scores, which `Game` doesn't carry). Verified: Week 1 2026 —
  KC/PHI best (82%, 9-2), IND worst (10%, 1-9); full table stays collapsed by default and
  expands/lazily-builds correctly on click; zero console errors; `tsc --noEmit`/62-test
  suite/build green.

### 2026-08-03 (cont.) — Weekly Breakdown: "this week number across every season"
- Follow-up user request on the same tab: a way to see how all historic occurrences of one week
  number (e.g. "every Week 1") looked, independent of the season selector. Added `weekAcrossSeasons`
  to `WeeklyBreakdownTab.tsx` — pools every REG game across all seasons matching the selected week
  number (own per-season rank, same |spread|-desc rule as the single-week view), rendered as (a) a
  dual-axis chart, avg |spread| per season (bar) vs that season's upset rate (line), and (b) a flat
  spread+result table, newest season first, with the currently-selected season's rows tinted so it's
  easy to spot in context. No new shared logic needed — reuses `Game`/`favWin`/`winType` already on
  hand. Verified: Week 1 across 2015–2026 renders correctly (2026 rows show "—" results, unplayed;
  2015–2025 show real ✓/✗ outcomes) with zero console errors; `tsc --noEmit`/62-test suite/build green.

### 2026-08-03 — Spread Win Percentage renamed to Spread Analytics; new Weekly Breakdown tab
- User request: rework the Spread Win Percentage page into a tabbed **Spread Analytics** page —
  Tab 1 keeps the existing page verbatim (renamed **Win Rate & Calibration**), Tab 2 is new
  (**Weekly Breakdown**): per-week "spread by game" bar chart (mockup provided, same shape as
  Game Picks' `spreadOption`), plus "which rank gets upset most" and "which games in this week
  look like upset candidates" — answerable today for 2026 Week 1 even though it hasn't kicked off
  (spreads exist, results don't).
- **Shell**: `SpreadAnalytics.tsx` (new) reuses Season Outlook's exact tabbed-route pattern
  (`useParams<{tab}>` + slug↔label map + redirect-bare-path-to-default effect + per-tab sub-URL,
  `/game_analysis/spread_win_percentage/:tab` added to `App.tsx` next to Season Outlook's own
  block) — bare URL/nav entry unchanged, old bookmarks still resolve via the redirect.
- **Tab 1**: `SpreadWinPct.tsx` moved to `spread-analytics/WinRateTab.tsx` near-verbatim (own
  `<h1>` stripped, shell now owns it) — zero calculation changes.
- **Tab 2** (`spread-analytics/WeeklyBreakdownTab.tsx`, new): "Upset" = favorite loses
  straight-up (`favWin`/`winType`, the only outcome metric that exists anywhere in this app — no
  ATS-cover metric, confirmed via AskUserQuestion the user doesn't want one added). Rank = a
  game's position within its week sorted by `|spread|` descending (1 = biggest favorite),
  aggregated across every REG season/week (`computeRankStats`, new in `spreadPicks.ts`) into an
  "upset rate by rank" chart. Per-game historic favorite win % reuses the Weekly Picks p̂ calc —
  extracted out of `computeWeekPicks` into a standalone `historicFavRate(reg, excludeSeason,
  excludeWeek, binSize, signed)` so both stay numerically identical (`computeWeekPicks` now just
  calls it). The spread-by-game bar chart colors by actual `WIN_TYPE_COLORS` outcome once a game
  is played, or by a Low/Medium/High historic-upset-risk tier (`1 − p̂`) while still unplayed —
  deliberately *not* Game Picks' local-pick-based coloring, since that page's colors come from
  the user's own localStorage picks rather than any real signal. An "upset candidates" table
  ranks the selected week's games by that same risk score, top-5 highlighted.
- Verified live at 2026 Week 1 (all 16 games unplayed): KPIs/bar chart/candidates table all
  populate correctly via risk coloring (previously this kind of week rendered as blank N/A on
  Win Rate & Calibration's default-latest-season selection — the reported "can't see 2026 games"
  symptom); re-verified at 2025 Week 18 (fully played) to confirm the actual-outcome branch and
  real upset flags. `tsc --noEmit`/62-test suite/`npm run build` green throughout; zero console
  errors in both branches.

### 2026-08-03 — Fixed: 2026 season rollover wasn't actually reliable (fetch_schedules cache bug)
- User asked to review the Aug-1 season-rollover feature (`config.current_season()`, documented
  2026-07-21). Found it was **not working**: `app/public/data/schedule.json` on `main` had zero
  2026 rows despite today being past the cutover — `data/raw_cache/schedules.parquet` was cached
  Jul 17 (pre-cutover) as a single multi-year blob, and `fetch_schedules()` only refetched on
  `--refresh`. `fetch_weekly()` already cached per-year, so a new season fetched naturally with no
  cache file yet — `fetch_schedules` was the inconsistent one and the actual bug. Production
  (`weekly-refresh.yml`) always passes `--refresh` so this would've self-healed next Tuesday
  regardless, but the "schedule shows up automatically on Aug 1" promise wasn't actually true in
  the meantime (and had already shipped stale to `main`).
- **Fix**: `fetch.py:fetch_schedules` rewritten to cache per year (`schedules_{year}.parquet`,
  mirroring `fetch_weekly`'s loop/skip pattern), including the same skip-newest-season-on-failure
  grace period. No caller changes — `transform.py:load_schedule_df` unchanged.
- Regenerated data (`--stage all --refresh` once, deleted the orphaned `schedules.parquet`):
  `schedule.json` now has 272 2026 rows (all unplayed, `home_score`/`away_score` null); `meta.json`
  correctly still reports `current_season: 2025` and excludes 2026 from `seasons` (no `team_week`
  data yet, per the 2026-08-02 fix in `known-issues.md` #18) — the two "current season" concepts
  stay correctly decoupled. Re-ran `--stage all` **without** `--refresh` immediately after: 2026
  rows persisted, confirming the new season no longer depends on a full refresh to appear.
- Verified live: Home's "this week" banner now shows Week 1 2026 (Sep 8–13) with real matchups and
  "Make this week's picks →"; Matchup Previews defaults to 2026 Week 1, all 7 models render picks,
  predictive model correctly excludes itself (no training data for 2026 yet) instead of crashing;
  zero console errors. `--stage validate` green. No frontend code changes needed — `defaultWeek.ts`/
  `SeasonWeekContext`/`defaultWeekNearToday` already derive purely from exported JSON.

### 2026-07-28 — Power Rankings folded into Season Outlook as its first tab; per-tab sub-URLs; expected-wins KPI now states game count
- **Power Rankings moved into Season Outlook**: was its own standalone nav item/page
  (`/game_analysis/power_rankings`); now the first of Season Outlook's 3 tabs (ahead of
  Strength of Schedule and Playoff Probability — see the story ordering, `nav.ts`). Table +
  detail-popup logic unchanged, extracted verbatim from `pages/game-analysis/PowerRankings.tsx`
  (now deleted) into `pages/game-analysis/season-outlook/PowerRankingsTab.tsx` as a prop-driven
  tab component (season/week/schedule/grades/meta all owned by `SeasonOutlook.tsx`, same as the
  other two tabs — no more separate Select/week-stepper). `nav.ts`'s Power Rankings entry
  removed; Season Outlook's description updated to mention it; Home's card count picked it up
  automatically (still 7/7 Game Analysis pages, just one fewer nav-level entry).
- **Each Season Outlook tab gets its own sub-URL**: `/game_analysis/season_outlook/power_rankings`,
  `/strength_of_schedule`, `/playoff_probability` — `App.tsx` adds an explicit
  `/game_analysis/season_outlook/:tab` route (reusing the existing lazy `SeasonOutlook` import,
  not a second lazy() call) ahead of the generic `NAV_GROUPS`-driven route loop, so the bare
  `/game_analysis/season_outlook` (what `nav.ts`/Home link to) still renders the same page, which
  now redirects (`navigate(..., {replace:true})`) to the default tab's sub-URL on mount if `:tab`
  is missing/unrecognized. Old `/game_analysis/power_rankings` bookmarks/links redirect to
  `/game_analysis/season_outlook/power_rankings` via a `<Navigate>` route. `Navbar.tsx`'s
  group-active-highlight check widened from exact match to prefix match (`pathname === p.path ||
  pathname.startsWith(p.path + "/")`) so the Game Analysis dropdown still highlights while on any
  Season Outlook sub-tab; per-item `NavLink` highlighting needed no change (v6 default already
  prefix-matches without `end`). Verified in-browser: default load lands on Power Rankings tab
  with correct sub-URL, switching tabs updates the URL and page title, old power-rankings URL
  redirects correctly.
- **Playoff Probability team-detail KPI now shows remaining-game count**: per user request ("see
  the games plus expected win %... in a friendly and good way without cluttering"), the existing
  "Expected additional wins" KPI tile in `season-outlook/DetailModal.tsx`'s top stat bar now reads
  "Expected wins over N remaining games" (N = `result.remainingGames.length`, singular/plural
  handled) instead of a bare label — no new tile added, and the detailed per-game remaining-schedule
  list further down (opponent/Elo/win% rows) was deliberately left untouched per explicit user
  confirmation during this session.

### 2026-07-27 — Models Guide cleanup: order, stale copy, Trend Edge contributions, back-nav
- **Card order**: reordered to match `MODEL_KEYS` (Average, ML Fair, Market-calibrated,
  Predictive, Elo, Pythagorean, Trend Edge) — the same order used everywhere else (Week
  Preview rows, Matchup verdict strip, Model Overview picker), so the guide reads the same
  left-to-right as the rest of the page instead of its own ad hoc order.
- **Stale copy fixed**: Average (consensus)'s card cited a fixed calibration snapshot ("53% in
  the 50-55% band up to 81% in the 80%+ band" on "~2,300 games") left over from before the
  Market-calibrated/Trend Edge recalibrations — no longer accurate (current live numbers per
  Model Overview: 51%/59%/67%/70%/75%/90% across the bands, 2,232 games). Replaced the hardcoded
  numbers with a link to the live Model Overview → confidence-band chart (same pattern already
  used by the Predictive card's "no confirmed edge" link) so this can't go stale again. Also
  added model-name labels next to each home-probability pill in the worked example (was
  color-dot-only — unreadable without memorizing every model's color from elsewhere on the page).
- **Trend Edge worked example** now shows each of the 5 components' raw stat (both teams), the
  diff, the weight, and the resulting weighted contribution (`edgeComposite`'s `gradeD`/`pmL6D`/
  `epaL6D`/`winL6D`/`tomL6D`, which were already computed but previously only rendered in
  `MatchupTab`'s bar chart, not here) — was previously just the 5 raw stats per team and the
  final summed edge, with no visibility into which component actually moved the number.
- **Back-navigation fix**: "← Back to Matchup Previews" was hardcoded to the bare route, always
  dropping the user back on Week Preview regardless of which tab (or, on the Matchup tab, which
  game) they came from — `MatchupPreviews`' `tab` state and `MatchupTab`'s `season`/`week`/
  `gameId` state were local React state only, never written to the URL. Fixed by: (1)
  `MatchupPreviews.tsx` now syncs `tab` into `?tab=` on every change (`replace: true`, no history
  spam); (2) `MatchupTab.tsx` now syncs `season`/`week`/`game` into the URL the same way; (3) the
  "How the models work" link captures `location.pathname + location.search` as an encoded `back`
  param; (4) `ModelsGuide.tsx` reads `back` for the Back link's href, and also seeds its own
  season/week/game selects from the same captured values so the worked example defaults to the
  exact game you were looking at, not always the newest week's first game. Verified in the
  browser pane: switched to Matchup tab, picked KC @ LV, clicked through — worked example
  defaulted to KC @ LV, Back link returned to the Matchup tab with KC @ LV still selected; same
  round-trip verified from the Model Overview tab.
- `npm test` (60/60), `tsc --noEmit`, `npm run build` all clean.

### 2026-07-27 — Market-calibrated: vig-lean + team-ATS extras (85/15) so it's not just ML Fair
- Follow-up to the pure-market change below. Feedback: pure bucket history is too similar to
  ML Fair for ensemble purposes (both just answer "what does the market think") — needed an
  original ingredient distinct enough to justify Market-calibrated as its own model.
- Explored 4 directions (spread-odds vig lean, team-specific ATS trend, situational/div_game
  bucketing, Vegas-implied team totals) and backtested the two the user picked, at first as a
  straight 50/50 replacement of bucket history (`market_v2_backtest.js`, scratch, not
  committed), over ~2,700-2,884 REG games 2015-2025 with the relevant data available:
  - **Spread-odds vig lean** (vig-free "home covers" prob from `away_spread_odds`/
    `home_spread_odds`, centered at 0): AUC 0.538 standalone, and the *raw* direction is
    inverted (home-leaning juice weakly predicts home *losing*) — sign-corrected via the fitted
    logistic scale (`VIG_SCALE=-10.15`) rather than hardcoded. Likely public-money noise more
    than sharp signal, but present.
  - **Team ATS trend** (rolling cover rate, home − away): tested L3/L5/L8/L10/L16 windows —
    AUC rises monotonically with window length same as Trend Edge's finding, topping out at
    AUC 0.557 for L16 (~full season). Makes sense: ATS records are close to random by
    construction (the spread is built to make covering a coin flip regardless of team quality).
  - **50/50 replacement of bucket history**: AUC 0.562, Brier 0.248, hit-rate 53.6% — far below
    pure bucket history's AUC 0.690 / Brier 0.214 / hit-rate 66.5% on the same games. Reported
    this to the user rather than shipping a near-coin-flip model.
  - **Division-game adjustment**: dropped. Favorite win rate is 65.95% in div games vs. 65.06%
    non-div (n≈1,000 each) — statistically indistinguishable from noise. It only shows up
    faintly in *cover* rate (47.96% vs 49.21%), which isn't the target variable this model
    predicts (win probability, not ATS). No adjustment applied; documented as a tested-and-null
    result rather than silently omitted, same treatment as the Predictive model's "no confirmed
    edge" finding.
  - **Grid search, w·bucket + (1−w)·[vig+ATS average]**: hit-rate and Brier stay ~flat from
    w=1.0 down to w=0.85 (66.53% hit-rate unchanged, Brier 0.2139→0.2170), then degrade faster
    below w=0.8 (hit-rate drops to 63.9% at w=0.75, 56.0% at w=0.5). Picked **w=0.85** — keeps
    bucket history's accuracy essentially intact while giving the two extras real (15%) weight.
- Implementation: `probBlend.ts` gained `MARKET_BUCKET_W=0.85`, `ATS_WINDOW=16`,
  `VIG_SCALE=-10.15`, `ATS_SCALE=0.535`, `homeCoverFairProb` (reuses `moneyline.ts`'s
  `fairProbs` — it's generic American-odds vig removal, not moneyline-specific),
  `vigLeanProbHome`, `atsTrendProbHome`, `marketCalibratedProbHome` (falls back gracefully:
  pure bucket if both extras missing, weighted-in whichever extras exist otherwise). `engine.ts`
  `HistAgg`/`buildHist` now also accumulate each team's per-season ATS cover history in the same
  pass as the bucket counts (added `atsByTeamSeason` + `atsRate()`) — threading through the
  existing `hist` parameter meant zero signature changes needed at any of `probBundle`'s 5 call
  sites (`ModelOverviewTab`, `WeekPreviewTab`, `MatchupTab`, `ModelsGuide`, `ModelPickerTab`).
  `MatchupTab.tsx`'s pick-engine card and `ModelsGuide.tsx`'s worked example both now show the
  bucket-history bar plus the two extra bars with their own probabilities, so the blend is
  visible, not just the final number. Also dropped several now-dead fields (`pHome`/`pAway`/
  `pickTeam`/`conf`) from `MatchupTab`'s `engine` useMemo that were leftover from the earlier
  grade-blend version and had no remaining reader.
- `npm test` (60/60 — added a `describe("Market-calibrated extras")` block covering the vig/ATS
  logistic helpers and the fallback/weighting behavior of `marketCalibratedProbHome`),
  `tsc --noEmit`, `npm run build` all clean. Verified in the browser pane: Matchup tab's
  Market-calibrated card shows all three component bars (bucket history, vig lean, ATS trend)
  with the 85%/15% weight note; Models Guide's worked example prints the vig-fair-cover % and
  both teams' ATS-L16 rates alongside the blended result.

### 2026-07-27 — Market-calibrated: removed the grade blend entirely (backtested)
- Follow-up to the recalibration below, per explicit user direction: "remove the blend...
  see the results, if accuracy is good keep; if it decreases, blend to a lesser degree with
  ML fair instead."
- Extended `market_calib_backtest.js` (scratch, not committed) to compare, over 2,877 REG
  games 2015-2025 with market history available: **pure market** (Wilson-smoothed bucket rate,
  no blend) vs. the just-shipped **N-adaptive grade blend** vs. a grid of **market/ML-Fair**
  blends (1.0→0.0 in 0.1 steps):
  - Pure market vs. grade blend: AUC 0.6886 vs 0.6981 (slightly worse), but **Brier 0.2144 vs
    0.2192 and hit-rate 66.46% vs 64.82% (both better)** — on the metrics that matter for a
    pick engine (calibration + correct picks), removing the grade blend didn't hurt.
  - Every market/ML-Fair blend ratio tested beat pure market on every metric (best: AUC up to
    0.718, Brier down to 0.2124) — confirms the fallback plan (blend with ML Fair, not grades)
    would have been the right move had accuracy actually dropped.
  - On the thin-bucket subset (n<25, 148 games) — the exact case the earlier N-adaptive fix
    targeted — pure market actually has the best AUC (0.8385) of the three, ahead of both the
    grade blend (0.8112) and an ML-Fair blend (0.8208); the market/ML-Fair blend edges it out
    only on hit-rate (85.81% vs 84.46%) and Brier.
- **Decision: kept pure market, no blend.** `probBlend.ts` now exports only bucket-bin
  constants + `nFactor`/`confidence` (display-only); `gradeModelProb`, `blendProbs`,
  `BLEND_MARKET_W`, `BLEND_MODEL_W`, `MODEL_SCALE` all removed (dead — Market-calibrated was
  their only consumer; Trend Edge's grade feature uses the raw grade value directly, not this
  logistic). `engine.ts` `probBundle`'s market-calibrated branch is now just the bucket's
  Wilson rate; `MatchupTab.tsx`'s pick-engine card drops the "Grade model" bar and blend-ratio
  note (single "Bucket history" bar + low-N risk flag); `ModelsGuide.tsx` copy/worked example
  updated to describe pure market history. Left a comment in `probBlend.ts` pointing at the ML
  Fair fallback plan and the backtest numbers for whoever revisits this.
- `npm test` (55/55, two describe blocks replaced: the grade-model/blend golden tests are gone
  since there's nothing left to test there; added direct `nFactor`/`confidence` unit tests),
  `tsc --noEmit`, `npm run build` all clean. Verified in the browser pane: Models Guide's
  Market-calibrated card and Matchup tab's pick-engine card both render the pure-market number
  with no blend UI.

### 2026-07-27 — Recalibrated Market-calibrated + Trend Edge models (Matchup Previews)
- **Market-calibrated** (`lib/logic/probBlend.ts`): the market side's blend weight is now
  adaptive to the historical bucket's sample size instead of a fixed 60/40 split — confirmed
  via `schedule.json` that extreme-spread buckets (e.g. `-17.0 to -16.0`) have as few as 1-17
  historical games, so the fixed 60% market weight was overstating confidence there even after
  Wilson smoothing. New: `w = BLEND_MARKET_W · min(1, n_bucket/MIN_N_BUCKET)`, `p =
  w·p_market + (1-w)·p_model`. At `n_bucket >= 25` this is identical to the old fixed 60/40 —
  no change for well-populated buckets. `confidence()` and `blendProbs()` now share one
  `nFactor(n)` helper (was duplicated inline in `MatchupTab.tsx` too).
- **Trend Edge** (`lib/logic/edgeComposite.ts`): variables, windows and weights were previously
  hand-picked with no empirical backing. Ran an AUC backtest (scratch Node script, not
  committed) over all REG games 2015-2025 against `schedule.json` outcomes, `team_week/*.json`
  (~20 candidate stats × L2-L6 mean windows + L4-L6 slope windows), and `grades.json`:
  - The old "PM-slope" momentum term (weight 0.10) backtested at AUC ~0.51-0.52 — essentially
    coin-flip — across every window tested. Dropped, replaced with recent win rate (`win`,
    L6), which backtested at AUC 0.642.
  - Every stat family tested (points_margin, epa_diff, win, total_yards, completion_pct, …)
    scored higher at longer windows; L3 was never the best window for anything. Switched all
    surviving mean features from L3 to L6.
  - Final 5: grade (season-to-date, unchanged), points_margin-L6, epa_diff-L6, win-L6,
    turnover_margin-L6. Weight of each = its own AUC lift (AUC−0.5) normalized to sum to 1
    (avoids the sign-flip a joint multi-feature logistic regression produced on
    turnover_margin due to collinearity with the other 3 form stats) →
    `{grade: 0.21, pmL6: 0.23, epaL6: 0.22, winL6: 0.22, tomL6: 0.12}`. `EDGE_SCALE` refit via
    1D Platt scaling: 0.12 → 0.074.
  - Backtest comparison, 2,595 REG games (2015-2025, week ≥ 2): AUC 0.6431 → 0.6520, Brier
    0.2452 → 0.2343 (lower is better), hit-rate 60.81% → 61.12%.
- Updated call sites (`engine.ts` `probBundle`/`buildTeamWeekIndex`, `MatchupTab.tsx`'s pick
  engine + Trend Edge bar chart, `ModelsGuide.tsx`'s worked examples and both `ModelCard`
  copy blocks) and `docs/logic-reference.md` §5. Regenerated the `edgeComposite` golden
  fixtures in `logic.test.ts`/`golden.json` (field names changed: `pmL3`/`epaL3`/`tomL3`/
  `pmSlope` → `pmL6`/`epaL6`/`winL6`/`tomL6`) and added shrinkage-specific `blendProbs` tests.
  All 7 other models (ML Fair, Elo, Pythagorean, Predictive, Average) and every other page are
  untouched. `npm test` 59/59 green, `tsc --noEmit` clean.

### 2026-07-27 — Season Outlook: click-to-zoom Monte Carlo detail modal
- Playoff Probability tab (`season-outlook/PlayoffTab.tsx`) rows are now clickable, opening a
  new `season-outlook/DetailModal.tsx` (modeled on Power Rankings' `DetailModal.tsx`, same
  `Modal`/`useECharts` building blocks) showing the math behind that team's number: a win-total
  histogram and a playoff-seed histogram (both bar charts over the same 2,000 simulated
  seasons), plus the team's remaining schedule with the actual Elo-implied win probability the
  simulation draws from for each game (opponent, both teams' frozen Elo ratings, a probability
  bar).
- `lib/logic/playoffSim.ts`'s `simulatePlayoffs()` now also returns `winsHistogram` (index =
  win total 0-17), `seedHistogram` (index 0 = missed playoffs, 1-7 = seed), and
  `remainingGames` (per-team, computed once from the already-built frozen Elo ratings, not
  re-simulated) on `PlayoffSimResult` — all accumulated for free inside the existing
  2,000-iteration loop, so the table and the modal read from the same simulation run (can't
  disagree).
- Verified in the browser pane at week 10, 2025: Green Bay Packers row (77.6% playoff / 27.8%
  division title / 9.8 avg wins in the table) opened a modal showing the same numbers, wins
  histogram centered near 9.8, "Simulated seasons 2,000 / Playoff appearances 1,553 / 2,000"
  (1553/2000 = 77.6%, consistent), and 8 remaining games with win probabilities that track Elo +
  home-field correctly (e.g. @ DET 1612 vs 1668 → 35.4%; vs BAL 1612 vs 1590 → 59.9%). Esc closes
  the modal; clicking a different (0%-playoff) team correctly re-renders. `tsc --noEmit` and
  `npm run build` both clean.

### 2026-07-27 — Season Outlook detail modal: current record + wins-so-far marker
- Follow-up to the drill-down modal above, per user request: `PlayoffSimResult` gained
  `currentWins`/`currentLosses`/`currentTies` (from the already-computed `base` per-team state —
  the actual record through `throughWeek`, not simulated). Modal now shows a "Current record +
  Expected additional wins = Projected final wins (avg)" strip at the top, and the win-total
  distribution chart got a dashed `markLine` at the current-wins bar so it's visually obvious
  which bars represent wins already banked vs. simulated upside.
- Verified in the browser pane (2025, week 10): Green Bay Packers shows "Record 5-3-1 · current
  wins 5 · expected +4.7 · projected 9.7" (5 + 4.7 = 9.7, matches the table's Avg wins), dashed
  marker visible left of the peak of the histogram. `tsc --noEmit`/`npm run build` clean.

### 2026-07-27 — Season Outlook: Record + Expected wins columns on the main table
- Follow-up per user request: the Playoff Probability table (`PlayoffTab.tsx`) now has two new
  columns between Division and the %-columns — **Record** (current W-L(-T) through the selected
  week, `recordStr(currentWins, currentLosses, currentTies)`) and **Expected wins** (avg wins
  still to come, `avgWins - currentWins`, signed) — so the existing Avg wins/Avg seed/percentage
  columns now sit next to the record they're projected from, without opening the drill-down
  modal. Same `PlayoffSimResult` fields the modal already uses; no simulation changes.
- Verified in the browser pane (2025, week 10): e.g. Eagles 7-2 / +5.8 / 12.8 avg wins
  (7 + 5.8 = 12.8, consistent); `tsc --noEmit`/`npm run build` clean.

### 2026-07-21 — Season-range cutoff moved to August
- `config.current_season()` rollover moved from September 1 to August 1 (user request): the new season's schedule is published by nflverse well before kickoff (verified live: 2026 schedule, 272 games, already present via `nfl_data_py.import_schedules([2026])` in July 2026), so the new season can enter the app a month earlier as schedule-only data. No scores/stats until games are actually played — same "unplayed game" code path already used for in-season future weeks. Updated docstring, `SEASONS` comment, and `docs/pipeline-runbook.md`.

### 2026-07-21 — Home CTA reflects week status, clearer Game Picks action icons
- **Home "this week" CTA**: the launchpad button now reads "See week results →" once every game in the current week is final, "Make this week's picks →" otherwise (was a static "See this week's picks →" regardless of state) — `Home.tsx` compares `played` (games with a final score) against `cw.games.length`.
- **Game Picks action icons**: the two per-row cross-link icons (added Session 7) swapped from ⚔️/🆚 to 🧭 (Matchup Preview) and ⚖️ (Team Comparison) — better matches what each linked page actually shows (a preview/guide vs. a side-by-side comparison) rather than generic "vs" iconography.
- Small, isolated follow-up requests; not run against the full verification checklist (no test/build changes — presentational only).

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

**Next (updated 2026-07-21 — the list above was superseded by this same file's later 2026-07-20 entries):** M4/M5 are functionally complete. Verified against current source on 2026-07-21 (not just prior log claims):
- Home launchpad, unified glossary, Team Comparison cross-links, shared default-week rule, Parlay reset — all done (see 2026-07-20 entries above).
- Parlay Builder's player list honoring season_type, and Scorecards/Matchup-tab grade+rank context — both already implemented in source (`ParlayBuilder.tsx`'s `typed` filters by `leg.seasonType`; `Scorecards.tsx`'s `gradeInfo` and `MatchupTab.tsx`'s `gradesIdx.rank` both show league rank next to every grade) — the "still open" notes below about them were stale.
- Win-type color-only encoding and the Spread-Win%-vs-Matchup-Previews disagreement callout remain **explicitly declined by the user**, not gaps — see the 2026-07-20 session notes above.
- M5 weekly-refresh automation **verified end-to-end via the GitHub Actions API** (public, unauthenticated): `weekly-refresh.yml` run `29833256531` fired on `schedule`, `conclusion: success` (2026-07-21T13:10–13:12 UTC); `deploy.yml` shows a matching `workflow_dispatch` run at 13:12:37 UTC with `conclusion: success` — the full cron → pipeline → validate → commit → dispatched-deploy chain has actually run and succeeded once, not just produced a data commit.
- No confirmed gaps remain from the UX audit as of this pass. See `docs/UX_AUDIT.md`'s prioritized summary, now reconciled to match.

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
