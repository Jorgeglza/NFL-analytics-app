# Predictive-model research spike

Scoped after the user asked to look for a real predictive edge beyond the existing
Matchup Previews / Model Picker models (`app/src/pages/game-analysis/previews/engine.ts`).
See `docs/FUTURE_DEVELOPMENT.md`'s "Model Backtest" entry (superseded by the Model
Picker tab) for prior related scoping.

**A model has been chosen — see `docs/predictive-model-decision.md`** (margin regression,
LogReg-style, with AdaBoost as documented runner-up) for the short decision record. This
file is the full research log behind that decision (8 rounds, every data source and
technique tried, every statistical test run) — read it for the "why," not the "what."

## Why this exists

None of the app's existing 6 models (`blend`, `trend`, `ml`, `elo`, `pyth`, `consensus`)
is a classifier trained against historical game outcomes:
- `ml` is literally the sportsbook's own vig-free moneyline probability.
- `blend` is 60% that same historical market rate blended with a logistic on the
  RandomForest grading model's Overall Grade — but that RandomForest
  (`pipeline/nfl_pipeline/grading.py`) predicts a team-quality score, never fit
  against win/loss outcomes directly.
- `trend`/`elo`/`pyth` are hand-tuned formulas, not fit/validated against outcomes.
- Per `docs/IMPLEMENTATION_LOG.md`, weekly accuracy sits around 50-63%, roughly in
  line with picking against an already-efficient market. There was also no
  against-the-spread (ATS) accuracy metric anywhere in the app — only straight-up
  winner accuracy and Brier score — so "edge" had never actually been measured
  against the thing that matters (beating the closing line).

This spike asks: does a properly trained ML model, using leakage-safe features and
walk-forward validation, beat the market on either straight-up accuracy or (more
importantly) ATS accuracy?

## Isolation (per explicit user request to keep new data separate)

Mirrors the existing Fantasy Pipeline pattern (`docs/fantasy-pipeline.md`):
- `pipeline/predictive_model/` — its own package; only reads (never writes) the
  existing `data/nfl.sqlite` (`schedule`, `team_week`, `grades` tables) and only
  reuses `nfl_pipeline.config`'s `SEASONS`/`current_season` (read-only).
- `data/raw_cache_predictive/` — separate cache for the new nflreadpy pulls
  (play-by-play, injuries), never touching `data/raw_cache/`.
- `data/predictive_model/` — trained-run artifacts (`metrics.json`, `report.txt`),
  never `data/nfl.sqlite` or `app/public/data/*.json`.
- No GitHub Actions wiring; run manually: `python pipeline/predictive_model/run_spike.py`.
- Zero changes to `pipeline/nfl_pipeline/*`, `engine.ts`, or `ModelPickerTab.tsx`.

## Data used (free nflverse only, per user decision — no paid odds APIs)

1. **Already-fetched-but-unused schedule columns** (zero new ingestion):
   `roof/surface/temp/wind`, `away_rest/home_rest`, `div_game`, `away_qb_id/home_qb_id`
   (used for starter-continuity detection), spread/moneyline (used only to define
   evaluation targets/baselines, never as model features).
2. **Play-by-play** (`nflreadpy.load_pbp`) — aggregated to team-week
   success-rate/explosive-play-rate, richer than the existing box-score `epa_diff`.
3. **Injuries** (`nflreadpy.load_injuries`) — count of "Out"/"Doubtful" reports per
   team-week, plus a QB-specifically-listed-out flag.
4. **Snap counts** (`nflreadpy.load_snap_counts`) — fetched (`fetch.py`) but **not
   wired into features in this pass**: joining injury reports to snap-share (to
   weight an injury by how much the player actually plays) needs matching by
   player name across two frames with no shared id, which is fragile; scoped out
   for now. A future pass could join through `nflreadpy.load_depth_charts`'
   `gsis_id` instead.

## Leakage discipline

Every feature is either:
- A rolling/expanding statistic **shifted by one game** (`features.py`'s
  `_rolling_trend`, `_cumulative_grades`, `_pbp_rolling`) — the current game's own
  row never contributes to its own feature value.
