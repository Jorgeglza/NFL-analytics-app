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

### M2 — TS data layer + shared logic ◐
- ✅ Vite + React + TS + Tailwind v4 + ECharts + TanStack Table + react-router (HashRouter for static hosting); `npm run build` green
- ✅ `src/lib/data/loader.ts` (compact column format), `src/lib/team/meta.ts` (colors/logos/WCAG)
- ✅ `src/lib/logic/`: winType, wilson, spreadBins, moneyline, probBlend, edgeComposite, gameId, ranks
- ☐ Vitest golden-fixture tests for the logic modules (pipeline should emit fixtures to `app/src/lib/logic/__fixtures__/`)
- ☐ zod schemas (loader currently returns untyped records)

### M3 — Page-by-page parity (order = simplest data first)
- ◐ Home (functional; final design in M4)
- ◐ /game_analysis/game_picks — table + win-type stacked bar + spread scatter working with filters. TODO: manual-winner checkboxes for unplayed games (localStorage), collision ×N badges on scatter, side-by-side number check vs old app.
- ✅ /game_analysis/win_types — Season/Week toggle, per-block KPIs + stacked win-type bar (count|% labels, dashed Home-Favorite line) + spread scatter with ×N collision markers. Numbers verified vs pandas replica of old logic: KPIs exact on 4 seasons + 3 weeks; category counts exact for 2024 (season & week 1). Old-page quirks preserved (played pick'em → Underdog; played ties → "(No Score)" buckets; tie games count in win-% denominators).
- ✅ /game_analysis/spread_win_percentage — filters (multi season/week, win types, bin size, signed/abs, min-N, CI), 6 KPIs, calibration/stacked/heatmap/lift charts, bucket table, Weekly Picks panel. KPIs + bin aggregates + Wilson p̂ verified exact vs pandas replica. Grid-aligned buckets replace pd.cut edges (deviation: pandas silently dropped a game whose |spread| hit the exact top edge; we keep it).
- ✅ /data/grading_model (Season, Teams, Weekly, Features tabs) — contributions via contrib_params.json (weekContributions in lib/logic/contributions.ts). Weekly tab KPIs/rank/Z/percentile and Teams-tab avg scaled contributions (DAL 2025) verified exact vs pandas replica; season averages match.
- ☐ /game_analysis/team_comparison
- ☐ /game_analysis/scorecards_teams
- ☐ /game_analysis/matchup_previews (Week Preview, Matchup, Model Overview tabs)
- ☐ /player_analysis/prop_bets_players
- ☐ /player_analysis/build_parlay
- ☐ /player_analysis/player_team_stats
- ☐ /player_analysis/matchup_bets
- ☐ /player_analysis/value_bets
Per page: run old app side-by-side (`pda-ie` env), match tables/KPIs/chart series on ≥3 filter combos (incl. unplayed games, week 1, multi-season). Log deviations in page-mapping.md.

### M4 — UI modernization (zero logic changes)
- ☐ Responsive layouts, no clipped labels/overlap, loading/empty states, consistent spacing

### M5 — Deploy + automation
- ☐ `.github/workflows/weekly-refresh.yml` (cron Tue 12:00 UTC + dispatch → pipeline → validate → auto-commit)
- ☐ `.github/workflows/deploy.yml` (build → GitHub Pages, SPA fallback + Vite `base`)
- ☐ Push to GitHub, first workflow run verified

## Session notes (newest first)

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
