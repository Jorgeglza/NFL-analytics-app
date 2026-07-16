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