- Or genuinely known before kickoff: the announced starting QB id (`_qb_continuity`
  compares it to the team's *previous* game's QB, not this game's outcome),
  injury reports filed before the game, weather/rest/divisional-game facts from
  the schedule itself.
- `spread_line`/moneylines are **excluded from the feature set** — they're used
  only to define the `home_covers` target and the market baseline, never as
  model inputs, so ATS accuracy measures something real instead of the model
  re-deriving the market's own line.

Training is walk-forward only (`train.py`): each test season is scored by a model
fit exclusively on strictly-earlier seasons — never the in-sample fit the old
grading RandomForest uses (it fits and reports on the same data it trains on).

## Models

- `HistGradientBoostingClassifier` (primary) — handles missing values natively
  (early-season rows with no rolling history yet), no new dependency (already in
  `requirements.lock.txt` via scikit-learn).
- `LogisticRegression` (baseline) — mean-imputed + standardized.
- Both wrapped in `CalibratedClassifierCV` (sigmoid) so probabilities are usable
  for Brier/log-loss, not just thresholded picks.

## Baselines compared against

- `market_moneyline` — the closing line's own vig-free implied probability
  (equivalent to the existing app's `ml` sub-model).
- `elo` — a Python port of `app/src/lib/logic/elo.ts` (`predictive_model/elo.py`),
  the same Elo the app's Model Picker uses.
- `always_home` / `always_favorite` — trivial ATS baselines (the market sets the
  spread so both are ~50% by construction; they show what "no edge" looks like).
- `trend`/`pyth`/`blend`/`consensus` were **not** re-implemented in Python for this
  pass — the open question was whether an ML model beats the market/Elo, not
  whether it beats every existing heuristic variant (those already track close to
  market per the Model Picker tab).

## Result (2026-07-24 run, train up to each season, test 2024 and 2025)

```
--- target: home_win (straight-up) ---
season 2024: market 71.3% > logreg 68.8% > hgb 67.4% > elo 67.0%
season 2025: market 65.4% > logreg 64.0% > elo 63.2% > hgb 61.4%

--- target: home_covers (ATS) ---
season 2024: always_favorite 53.1% > hgb 51.3% > always_home 50.9% > logreg 48.4%
season 2025: hgb 51.3% > logreg 50.2% > always_home 49.8% > always_favorite 48.3%
```

**No edge found.** On straight-up accuracy the trained models underperform the
market's own vig-free moneyline in both held-out seasons. On ATS — the metric
that actually measures "beating the closing line" — every model (trained or
trivial) sits within noise of 50%, well below the ~52.4% breakeven at standard
-110 vig. This is consistent with the market being efficient at this level of
feature richness, and with the user's original observation that the existing
models "aren't causing an edge."

## Follow-up: does NGS + FTN charting ("ball movement" data) help? (2026-07-24)

Tested option 2 from the decision gate below: added tracking-derived Next Gen Stats
(`nflreadpy.load_nextgen_stats` — time-to-throw, completion% above expectation,
aggressiveness, rush yards over expected, stacked-box rate, receiver separation/cushion,
YAC above expectation; 2016-2025 coverage) and FTN charting (`load_ftn_charting` — motion,
play-action, RPO, box count, blitz rate, drop rate, contested-catch rate; **2022-2025 only**,
joined onto play-by-play via `game_id`/`play_id` since FTN carries no team column itself).
All 15 new columns are L3-rolled the same shifted, no-leakage way as the existing features
(`features.py`'s `_ngs_rolling`/`_ftn_rolling`, `NEW_FEATURE_COLS`).

**Method**: `compare_feature_sets.py` — identical walk-forward splits, identical model
(calibrated HistGradientBoosting), the *only* difference between runs is
`BASELINE_DIFF_FEATURE_COLS` vs `EXTENDED_DIFF_FEATURE_COLS` (baseline + the 15 new
columns). Per-game predictions are row-aligned between the two runs so a McNemar's test
can check whether any accuracy delta is real or noise — the same trap the earlier
team/week slice analysis fell into.

**Result: adding NGS + FTN did not help, and mildly hurt on ATS.**

```
home_win (straight-up):
  season 2024: baseline 67.4% vs extended 66.3% (McNemar p=0.68, not significant)
  season 2025: baseline 61.4% vs extended 61.4% (identical; McNemar p=0.84)

home_covers (ATS):
  season 2024: baseline 51.3% vs extended 48.4% (McNemar p=0.08, not significant but
               trending toward extended being *worse*)
  season 2025: baseline 51.3% vs extended 48.0% (McNemar p=0.31, not significant)
```

No McNemar comparison reached significance (all p > 0.05), so none of these deltas should
be read as a real effect either way — but there is no evidence of improvement, and the ATS
numbers lean negative in both seasons. Permutation importance (on the extended model)
confirms `diff_elo` dominates every other feature by an order of magnitude; a few NGS
columns (YAC above expectation, completion% above expectation, aggressiveness) show up in
the top 10 for the `home_win` target with non-trivial importance, suggesting *some* signal
exists in the tracking-derived stats — just not enough to move accuracy, and for the
`home_covers` target every new column's importance was negligible (<0.0004).

**Likely explanation**: FTN charting only covers 2022-2025, so most of the training
history (2015-2021, and 2015-2023 for the 2024 test fold) has those columns entirely
missing — HistGradientBoosting handles NaN natively but that's still a lot of the training
set contributing zero signal from those 7 columns, plus 15 extra columns is a meaningful
increase in dimensionality for ~2,700 training games, which plausibly adds variance without
adding enough signal to compensate.

### Isolating NGS alone from FTN alone (2026-07-24, same day follow-up)

`compare_feature_sets.py` was extended to run 4 feature sets in one pass — `baseline`,
`ngs_only` (baseline + the 8 NGS columns), `ftn_only` (baseline + the 7 FTN columns), and
`combined` — each with its own McNemar test vs. baseline.

```
home_win (straight-up):
  season 2024: baseline 67.4% | ngs_only 67.7% (+0.4pt) | ftn_only 66.3% (-1.1pt) | combined 66.3%
  season 2025: baseline 61.4% | ngs_only 62.5% (+1.1pt) | ftn_only 62.9% (+1.5pt) | combined 61.4%

home_covers (ATS):
  season 2024: baseline 51.3% | ngs_only 49.5% | ftn_only 49.5% | combined 48.4%
  season 2025: baseline 51.3% | ngs_only 49.5% | ftn_only 50.9% (~flat) | combined 48.0%
```

No McNemar comparison reached significance in either isolated run either (all p > 0.3) —
so nothing here should be read as a confirmed effect. But two patterns are worth noting:

1. **On straight-up accuracy**, NGS-only and FTN-only individually land at or slightly
   above baseline in 3 of 4 season/set combinations (best: FTN-only 2025 at +1.5pt) — a
   mild but not statistically significant improvement. The `combined` set, which tested
   worse than baseline in the original run, washes this out entirely (66.3%/61.4%,
   matching or trailing baseline) — supporting the "too many columns for the training set
   size" hypothesis over "the data itself is useless."
2. **On ATS, isolating doesn't rescue anything.** Every configuration — baseline, NGS-only,
   FTN-only, combined — sits at or below baseline, and permutation importance for the
   `home_covers` target stays negligible (<0.0007) across all three feature sets. Whatever
   thin signal NGS/FTN carry for straight-up picks does not survive contact with the
   market's own pricing once you're asking "does this beat the spread," which is the
   question that actually defines an edge.

**Conclusion: this line of investigation is exhausted.** Neither source, alone or
combined, produces a real ATS edge. The straight-up "maybe a sliver of signal, if you don't
drown it in extra columns" pattern is the most interesting finding of the whole spike so
far, but it doesn't translate into anything a bettor could act on.

## Round 3: snap-weighted injuries, EPA split, field position, PCA, multiple models (2026-07-24)

Retested the original baseline (confirmed still reproducible: HGB, 67.4%/61.4% straight-up,
51.3%/51.3% ATS across the two test seasons) with a new engineered feature set on top of
baseline + NGS (`features.ROUND3_FEATURE_COLS`, 21 base columns → 33 diff/context columns):

- **Snap-count-weighted injury severity** (`_snap_weighted_injury_severity`): joins
  `load_injuries` to `load_snap_counts` via normalized player name (no shared id between the
  two sources; spot-checked 96.7% match rate on 2023) — an "Out" starter who plays 90% of
  snaps counts far more than an "Out" backup who plays 5%. Weight is each player's own
  **expanding-mean snap share from strictly prior weeks** (leakage-safe), not their
  current-week snaps (which would be ~0 precisely because they're injured).
- **Pass/rush EPA split** (`l3_pass_epa_diff`, `l3_rush_epa_diff`): decomposes the existing
  combined `epa_diff` using `team_week`'s own `passing_epa`/`rushing_epa` columns — no new
  fetch needed.
- **Starting field position** (`l3_start_field_pos`, `l3_start_ep`): average distance to the
  opponent's goal line and average nflverse expected-points value at the start of each of a
  team's drives, from pbp's `yardline_100`/`ep`/`fixed_drive` — the "field position start"
  feature specifically requested.
- **Situational context**: red-zone-trip touchdown rate, third-down conversion rate,
  pressure-rate-faced (sack or QB hit per dropback) — all from pbp, all L3-rolled the same
  shifted way as every other feature in this pipeline.
- FTN charting excluded from this round (already shown not to help, shorter history).

**PCA**: fit inside each walk-forward training fold only (never on test data), via
`SimpleImputer → StandardScaler → PCA(n_components=0.90)` — kept 23 of 33 columns to explain
90% of variance in both test-season training folds. Modest compression: these engineered
features aren't especially redundant, so PCA isn't doing much heavy lifting.

**Models tried**: HistGradientBoosting, LogisticRegression, RandomForest, SVM (RBF kernel),
and a small MLP (16-unit hidden layer) — each with and without PCA (`compare_models_pca.py`).

### Result: a real (but not statistically confirmed) improvement on straight-up picks; still no ATS edge

Per-season numbers showed some eye-catching results (e.g. logreg hit 70.6% in 2024, several
configs cleared the 52.4% ATS breakeven in individual seasons) — but **10 configurations were
tested per target per season**, so before trusting any of that, everything was pooled across
both test seasons and checked for cross-season consistency (the same multiple-comparisons
discipline the earlier team/week slice analysis required):

```
home_win (straight-up), pooled across both seasons (n=551):
  logreg (raw)         66.8%  <- best, and consistent both years (70.6% / 62.9%)
  mlp (raw)             66.8%  <- tied best, consistent both years (69.5% / 64.0%)
  original baseline HGB 64.5%  <- reference point
  market (for context)  68.5%

home_covers (ATS), pooled across both seasons (n=546):
  mlp + PCA             52.4%  <- best pooled, but right at breakeven
  original baseline HGB 51.3%  <- reference point (unpooled ATS was 51.3%/51.3%)
  breakeven             52.4%
```

**Cross-season consistency check is what kills the exciting-looking ATS numbers**: the
single best per-season ATS configs do not hold up. `hgb+PCA` swung from 46.9% (2024, one of
the *worst* configs that year) to 54.2% (2025, the *best* config that year) — a textbook
noise signature, not a stable skill. `random_forest+PCA` did the reverse (53.5% → 49.4%).
Only `mlp+PCA` is even directionally consistent (53.5% / 51.3%), and its pooled 52.4% is
exactly at breakeven — being the best of 10 tested configs, this is fully explainable by
chance alone (with n≈275/season, the expected best-of-10 draw from a true-50% process lands
almost exactly here).

**The straight-up-accuracy improvement is more credible** — `logreg`/`mlp` (no PCA) beat the
original baseline HGB in *both* individual seasons, not just pooled, which is a much stronger
signal than a single-season maximum. A direct McNemar test (`orig_baseline_hgb` vs.
`round3_logreg_raw`, pooled n=551) gives baseline-only-right=31, round3-only-right=44,
**p=0.166** — directionally favors the engineered feature set + simpler model, but **does
not reach statistical significance** at this sample size. Read as: plausible real
improvement, not proven.

**Bottom line**: the requested feature engineering (snap-weighted injuries, EPA split, field
position, situational context) plus simpler models (logistic regression, small MLP) measurably
narrows the gap to the market on straight-up picks (64.5% → 66.8% pooled, still short of
market's 68.5%) — a genuine, if unconfirmed, step forward. It does **not** produce a
confirmed ATS edge; the apparent single-season "wins" evaporate under a consistency check.
PCA did not meaningfully help either target once cross-season consistency is applied.

## Round 4: literature-review findings (2026-07-24)

Reviewed 3 external papers (`Predictive model papers.docx`) and tested the two most
directly-applicable, concrete ideas, plus checked whether a third (feature selection
instead of PCA) is worth adopting:

1. **Streitmatter (2023)** — 4-stat linear regression + Monte Carlo margin simulation,
   claimed 70.7% vs. Elo's 65.43% (single-article result, no rigorous validation shown —
   treated as a methodology idea, not a number to chase). Not implemented this round
   (would need restructuring `train.py` around a margin-regression target rather than two
   separate classifiers — flagged as a bigger future change, not attempted here).
2. **Bouzianis (2019, UNH thesis)** — 32 per-team logistic regressions; found **nonlinear
   transforms of cumulative starting field position (squared AND square-root) were
   independently significant** on top of the raw value, their single most consistent
   finding across all 32 models. Backward elimination (505→20 variables) was what
   controlled their overfitting, not any variance-based reduction like PCA.
3. **Ruscio & Brady (2021, TCNJ)** — in-game win probability; found a simple formula-based
   model statistically indistinguishable from a 500-tree Random Forest (MSE .15185 vs.
   .15188) once both are evaluated by **calibration** (binned predicted-vs-observed rate,
   correlation r > .99), not just accuracy — the same "simple ≈ complex" pattern this
   spike has found all session, now with independent academic confirmation.

### What was implemented

**Nonlinear transforms** (`features.py`'s `_add_nonlinear_transforms`): signed square
(`sign(x)·x²`) and signed square-root (`sign(x)·√|x|`) — signed so a strong negative value
isn't collapsed onto an equally strong positive one — applied to the 4 features closest to
Bouzianis' validated predictors: Elo, `l3_start_field_pos`, `l3_start_ep`,
`cum_overall_grade`. Applied at the **per-team level** before the home-minus-away diff is
taken, matching their methodology exactly. 8 new columns → `ROUND4_FEATURE_COLS`.

**Calibration/reliability table** (`evaluate.py`'s `calibration_table`/
`calibration_correlation`): bins predicted probabilities, compares mean-predicted vs.
observed win rate per bin, reports the Pearson r Ruscio & Brady used as their calibration
bar. No plotting library was added (matplotlib isn't in `requirements.lock.txt` and this is
a research script, not a UI) — the table + correlation number carries the same information
Ruscio & Brady report alongside their visual curve.

**Feature-selection check** (`compare_selection_methods.py`): compared `raw` (no
reduction) vs. `pca` (existing) vs. `l1` (L1-regularized LogisticRegression selects
nonzero-coefficient columns, refit fresh inside every walk-forward fold — no leakage) for
HistGradientBoosting on the Round 4 feature set.

### Results (`retest_round4.py`, `compare_selection_methods.py`)

**Nonlinear transforms**: a small, non-significant nudge for HGB, no help (slightly worse)
for LogisticRegression, no help for ATS either way:
```
home_win pooled: round3 hgb 64.2% -> round4 hgb 65.0%  (McNemar p=0.42, not significant)
                 round3 logreg 66.8% -> round4 logreg 65.9% (slightly worse)
home_covers pooled: round3 hgb 51.3% -> round4 hgb 50.7% (slightly worse)
                    round3 logreg 49.1% -> round4 logreg 48.2% (slightly worse)
```
**Calibration**: Round 4 HGB is very well calibrated for straight-up picks
(calibration r=0.9964, matching Ruscio & Brady's "r>.99 = well calibrated" bar) — the
reliability table tracks the diagonal closely (e.g. predicted 0.678 vs. observed 0.737 in
the 62-75% bin). LogisticRegression is calibrated but somewhat less tightly (r=0.9389).
**For ATS, the calibration correlation is a meaningless ±1.0000** in both directions —
not evidence of good or bad calibration, just an artifact of only 2 probability bins
having any data at all, because ATS predictions cluster almost entirely around 50% (the
same "no real signal" finding as every other round this session, now visible directly in
how few distinct probabilities the model ever produces for this target).

**Feature selection vs. PCA**: confirms PCA is actively costing accuracy relative to doing
nothing. Pooled straight-up accuracy: `l1` 65.9% ≈ `raw` 65.2% (McNemar p=1.00, no
difference — HGB already does its own implicit feature selection via tree splits, so
external selection doesn't add anything for this model type) vs. **`pca` 63.3%**
(`pca` vs. `l1`: McNemar p=0.208 — directionally a real cost, not formally significant at
n=551, but consistent with round 3's PCA finding). L1 kept 19-27 of 41 columns per fold
(varies by fold, e.g. dropped `diff_elo` itself in favor of `diff_sqrt_elo` in one fold —
plausible given they're highly collinear). For ATS, no reduction strategy differs
meaningfully (all ~48-50%, within noise of each other and of breakeven).

**Bottom line on "is PCA worthwhile" (item 2 from the review)**: **no.** PCA should be
dropped in favor of either raw features (fine for tree-based models, which already ignore
irrelevant columns) or L1 selection (a reasonable default if a linear-model-friendly
option is wanted) — Bouzianis' methodological point holds up: selection beats variance-based
mixing for this kind of tabular sports data, though neither beats "just don't reduce at all"
for a tree ensemble by a significant margin.

## Round 5: margin regression + simulation (Streitmatter-style) (2026-07-24)

Implemented the idea flagged but not attempted in Round 4: instead of training
`home_win` and `home_covers` as two disconnected classifiers, fit **one regression on
point margin** (`home_score - away_score`), estimate the residual (uncertainty)
distribution from out-of-fold predictions on the training fold only, and derive both
win probability and ATS-cover probability from that single fitted distribution —
`pipeline/predictive_model/margin_regression.py`.

Two ways of deriving probabilities from the fitted margin + residuals, both computed for
comparison:
- **`simulate`**: Monte Carlo — resample 10,000 residuals (with replacement) from the
  actual out-of-fold training residual distribution, add to the predicted margin, and
  take the proportion of simulated outcomes where `margin > 0` (win) or
  `margin + spread_line > 0` (cover). This is Streitmatter's literal method, and it
  captures skew/fat tails rather than assuming normality.
- **`normal_cdf`**: closed-form cross-check assuming residuals ~ Normal(0, σ) — the
  Ruscio & Brady / Pro-Football-Reference-style shortcut, exact instead of simulated.

Two regressors: `HistGradientBoostingRegressor` and `LinearRegression` (imputed/scaled),
using the same Round 4 feature set, walk-forward, spread/moneylines still excluded from
the regression's own inputs.

### Result: matches the best classifier on straight-up picks with ONE unified model — still no ATS edge, but a more informative "no"

**Residual diagnostics** (out-of-fold, train only) were the first pleasant surprise:
σ ≈ 13.2–13.3 points in every fold, with skew ≈ 0.04–0.07 and excess kurtosis ≈ 0.32–0.35
— close enough to normal that `simulate` and `normal_cdf` agree closely, and **this σ
independently lands almost exactly on Ruscio & Brady's own PFR "uncertainty" constant
(13.40–13.45)** — a nice unplanned cross-validation that this dataset's true game-to-game
unpredictability matches the published academic estimate.

```
home_win (straight-up), pooled across both seasons:
  hgb_reg  normal_cdf   65.9%  (calibration r=0.980)
  lin_reg  simulate     65.5%  (r=0.975)
  hgb_reg  simulate     65.2%  (r=0.983)
  lin_reg  normal_cdf   65.5%  (r=0.945)
  -- for reference: best classifier so far (round3 logreg) was 66.8%,
     original baseline HGB classifier was 64.2%, market was 68.5% --

home_covers (ATS), pooled across both seasons:
  hgb_reg  simulate     49.6%  (calibration r=-0.334)
  hgb_reg  normal_cdf   49.1%  (r=-0.301)
  lin_reg  simulate     48.7%  (r=-0.242)
  lin_reg  normal_cdf   48.7%  (r=-0.139)
```

**Straight-up**: the margin-regression approach reaches 65.9% pooled with a *single*
coherent model — essentially matching the best two-classifier result from Round 3 (66.8%)
without needing a separately-tuned classifier per target. That's the architectural payoff
Streitmatter's approach promised, and it delivered: one fitted distribution, two
well-calibrated probabilities, no worse than maintaining two independent models.

**ATS: still no edge, but a more informative negative result than before.** Unlike the
classifiers (which barely moved off ~50%, so their calibration correlation was a
meaningless ±1.0000 from only 2 populated bins), the margin-regression approach produces
real spread — the calibration table has populated bins from 10% to 90% confidence.
Inspecting it directly: predicted vs. observed is **not monotonic** — e.g. the 60-70%
confidence bin observed only 48.5% actual covers, and the 70-80% bin observed only 40.9%
(both n<70, so individually noisy) — while the overall predicted mean (50.3%) matches the
overall observed mean (50.4%) almost exactly. In other words: **the model is correct on
average but doesn't reliably rank which games it should be more or less confident about**
for ATS specifically. That's a more informative negative result than "the model barely
expresses any confidence" — here it genuinely tries to express confidence, and that
confidence still doesn't track outcomes, which is stronger evidence that the market has
already priced in whatever signal exists in these features.

### Files

- `pipeline/predictive_model/margin_regression.py` — the full implementation, saved to
  `data/predictive_model/margin_regression.csv` and `..._residuals.csv`.

## Round 6: second literature review — Beal/Harville/Song/Boulier/Szalkowski (2026-07-24)

Reviewed 5 more papers (full text obtained for 3; the other 2 — Song, Boulier & Stekler 2007
and Boulier & Stekler 2003 — are paywalled on ScienceDirect, summarized via a citing survey,
H.O. Stekler's 2007 GWU working paper "Sports Forecasting," which reports their exact figures).

- **Beal, Norman & Ramchurn (2020)** — the strongest modern academic benchmark: 9 classifiers,
  1,280 games (2015-2019), 42 features/team. **Naive Bayes won at 67.53%**, beating the
  bookmaker average by 1.7% in their sample but not consistently year-to-year (AdaBoost or
  Random Forest won individual seasons) — they explicitly recommend ensembling as the fix.
- **Harville (1980)** — the foundational paper nearly everyone else cites; predicts expected
  score margin via a linear model rather than classifying win/loss — the same architecture as
  our own Round 5 margin regression. Even in 1980, the market (72%) beat his model (70%).
- **Song, Boulier & Stekler (2007)** — 31 statistical systems + 70 experts vs. Vegas,
  2000-2001 seasons. Systems averaged 62% picking winners, statistically indistinguishable
  from the 70 experts; **Vegas got 66%**, best in every year. Against the spread, "most
  systems were not even as accurate as flipping a coin."
- **Boulier & Stekler (2003)** — NY Times power scores vs. Vegas, 1994-2000: power-score
  model 61% (barely above a naive "home team always wins" baseline), Vegas 66%.
- **Szalkowski & Nelson (2012)** — an efficiency audit of Vegas lines, not a new model,
  2,560 games (2002-2011). Home teams win 57% straight-up but cover only 48.9% (the spread
  already prices in home-field advantage). **Home underdogs covered 53.5%**, above the 52.38%
  breakeven — a small, "diminishing over time" documented bias. Line-difference (actual
  margin minus closing spread) ~ Normal(mean≈0, σ≈13.588) — the third independent source
  landing on ~13.3-13.6 as the true game-to-game uncertainty (alongside Ruscio & Brady's
  13.40-13.45 and our own Round 5 margin-regression residual σ≈13.3). Opening-vs-closing line
  movement carries no statistically significant extra predictive value for individual games;
  the "line movement predicts division winners at 75%" claim is explicitly a whole-season
  retrospective analysis, not a forward-looking per-game prediction.

Implemented items 1 (Naive Bayes + AdaBoost), 2 (weighted ensemble), and 5 (home-underdog
backtest) this round; item 4 (an "overreaction" feature, from Vergin 2001 as cited in the
Stekler survey — the market overreacts to a team's most recent large-margin result) is
queued for a future round, not built yet.

### Item 1: Naive Bayes + AdaBoost (`compare_new_models.py`)

Added `GaussianNB` and `AdaBoostClassifier` to the Round 4 feature set, same walk-forward
gate, alongside the existing `hgb`/`logreg` reference points.

```
home_win pooled: adaboost 66.42% | logreg 65.70% | naive_bayes 65.52% | hgb 64.97%
home_covers pooled: hgb 50.73% | naive_bayes 49.63% | logreg 48.17% | adaboost 46.70%
```

**AdaBoost is now the best straight-up performer found this session on the Round 4 feature
set**, edging past logreg (matching, not exceeding, Round 3's separate logreg-on-round3-features
result of 66.8%). McNemar vs. the original baseline HGB (64.2%): p=0.178 — directionally
the most encouraging non-significant result yet, in the same ballpark as Round 3's logreg
(p=0.166). **Naive Bayes did not repeat Beal's result** — it wasn't the best model here,
likely because our feature set is far more collinear (EPA/success-rate/grade all correlate)
than Beal's simpler 42-feature set, and Naive Bayes's independence assumption degrades faster
under collinearity. AdaBoost is the worst performer for ATS (46.7%) — no help there.

### Item 2: weighted ensemble (`ensemble_models.py`)

Combined all 4 models (hgb, logreg, naive_bayes, adaboost) two ways: equal-weight average,
and Brier-inverse-weighted average (weights computed from each model's out-of-fold Brier
score on the training fold only — never touches test data).

**Result: the ensemble did not beat the single best model in either target.**
`ensemble_brier_weighted` tied AdaBoost exactly on home_win (66.42% pooled) — the weighting
scheme correctly up-weighted the better-calibrated models (logreg/adaboost got ~27% each,
naive_bayes ~20%, reflecting its worse Brier score), but tying the best individual model is
not beating it. `ensemble_equal` (65.34%) was clearly worse than the Brier-weighted version,
confirming the weighting scheme itself helps — just not enough to add value beyond what
AdaBoost already provides alone. For ATS, ensembling actively hurt (both ensemble variants
scored below HGB alone). **Interpretation**: these 4 models are trained on the identical
feature set, so their errors are correlated rather than complementary — ensembling only
pays off when member models make different kinds of mistakes, and ours mostly don't.

### Item 5: home-underdog backtest (`home_underdog_backtest.py`)

Pure historical strategy backtest (no ML, no walk-forward split needed) across the full
2015-2025 dataset.

**Numbers corrected 2026-07-24 (Round 7)** — see the data-quality note below Round 6:
the original run of this backtest included ~73 duplicate-row-inflated games out of ~2,968;
after the fix the true sample is 2,822 graded games (1,085 home-underdog games).

```
Home underdogs:  n=1085, cover rate=50.23% (Wilson 95% CI [47.26%, 53.20%])
                 z vs. 50%: +0.15 (not significant)  z vs. 52.38% breakeven: -1.42 (not significant)
Home favorites:  n=1737, cover rate=47.90% (Wilson 95% CI [45.56%, 50.25%])
                 z vs. 50%: -1.75 (not significant)  z vs. 52.38% breakeven: -3.74 (highly significant)
Year-by-year home-underdog trend: slope +0.00147/season (flat/slightly rising, not declining)
```

**The classic "home underdog" bias has disappeared in our data.** Szalkowski's 53.5%
(2002-2011) has drifted down to 50.23% (2015-2025) — statistically indistinguishable from a
coin flip, consistent with their own observation that the effect was "diminishing over
time"; it appears to have fully diminished by now. **The "home favorites under-cover"
pattern flagged in the original run of this backtest does NOT survive the data-quality fix**:
on the corrected 1,737-game sample it's z=-1.75 vs. 50% — no longer clears the |z|>1.96
significance bar (the original, bug-inflated run reported z=-2.04, just over the line). This
is exactly the kind of correction this session's own discipline (McNemar tests, cross-season
consistency checks) exists to catch — read as: **no exploitable home-favorite/road-team bias
survives scrutiny either**, just like every other angle tried this session.

### Files

- `pipeline/predictive_model/compare_new_models.py` — Naive Bayes + AdaBoost comparison,
  saved to `data/predictive_model/new_models.csv`.
- `pipeline/predictive_model/ensemble_models.py` — weighted ensemble (equal + Brier-weighted),
  saved to `data/predictive_model/ensemble_models.csv`.
- `pipeline/predictive_model/home_underdog_backtest.py` — full-history market-bias backtest,
  saved to `data/predictive_model/home_underdog_backtest.csv`.

## Round 7: overreaction feature + a data-quality bug fix (2026-07-24)

### Data-quality note (affects Rounds 1-6's point estimates — read this first)

While building this round's feature, `build_game_table`'s row count jumped unexpectedly
from 2,968 to 3,114. Investigation traced this to a real, pre-existing bug: `team_week`
carries a small number of duplicate `(team, season, week)` "phantom" rows — a documented
upstream nflverse quirk, correctly preserved verbatim in the parity-critical main pipeline
(`docs/known-issues.md`). `build_team_features` merges *multiple* frames derived from
`team_week` (`_rolling_trend`, and now `_surprise_rolling`) — merging two frames that both
carry the same duplicate keys produces a **Cartesian product** for those keys, not just an
addition, so every merge added to `build_team_features` since Round 1 has been silently
inflating the dataset by a small, compounding amount. Fixed by deduplicating in
`load_team_week()` (`predictive_model` is a read-only consumer with no parity requirement,
so this is safe and correct here — the parity-critical `nfl_pipeline` is untouched).

**Verified against ground truth**: the schedule table itself has exactly 2,895 completed
REG games for 2015-2025 — matching the fixed pipeline's output exactly.

**Impact assessment**: re-ran the original baseline reproduction after the fix — HGB moved
from 64.2%→~64.6% pooled straight-up, ATS moved from 51.3%→~49.9% pooled. These are the
largest shifts found from spot-checking; most Round 1-6 point estimates likely moved by
less than this. **No qualitative conclusion from this session changes** — the market still
leads on straight-up accuracy, no configuration shows a real ATS edge — but one specific
claim does not survive: Round 6's "home favorites under-cover significantly" (z=-2.04) drops
to non-significant (z=-1.75) on the corrected data (see Round 6's writeup above, corrected
in place). Treat all other Round 1-6 percentages as accurate to roughly ±0.5-1.5 points,
not exact.

### The overreaction feature (`_surprise_rolling` in `features.py`)

Implemented Vergin (2001)'s idea: `surprise_points_margin` / `surprise_epa_diff` measure how
much of an outlier a team's most recent game was relative to its own established baseline
*before* that game (`shift(1)` for last week's raw result, `shift(2).expanding().mean()` for
the baseline computed strictly before that — the surprising game itself is excluded from its
own baseline, not just from the current prediction week). `ROUND5_FEATURE_COLS` adds these
2 columns to Round 4's 36.

**Step 1 — test the hypothesis directly** (`test_overreaction_hypothesis.py`, full
2015-2025 history, n≈2,300-2,900): bucketed games by quintile of surprise magnitude and
checked whether the market's own pregame probability is biased in the direction the
overreaction theory predicts (overrating a team after a big win, underrating after a big
loss). **Result: no supporting evidence.** Pearson correlation between surprise and market
bias: **r=-0.02** for both point-margin and EPA framings — essentially zero, and the
bucket-by-bucket bias values don't move monotonically with surprise magnitude the way the
hypothesis requires.

**Step 2 — retest the walk-forward models anyway** (`retest_round5_surprise.py`, AdaBoost +
HGB, Round 4 vs. Round 5 feature sets, corrected data): confirms the null result from step 1.

```
home_win pooled:    adaboost round4 66.73% -> round5 66.54% (slightly worse)
                    hgb      round4 65.62% -> round5 65.44% (slightly worse)
home_covers pooled: adaboost round4 47.12% -> round5 47.31% (~flat)
                    hgb      round4 48.61% -> round5 47.68% (worse)
```

All 8 McNemar comparisons (2 models x 2 targets x 2 test seasons) came back not significant
(p ranging 0.29-1.00). **The overreaction feature adds nothing** — consistent with the direct
hypothesis test finding no bias to exploit in the first place. Read together, steps 1 and 2
tell a coherent story: this isn't "the feature didn't help by chance," it's "the underlying
market bias this feature was designed to exploit doesn't show up in our data" — the same
"diminished over time" pattern already seen with the home-underdog bias in Round 6.

### Files

- `pipeline/predictive_model/test_overreaction_hypothesis.py` — direct hypothesis test,
  saved to `data/predictive_model/overreaction_hypothesis.csv`.
- `pipeline/predictive_model/retest_round5_surprise.py` — walk-forward retest with McNemar,
  saved to `data/predictive_model/round5_surprise.csv`.

## Final results — all rounds re-confirmed on corrected data (2026-07-24)

Every script from Rounds 1-6 was re-run after the Round 7 dedup fix (see above) to produce
one authoritative, apples-to-apples table. Straight-up (`home_win`) pooled accuracy across
both held-out test seasons (2024+2025, n=544 unless noted).

**Complexity score (1-5, model architecture only — independent of feature count)**:
- **1 — trivial**: no fitting beyond a handful of global constants (Elo's rating formula).
- **2 — simple parametric**: a single closed-form/convex fit, fully interpretable
  coefficients (Logistic Regression, Naive Bayes).
- **3 — shallow ensemble**: many small/shallow learners combined by a simple rule
  (AdaBoost's ~100 depth-1 stumps, Random Forest).
- **4 — deep ensemble / kernel method**: many interacting hyperparameters, harder to
  interpret (HistGradientBoosting's boosted trees, SVM-RBF's kernel trick).
- **5 — black-box or multi-stage**: MLP (opaque weight matrix); anything wrapped in PCA
  (adds a non-interpretable transform layer on top of the base model); margin regression +
  simulation (fit + residual-distribution estimation + Monte Carlo/CDF derivation — 3
  stages, not 1); the weighted ensemble (trains and maintains 4 separate models plus a
  meta-weighting layer on top).

| Round | Configuration | # features | Complexity | Pooled straight-up acc |
|---|---|---|---|---|
| — | **Market moneyline (reference, not a model)** | 0 | n/a | **68.57%** |
| — | Elo (reference, not trained) | 0 | 1 | 65.26% |
| 1 | Baseline: HGB | 17 | 4 | 64.53% |
| 1 | Baseline: LogReg | 17 | 2 | 65.44% |
| 2 | NGS-only (HGB) | 25 | 4 | 64.34% |
| 2 | FTN-only (HGB) | 24 | 4 | 63.97% |
| 2 | Combined NGS+FTN (HGB) | 32 | 4 | 63.42% |
| 3 | Engineered features (round3): LogReg raw | 33 | 2 | 66.55% |
| 3 | Engineered features (round3): Random Forest raw | 33 | 3 | 66.18% |
| 3 | Engineered features (round3): Random Forest+PCA | 33→23 comp. | 5 | 66.00% |
| 3 | Engineered features (round3): HGB+PCA | 33→23 comp. | 5 | 65.63% |
| 3 | Engineered features (round3): SVM (raw/PCA) | 33 | 4 | 63.4-64.0% |
| 3 | Engineered features (round3): MLP (raw/PCA) | 33 | 5 | 62.0-62.7% |
| 4 | Nonlinear transforms (round4): LogReg | 41 | 2 | 65.99% |
| 4 | Nonlinear transforms (round4): HGB | 41 | 4 | 65.62% |
| 4 | Round4 features, L1-selected HGB | 41→~20-25 selected | 4 | 66.54% |
| 4 | Round4 features, HGB+PCA | 41→23 comp. | 5 | 63.42% (PCA costs ~2-3pts vs. raw/L1, confirmed again) |
| 5 | Margin regression: LogReg-equivalent (`lin_reg`), simulated | 41 | 5 | 66.18% |
| 5 | Margin regression: HGB-equivalent (`hgb_reg`), simulated | 41 | 5 | 65.81% |
| 6 | **AdaBoost (round4 features)** | 41 | **3** | **66.73% — best found this session** |
| 6 | Naive Bayes (round4 features) | 41 | 2 | 66.18% |
| 6 | Weighted ensemble (Brier-weighted: hgb+logreg+nb+adaboost) | 41 (×4 models) | 5 | 66.73% (ties AdaBoost, doesn't beat it) |
| 7 | AdaBoost + surprise feature (round5 features) | 43 | 3 | 66.54% (no improvement over round4) |

**Complexity vs. accuracy is a genuinely useful lens here.** The best result (AdaBoost,
66.73%) is only *medium* complexity (3) — not the most complex thing tried. The two
closest runners-up, LogReg-on-round3-features (66.55%) and Naive Bayes (66.18%), are the
*simplest* models in the whole table (complexity 2) and land within half a point of
AdaBoost. Meanwhile the most complex configurations (PCA-wrapped models, margin regression,
the 4-model ensemble — all complexity 5) never come out on top; PCA actively *costs*
accuracy every time it's tried. If this were ever adopted, LogReg or AdaBoost on ~33-41
features would be the pick — not because they're the most sophisticated, but because
they're near the top of this table at a fraction of the complexity of the things that
aren't.

**The best configuration found in this entire session is AdaBoost on the Round 4 feature
set: 66.73% pooled straight-up accuracy**, tied by the Brier-weighted ensemble (which is
mostly just AdaBoost with extra steps). A final, decisive McNemar test — this best config
vs. the original Round 1 baseline, both re-run on the corrected data — gives:

```
baseline (HGB, original features):     64.52% pooled (n=544)
best found (AdaBoost, round4 features): 66.73% pooled (n=544)
McNemar: baseline-only-right=21, best-only-right=33, p=0.1344
```

**+2.2 percentage points, still not statistically significant** at this sample size
(n=544, 2 held-out seasons) — the single most encouraging result of the whole investigation,
but not proof. Every other configuration lands within a tight 62-67% band; nothing else
tested (NGS/FTN tracking data, PCA, margin regression, ensembling, the overreaction feature)
beats AdaBoost-on-round4, and nothing anywhere in this table gets within 1.8 points of the
market's 68.57%.

### Is anything here worth adding to the app?

**Not yet, on the evidence gathered so far.** Two honest readings support this:

1. **The gap to market never closed.** Every configuration trails the market's own
   moneyline by at least ~1.8 points, and most trail it by 2-4 points — consistent with the
   academic literature reviewed this session (Song/Boulier/Stekler, Boulier & Stekler), which
   found the same thing decades ago: no statistical model has been shown to consistently
   beat Vegas at picking straight-up winners.
2. **The one genuinely promising result (AdaBoost +2.2pt) isn't confirmed.** p=0.13 means
   there's roughly an 87% chance this specific 2.2-point gap isn't due to chance — encouraging,
   but "roughly 87% confident" is not the bar for changing a production system, especially
   given this session's own repeated lesson (the team/week slices, the home-favorite finding
   that didn't survive the dedup fix) that promising-looking deltas at this sample size often
   don't hold up.

**If you want to pursue this further before writing it off**, the two highest-value next
steps are: (a) re-run this same AdaBoost/round4 comparison on more held-out seasons (the
walk-forward gate already supports this — just extend `TEST_SEASONS`) to see if the gap
holds or shrinks with more data, since 2 seasons is a thin sample for a 2-point effect; or
(b) accept the free-data ceiling (decision-gate item 5/8) and treat this as a settled null
result — the market is efficient enough that beating it needs either much more data, a
genuinely new data source (line-movement history, player props), or both.

## Round 8: robustness check across 7 seasons (2026-07-24)

The "Final results" table above was built on just 2 held-out test seasons (2024+2025,
n=544) — exactly the thin sample this doc's own recommendation flagged as a risk. This
round picks 6 distinct configurations from that table and re-runs them walk-forward across
**7 seasons (2019-2025, n=1,871)** instead of 2, using `robustness_top6.py`, to see whether
the accuracy gains hold up or were partly an artifact of which 2 seasons got picked.

**The 6 configs** (chosen to be architecturally distinct, not near-duplicates — the
weighted ensemble and Random-Forest+PCA were dropped as redundant with AdaBoost and
Random-Forest-raw respectively): AdaBoost (round4 features), LogReg (round3 features),
L1-selected HGB (round4), Random Forest (round3), Naive Bayes (round4), and margin
regression LogReg-style (round4, simulated).

| Configuration | # features | Complexity | Pooled acc (7 seasons) | Mean | Std dev | Min | Max |
|---|---|---|---|---|---|---|---|
| **Market moneyline** (reference) | 0 | n/a | **66.38%** | 66.38% | 0.0301 | 62.13% | 71.69% |
| AdaBoost (round4) | 41 | 3 | **64.40%** | 64.34% | 0.0323 | 58.98% | 69.12% |
| Margin regression, LogReg-style (round4) | 41 | 5 | **64.40%** | 64.39% | **0.0280 (most stable)** | 62.13% | 70.22% |
| LogReg (round3) | 33 | 2 | 63.98% | 63.95% | 0.0362 | 58.59% | 70.22% |
| L1-selected HGB (round4) | 41→~20-25 | 4 | 63.92% | 63.87% | 0.0349 | 58.20% | 69.12% |
| Random Forest (round3) | 33 | 3 | 63.66% | 63.65% | 0.0319 | 59.56% | 68.75% |
| Naive Bayes (round4) | 41 | 2 | 63.17% | 63.18% | 0.0309 | 59.56% | 69.12% |
| Original baseline (HGB, round1 features) | 17 | 4 | 62.69% | 62.68% | **0.0386 (least stable)** | 57.03% | 67.66% |

**The absolute numbers come back down to earth** — AdaBoost's 66.73% from the 2-season table
drops to 64.40% pooled over 7 seasons. 2024 turns out to have been an unusually easy season
for every single configuration (68-70% across the board, the best season for all 6) — the
2-season table was flattered by which seasons happened to be in it, exactly the risk flagged
after that table was built.

**But the relative improvement over the original baseline holds up, and gets *more* credible
with more data, not less.** A final McNemar test, baseline vs. the best 2 configs, on the
full 7-season n=1,871 sample:

```
baseline (HGB, round1 features):            62.69% pooled
AdaBoost (round4 features):                  64.40% pooled -- McNemar p=0.0436 (significant at 0.05!)
Margin regression (round4 features):         64.40% pooled -- McNemar p=0.0611 (borderline)
```

**This is the first result in the entire session that clears the conventional p<0.05 bar.**
With only 544 games (2 seasons), the same ~2pt gap sat at p=0.13-0.18 — suggestive but not
confirmed. With 1,871 games (7 seasons), the sampling noise shrinks enough that the same
kind of gap becomes statistically significant for AdaBoost specifically. All 6 configurations
beat the original baseline on this larger sample (by +0.48pt to +1.71pt), and 5 of 6 are
also *more stable* (lower season-to-season std) than the baseline's 0.0386 — the original
baseline is both the least accurate **and** the least consistent of everything tested.

**Margin regression is the standout on robustness specifically**: tied for best pooled
accuracy (64.40%) with the *lowest* variance across seasons (0.0280, even more stable than
the market's own 0.0301) — despite being the most "complex" (score 5) architecture in the
table. Complexity and consistency aren't the same axis: the extra machinery (residual
distribution + simulation) seems to be buying stability, not just accuracy.

**Still no beating the market.** Even the best 2 configs trail the market's 66.38% by ~2
points on this same window — the gap narrowed (from -3.69pt at baseline to -1.98pt at best)
but never closed. Read together with everything else this session: there is a real, now
statistically confirmed, modest improvement available over a naive baseline model — but it
closes less than half the gap to market efficiency, which remains the dominant finding.

### Files

- `pipeline/predictive_model/robustness_top6.py` — the 7-season robustness check, saved to
  `data/predictive_model/robustness_top6.csv` and `robustness_top6_summary.csv`.

## P2: the exploration page itself (2026-07-25)

Built `/data/predictive_model` per `docs/predictive-model-decision.md`'s model choice, kept
historical-only (no live/upcoming-week predictions — the pipeline has no `predict_upcoming()`
capability, and productionizing one was explicitly out of scope for this pass).

- `pipeline/predictive_model/export_page.py` — new export step, reusing
  `margin_regression.py`'s `lin_reg` walk-forward loop but widened to **every season with
  ≥3 prior training seasons through the latest completed season** (`EXPORT_TEST_SEASONS =
  range(FIRST_SEASON+3, current_season()+1)`, 2018-2025 as of this writing, n=2,127 — wider
  than any window used during research, per the "backtest from all available data" decision).
  Writes per-game predictions, permutation importance, calibration table + residual pool, and
  a season-by-season summary directly to `app/public/data/predictive_model/*.json` — the one
  deliberate exception to this package's outputs staying in `data/predictive_model/`, since
  this data is meant for the frontend, same as every other page's JSON extract. Run manually:
  `python pipeline/predictive_model/export_page.py`; re-run once a season completes (not on
  the weekly cron — this package has no GitHub Actions wiring, unchanged).
- 8-season pooled numbers from this run (wider window than Round 8's 7 seasons, so not
  directly comparable): model 64.3% straight-up (n=2,127) vs. market 66.4% vs. Elo 63.6%;
  ATS 50.0% (n=2,075, breakeven 52.4%) — consistent with every prior round's conclusion, no
  edge. Calibration r=0.9815 for straight-up picks; residual σ≈13.3 pts, matching Round 5's
  finding almost exactly.
- `app/src/pages/predictive-model/` — 4 tabs (Overview, Performance, Explanation,
  Confidence), following the `/data/grading_model` page's file layout. Overview states the
  "no confirmed edge" conclusion plainly rather than implying otherwise. Performance is a
  predicted-vs-actual margin scatter filterable by season/team. Explanation is a permutation-
  importance bar chart (confirms Elo/EPA differentials dominate by an order of magnitude,
  matching every round's finding). Confidence shows the reliability diagram + residual
  histogram and explains why good straight-up calibration doesn't imply an ATS edge.
- Verified in the browser preview: all 4 tabs load real data, season/team filters on
  Performance work, no console errors; `npm run build`, `tsc --noEmit`, and the existing
  58-test Vitest suite all green (no existing logic touched).

## Decision gate (per the approved plan)

Per plan: only proceed to a UI page ("Predictive Model" page, kept fully separate
from Model Picker until proven) if a walk-forward ATS edge shows up. **No run so far
shows one.** Options going forward:
1. ~~Try a richer PBP/tracking feature set (NGS + FTN charting)~~ — **tested
   2026-07-24, did not help.**
2. ~~Isolate NGS alone from FTN alone~~ — **tested 2026-07-24, exhausted**: neither
   helps ATS alone or combined; a small straight-up-accuracy uptick appears in isolation
   but isn't statistically significant and doesn't survive combining the two sources.
3. ~~Snap-weighted injury severity, EPA split, field position, situational features, PCA,
   multiple model types~~ — **tested 2026-07-24**: measurable (but not statistically
   confirmed) straight-up improvement (64.5%→66.8% pooled), still no confirmed ATS edge
   (apparent per-season wins don't survive a cross-season consistency check). See Round 3
   above.
4. ~~Literature review (Streitmatter/Bouzianis/Ruscio & Brady) → nonlinear feature
   transforms, calibration table, feature-selection-vs-PCA check~~ — **tested 2026-07-24**:
   nonlinear transforms gave a small non-significant nudge on straight-up picks, no ATS
   help; calibration confirmed the model is well-calibrated where it has real signal
   (straight-up, r=0.996) and produces a meaningless correlation where it doesn't (ATS,
   only 2 populated bins); confirmed PCA actively costs ~2pts accuracy vs. raw features or
   L1 selection — should be dropped from any future round. See Round 4 above.
5. ~~Streitmatter's margin-regression + Monte Carlo simulation~~ — **tested 2026-07-24**:
   one unified margin regression matches the best two-classifier straight-up accuracy
   (65.9% vs. 66.8%) with a single coherent model, and its estimated residual σ (~13.3 pts)
   independently lands almost exactly on Ruscio & Brady's own published uncertainty
   constant (13.40-13.45) — but still no ATS edge; the model expresses real confidence
   variation for ATS (unlike the classifiers) yet that confidence doesn't track outcomes,
   a more informative "no" than before. See Round 5 above.
6. ~~Second literature review (Beal/Harville/Song/Boulier & Stekler/Szalkowski) → Naive
   Bayes + AdaBoost, weighted ensemble, home-underdog backtest~~ — **tested 2026-07-24**:
   AdaBoost is now the best straight-up performer on the Round 4 feature set (66.7% pooled
   on corrected data — see the data-quality note below, McNemar not significant vs.
   baseline); the weighted ensemble tied but didn't beat the best single model (member
   models' errors are too correlated to benefit from ensembling); the classic home-underdog
   ATS bias (53.5% in 2002-2011) has fully diminished to a coin-flip ~50.2% in our
   2015-2025 data. **Correction (Round 7):** the "home favorites under-cover significantly"
   finding originally reported here did not survive a data-quality fix — see Round 6's
   updated writeup and the Round 7 data-quality note.
7. ~~An "overreaction" feature (Vergin 2001, cited in the Stekler survey)~~ — **tested
   2026-07-24**: no supporting evidence found, on our own data or in the walk-forward
   retest. See Round 7 above.
8. Accept that free nflverse data alone may not carry enough signal beyond what's
   already priced into the closing line, and that a real edge (if one exists)
   likely requires paid/proprietary data (line-movement history, player props) —
   explicitly out of scope per the user's free-data-only decision for this pass. **Still
   the most likely explanation** even after Round 8's confirmed +1.7pt improvement — that
   improvement closes less than half the remaining gap to market (66.38% vs. best 64.40%
   on the same 7-season window).
9. ~~Re-run on more/different held-out seasons before concluding either way~~ — **tested
   2026-07-24 (Round 8)**: confirmed. AdaBoost's improvement over baseline reaches p=0.0436
   on 7 seasons (n=1,871) vs. p=0.13-0.18 on 2 seasons — the first result in this session to
   clear conventional significance. See Round 8 above.

## Files

- `pipeline/predictive_model/config.py` — isolated dirs, test-season config.
- `pipeline/predictive_model/fetch.py` — pbp/injuries/snap-counts, cached to
  `data/raw_cache_predictive/`.
- `pipeline/predictive_model/elo.py` — faithful port of `elo.ts` for the baseline.
- `pipeline/predictive_model/features.py` — leakage-safe feature engineering +
  `build_game_table`.
- `pipeline/predictive_model/train.py` — walk-forward training (HGB + LogReg,
  calibrated).
- `pipeline/predictive_model/evaluate.py` — accuracy/Brier/log-loss/ATS metrics
  + baselines + report printing.
- `pipeline/predictive_model/run_spike.py` — CLI entry point (baseline feature set).
- `pipeline/predictive_model/analyze_slices.py` — ATS accuracy sliced by team/week/
  scenario, to check for salvageable subsets (2026-07-24: nothing survives scrutiny,
  see session notes).
- `pipeline/predictive_model/compare_feature_sets.py` — baseline vs. NGS-only vs.
  FTN-only vs. combined A/B/C/D test with McNemar significance testing + permutation
  importance.
- `pipeline/predictive_model/compare_models_pca.py` — Round 3: engineered features
  (snap-weighted injuries, EPA split, field position, situational context) + PCA +
  5 model types, walk-forward, saved to `data/predictive_model/round3_pca_models.csv`.
- `pipeline/predictive_model/retest_round4.py` — Round 4: round3 vs. round4 (nonlinear
  transforms) + calibration/reliability tables, saved to
  `data/predictive_model/round4_transforms.csv`.
- `pipeline/predictive_model/compare_selection_methods.py` — raw vs. PCA vs. L1-selection
  comparison (custom leakage-safe `L1FeatureSelector`), saved to
  `data/predictive_model/selection_methods.csv`.
- `pipeline/predictive_model/margin_regression.py` — Round 5: Streitmatter-style margin
  regression + Monte Carlo simulation, saved to `data/predictive_model/margin_regression.csv`.
- `pipeline/predictive_model/compare_new_models.py` — Round 6: Naive Bayes + AdaBoost,
  saved to `data/predictive_model/new_models.csv`.
- `pipeline/predictive_model/ensemble_models.py` — Round 6: weighted ensemble, saved to
  `data/predictive_model/ensemble_models.csv`.
- `pipeline/predictive_model/home_underdog_backtest.py` — Round 6: full-history market-bias
  backtest, saved to `data/predictive_model/home_underdog_backtest.csv`.
- `pipeline/predictive_model/test_overreaction_hypothesis.py` — Round 7: direct
  overreaction-bias hypothesis test, saved to `data/predictive_model/overreaction_hypothesis.csv`.
- `pipeline/predictive_model/retest_round5_surprise.py` — Round 7: walk-forward retest of
  the surprise feature, saved to `data/predictive_model/round5_surprise.csv`.
