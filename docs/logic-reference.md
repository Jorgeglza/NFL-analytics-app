# Logic reference — every formula in the app

Source file references point to the original app (`..\NFL app`). The pipeline/frontend must
reproduce these exactly (Phase 1).

## 1. Schedule derived columns (`data_utils.py:load_schedule_df` + `calculate_win_flags`)
- `spread_line = raw_spread_line * -1` (flipped to home perspective: negative ⇒ home favored)
- `Winner`: home/away/tie/None (None if either score missing)
- `Favorite`: spread<0 → home; spread>0 → away; 0 → "none"; NaN → None
- `Favorite Win`: 1 if Winner==Favorite, 0 otherwise; None on tie/missing
- `Home Win`: 1/0/None
- `Win Type`: (Favorite Win, Home Win) → Favorite home / Favorite away / Underdog away / Underdog home
- Colors: FH `#3C9A5F`, FA `#2459A7`, UH `#E87722`, UA `#C8102E`; "No Score" gold `#D4AF37`

## 2. team_week (`data_utils.py:get_team_week_stats`)
Player-week rows summed by (team, season, week, season_type, opponent_team, gameday, game_id, game_type)
with `sum(min_count=1)`. Then:
- `total_yards = passing_yards + rushing_yards`; `total_tds = passing_tds + rushing_tds`
- `yds_per_pass = passing_yards/attempts`; `yds_per_rush = rushing_yards/carries`
- `completion_pct = completions/attempts`; `td_per_attempt = passing_tds/attempts`;
  `int_per_attempt = interceptions/attempts`
- `turnovers = interceptions + rushing_fumbles_lost + receiving_fumbles_lost + sack_fumbles_lost`
- `team_stats_id = game_id + "_" + team`
- `points` merged from schedule home/away scores
- Opponent flip: every numeric col re-merged as `{col}_allowed` on (season, week, team↔opponent)
- `win = int(points > points_allowed)`; `points_margin = points - points_allowed`
- `turnover_margin = interceptions_allowed + rushing_fumbles_lost_allowed +
  receiving_fumbles_lost_allowed + sack_fumbles_lost_allowed - turnovers`
- `epa_diff = round((passing_epa + rushing_epa) - (passing_epa_allowed + rushing_epa_allowed), 2)`

## 3. Cumulative ranks (`data_utils.py:get_cumulative_team_week_ranks`)
Per (season, team): `cum_metric` cumsum, `games_played` cumcount+1, `metric_avg = cum/games`.
Rank per (season, week), `method='min'`:
- offensive positive → ascending=False (1 = best/highest)
- offensive negative (turnovers, ints, fumbles, sacks, sack_yards, int_per_attempt) → ascending=True
- `_allowed` of positive → ascending=True (fewer allowed = better)
- `_allowed` of negative (forced turnovers/sacks) → ascending=False
Output: id cols + `{metric}_rank` only.

## 4. Grading models (`grading_model_utils.py`)
Common: RandomForest(n_estimators=100, random_state=42); importance = (clf + reg importances)/2;
features grouped by (team, season, week).mean() → MinMaxScaler over all rows → weighted sum → min-max → ×100, round(1).

| Model | Features | Excluded | Targets (clf, reg) | Directionality | Final scale |
|---|---|---|---|---|---|
| Offense | numeric non-`_allowed` | desc cols, total_tds, points_margin, fantasy_points(_ppr), win, points | win, points | `_apply_directionality` | `100*(x-min)/(max-min)` |
| Defense | `_allowed` except points_allowed | — | win, points_allowed (NaN targets dropped; <2 classes ⇒ zero importances ⇒ uniform 1/n) | **none** | `100*(1-(x-min)/(max-min))` |
| Overall | all numeric | desc cols, total_tds, fantasy_points(_ppr), points, points_allowed, epa_diff, win, points_margin | win, points_margin | `_apply_directionality` | `100*(x-min)/(max-min)` |

`_apply_directionality` (post-scaling flips so higher=better):
offensive_negative list = turnovers, int_per_attempt, interceptions, receiving_fumbles(_lost),
rushing_fumbles(_lost), sack_fumbles(_lost), sack_yards, sacks.
Non-allowed in list → 1−x; `_allowed` NOT in list → 1−x; `_allowed` in list (forced) → keep.

`compute_all_model_results`: outer-merge 3 grade frames on (Team, Season, Week) → rename to `*_raw`
→ per-column MinMaxScaler(fillna(0))×100 round(1) → merged importances (outer on Feature, fillna 0,
sorted by Overall Importance desc).

`compute_week_contributions` (teams_tab.py:106): per grade type, MinMax-fit on ALL rows of the
feature set, weight w = importance; signed = w·norm (offense/overall) or w·(1−norm) (defense);
Contribution = |signed|.

## 5. Betting/probability engines (matchup_previews / model_overview / week_preview)
Constants: `BIN_SIZE_DEFAULT=1.0`, `SIGNED_SPREAD=True`, `MIN_N_BUCKET=25`,
`BLEND_MARKET_W=0.6`, `BLEND_MODEL_W=0.4`, `MODEL_SCALE=0.085`, `EDGE_SCALE=0.12`,
weights `W_GRADE=0.40, W_PM_L3=0.25, W_EPA_L3=0.20, W_PM_SLOPE=0.10, W_TOM_L3=0.05`.
- Spread binning: `pd.cut`, right=False, include_lowest=True; signed (favorite-aware) or |spread|.
- Wilson 95%: z=1.96; center=(p+z²/2n)/(1+z²/n); half=z·√(p(1−p)/n + z²/4n²)/(1+z²/n).
- Market calibration: history excluding current week grouped by (bin, fav_side) → fav win rate.
- Grades model prob: `p_away = 1/(1+exp(-MODEL_SCALE·(grade_away − grade_home)))`.
- Blend: `p = 0.6·p_market + 0.4·p_model` (fall back to whichever exists).
- Confidence: `100 · |p−0.5|·2 · (0.7 + 0.3·min(1, n_bucket/MIN_N_BUCKET))`.
- Trend edge: L3 means of points_margin / epa_diff / turnover_margin; PM slope = linreg slope over
  last 5 weeks; `edge = Σ weightᵢ·(awayᵢ − homeᵢ)`; `p_away = 1/(1+exp(-0.12·edge))`.
- Moneyline: ML>0 ⇒ p=100/(ML+100); ML<0 ⇒ p=−ML/(−ML+100); fair = p/(p_a+p_h); overround = sum−1.
- Consensus = mean of available metric probabilities, renormalized.
- Weekly picks (spread page): Wilson-regularized p̂ per (bin, fav side) from history excluding the
  target week; picks sorted by p̂ then N; favorites assigned to match expected favorite share.

## 6. Player pages
- Hit rate: `count(value ≥ line)/count(non-null) ·100`. Parlay: `P=∏pᵢ`, odds `=1/P`.
- % of team: `player_week_value / team_week_total ·100`.
- Mismatch score: `def_allowed_rank − off_rank` (positive = offensive edge);
  matchup-bets KPI variant: `(max_rank − off_rank + 1) + def_allowed_rank`.
- Value-bets ranks: cumulative means up to week; off rank desc, allowed rank asc.
- Player-team-stats x-range: top-1 per team ×1.05 → "nice" ceil (1/2/5×10^k); percent detection
  (all ≤1 → 0..1 else 0..100).
- Rank bar squash (comparison/matchup): `0.5 + (ratio−0.5)·0.5`.
- Rank connector logo scale (value bets): `1.20 − (rank−1)/31·0.40`.
