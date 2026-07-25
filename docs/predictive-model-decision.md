# Predictive model — decision record

**Decision (2026-07-24): margin regression, LogReg-style, is the go-to model.**
AdaBoost (round4 features) is the close second — kept documented here as the fallback if
margin regression turns out to be harder to productionize than expected, or if the
exploration page's needs shift.

This is a decision record, not the research log — see `docs/predictive-model.md` for the
full 8-round investigation (data sources tried, statistical tests, everything ruled out).
This file exists so "which model, and why" is answerable without reading that whole trail.

## The winner: margin regression, LogReg-style

- **Architecture**: one `LinearRegression` (imputed + standardized) fit on point margin
  (`home_score - away_score`), Round 4 feature set (41 columns). Residual distribution
  estimated out-of-fold on training data only (σ≈13.2-13.4, near-normal). Win probability
  derived from that fitted distribution — either the closed-form normal-CDF (deterministic,
  recommended for the production probability surface) or Monte Carlo simulation of the
  actual residual pool (captures real skew/fat-tails, useful for the exploration page's
  confidence visualizations).
- **Performance** (7-season walk-forward, 2019-2025, n=1,871): 64.40% pooled straight-up
  accuracy, tied with AdaBoost for best in the session, but with the **lowest season-to-season
  variance of anything tested** (std=0.0280 — tighter than the market's own 0.0301).
  McNemar vs. the original baseline: p=0.0611 (borderline, just short of the conventional
  0.05 cutoff that AdaBoost cleared).
- **Complexity**: 5/5 (multi-stage: fit regression → estimate residual distribution →
  derive probabilities) — the most complex config in the whole comparison, but the extra
  machinery buys genuine capability the simpler models don't have (see below).

### Why this model over AdaBoost, given the two pages planned

The app will have two separate surfaces:
1. A **production surface** (elsewhere in the app, matching the existing pattern) that
   shows only the win probability — "the important number."
2. A **predictive-model exploration/explanation page** (this decision is for) whose entire
   purpose is exploring performance and explaining the model.

Because surface #1 only needs a probability, and both models produce one equally well
(margin regression's normal-CDF derivation is deterministic and nearly as accurate as
AdaBoost's direct output), the choice comes down entirely to which model gives richer
material for surface #2:

- **Exploration** (per season/week/team): margin regression outputs a **predicted point
  margin**, not just a win/loss call — a continuous quantity that can be plotted against
  actual margin per team/week/season to show *how wrong*, not just *whether* wrong. AdaBoost
  only gives a binary right/wrong per game.
- **Explanation** (feature importance/contribution): linear coefficients state a feature's
  contribution in actual point-margin units ("a 1-unit increase in Elo diff shifts the
  margin by X points") — directly readable. AdaBoost's importances only say a feature was
  used in splits often, with no clean sign or magnitude.
- **Confidence**: margin regression has an actual fitted residual distribution to visualize
  as a confidence band/curve around the predicted margin. AdaBoost has only the single
  calibrated probability — no equivalent richer object.

Since production-surface quality is a wash between the two, and margin regression is
strictly better for exploration and explanation, it's the pick for both.

## The runner-up: AdaBoost (round4 features)

Keep documented, not discarded — worth reconsidering if:
- Margin regression's residual/simulation machinery proves too costly or confusing to
  productionize (own pipeline export step, own explanation UI for the distribution).
- A future round finds a reason AdaBoost's split-based feature importances are actually
  preferred (e.g., if nonlinear interactions the linear model can't capture turn out to
  matter more than expected).

Numbers side by side, 7-season walk-forward (2019-2025, n=1,871), from
`docs/predictive-model.md`'s Round 8:

| | Margin regression (LogReg-style) | AdaBoost |
|---|---|---|
| Features | 41 | 41 |
| Complexity | 5 | 3 |
| Pooled straight-up accuracy | 64.40% | 64.40% |
| Std dev across seasons | **0.0280 (most stable of all 6 configs)** | 0.0323 |
| McNemar vs. baseline | p=0.0611 | **p=0.0436 (significant)** |

## Implementation notes carried forward

- Use the **normal-CDF** probability derivation for anything the production surface
  consumes (deterministic, no RNG, 65.81% vs. simulation's 66.18% in the 2-season check —
  close enough that determinism wins). Reserve the **Monte Carlo simulation** variant for
  the exploration page if a visual of the actual (slightly skewed) residual shape is wanted
  instead of an idealized normal curve.
- Use **permutation importance**, not raw linear coefficients, as the primary "feature
  contribution" metric for the explanation page — the 41 features are meaningfully
  collinear (EPA/success-rate/grade all correlate), which can make raw coefficient
  signs/magnitudes unstable across refits. Permutation importance is already implemented
  in `pipeline/predictive_model/compare_models_pca.py` and `compare_selection_methods.py`
  and is more robust to that collinearity.
- Model + feature set: `pipeline/predictive_model/margin_regression.py`'s `lin_reg` builder,
  `features.ROUND4_DIFF_FEATURE_COLS` (41 columns) — everything needed already exists in the
  isolated `pipeline/predictive_model/` package; nothing here requires new data ingestion.
