# Known issues / quirks in the original app

Carried over **knowingly** in Phase 1 for parity. Do not fix without logging the deviation here
and in `page-mapping.md`.

## Data / model layer
1. **Defensive grading skips `_apply_directionality`.** Offense/overall grades flip bad-when-high
   features before weighting; the defensive model instead inverts only the *final* score
   (`100*(1-…)`). Forced-turnover `_allowed` features therefore point the "wrong" way inside the
   defensive weighted sum. Preserved verbatim (`grading_model_utils.py:140-197`).
2. **Model cache signature** hashes only distinct (team, season, week) rows — value changes within
   an existing week do not invalidate `model_results.pkl`. New pipeline recomputes every run, so
   this quirk disappears operationally, but grade values still depend on the full dataset shape.
3. **Inconsistent feature exclusions**: offense drops `total_tds, points_margin, fantasy_points,
   fantasy_points_ppr`; overall drops `total_tds, fantasy_points, fantasy_points_ppr, points,
   points_allowed, epa_diff`. `receiving_*` stats double-count vs `passing_*` team-level (both sides
   of the same play summed into the same team row). Preserved.
4. **Grades are double-normalized**: per-model min-max to 0–100, then `compute_all_model_results`
   min-max scales each grade column again (NaNs filled with 0 *before* scaling, which drags the min).
5. **`turnover_margin`** uses opponent's lost fumbles + opponent interceptions thrown ("takeaways")
   minus own turnovers — correct in meaning but computed from `_allowed` columns, so it is NaN when
   opponent rows are missing.
6. **`win`** is `points > points_allowed` cast to int — unplayed games become 0 (loss), not NaN.
   Models train on those rows for future weeks with stats missing (filled 0).
7. **Cumulative ranks** use `method='min'` and rank *all* teams present in a season-week, including
   non-REG rows if present in input.

## Pages
8. Duplicate `_season_records()` in `season_tab.py` (identical copies).
9. Duplicated implementations across pages (consolidated in the rebuild's `lib/logic/`):
   spread binning ×3, Wilson CI ×3, edge composite ×2, moneyline column detection ×2,
   `_weeks_for_season` ×2.
10. Dead callback `update_team_scorecard` in `scorecards_teams_page_4.py` (output not in layout).
11. Hardcoded `America/Monterrey` timezone for "closest week" defaults.
    **Deviation:** rebuild uses browser-local timezone.
12. `home.py` hardcoded countdown to 2025-08-22. **Deviation:** dropped/replaced on new Home.
13. `game_id` parsing (`YYYY_WW_AWAY_HOME`) unvalidated. **Deviation:** rebuild validates.
14. Weekly-picks "N" column in spread page uses top-filter N, not historical N (confusing label).
15. Win-count KPI order in week_preview is [FH, UA, FA, UH] (non-intuitive but preserved).
16. Old settings/upload pages replaced by the pipeline (deliberate scope change).

## New-pipeline quirks (not from the old app)

17. **`player_week` upstream source fallback risk.** `fetch.py:_load_player_week_year_with_fallback`
    tries `nfl_data_py.import_weekly_data()` first, falling back to `nflreadpy.load_player_stats()`
    on any exception for that year. The two libraries return structurally different schemas —
    `nflreadpy` covers every position (incl. DEF/K/P/ST) and ~90 extra stat columns `nfl_data_py`
    never produces. This was discovered 2026-08-02 when 2025 silently fell back mid-run, producing a
    `player_week/2025.json` ~7x the size of every other season (13.7 MB vs ~2 MB, 144 cols/19,421
    rows vs ~56 cols/~5,600 rows) and a Stat dropdown with ~90 more options than any other season on
    the player-analysis pages — not a duplication bug (0 duplicate rows), a genuine schema mismatch.
    **Fixed at the export layer** (`export_json.py`'s per-season loop, implemented 2026-08-02): only
    the season(s) whose `player_week_df` rows actually carry `source == "nflreadpy"` get filtered —
    down to the position groups that make up >1% of the `nfl_data_py`-sourced rows (a share
    threshold, not raw presence, since even `nfl_data_py` seasons carry a handful of mis-tagged
    non-skill-position rows) and the column set those same rows populate. Seasons that were never
    touched by the fallback are exported byte-identical to before (confirmed via `git status` showing
    only `player_week/2025.json` changed after a full re-export). `fetch.py` itself (and therefore
    `player_week_df`, which nothing in the grading/predictive models references) is untouched, and
    `parity.py`'s player_week check compares the raw pre-export frame, not the export — so this fix
    has no parity-gate impact (confirmed: `--stage parity` and `--stage validate` both pass after the
    fix). Result: `player_week/2025.json` is now 2.2 MB / 53 cols / 6,383 rows, in line with every
    other season.

18. **`meta.json`'s `seasons` list could overclaim season coverage.** `export_json.py` used to write
    `SEASONS` (the `config.py` constant, a theoretical range through `current_season()`, which rolls
    forward every August) verbatim into `meta.json`, rather than the seasons that actually got
    exported per-season files. `fetch_weekly` already skips fetching an unpublished newest season
    with a warning (see `config.py`'s grace-period comment) — so the moment the calendar rolls into
    August before nflverse publishes the new season's data (discovered 2026-08-02, the day this was
    fixed), `meta.seasons` would include a season with no `team_week`/`team_week_ranks`/`player_week`
    files at all. Any page that loops over `meta.seasons` (`MatchupPreviews.tsx`, `ModelsGuide.tsx`)
    would then request a genuinely missing file for every such season — silently hanging/failing
    before `docs/MOBILE_READINESS.md`'s Phase 8 reliability work (P8.2) started surfacing fetch
    failures visibly instead of leaving them as an infinite spinner. **Fixed:** `meta.json`'s
    `seasons` now derives from `team_week_df["season"].unique()` — the same set the per-season export
    loop actually iterates over — instead of the raw `SEASONS` config constant. `current_season` (a
    separate field, derived from played games) was already correct and is unchanged.
