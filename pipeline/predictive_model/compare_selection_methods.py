"""Is PCA worthwhile, or would feature *selection* work better? Bouzianis
(2019)'s central methodology lesson was that backward elimination (pruning
505 candidate variables down to ~20) is what controlled overfitting for their
per-team models — a different mechanism than PCA, which mixes every feature
into linear combinations rather than dropping the unhelpful ones. This script
compares three ways of handling the Round 4 feature set (36 columns) on the
identical walk-forward gate used throughout this spike:

  - "raw"   : no reduction, all 36 columns (imputed only)
  - "pca"   : existing PCA(0.90) step
  - "l1"    : L1-regularized logistic regression selects features (nonzero
              coefficients only), fit fresh inside each training fold, then
              the target classifier is trained on just the selected columns

    python pipeline/predictive_model/compare_selection_methods.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.calibration import CalibratedClassifierCV
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from predictive_model import evaluate, features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_COLS = features.ROUND4_DIFF_FEATURE_COLS


class L1FeatureSelector(BaseEstimator, TransformerMixin):
    """Fits an L1-penalized LogisticRegression on (already imputed/scaled)
    training data and keeps only the columns with a nonzero coefficient —
    fit fresh inside every walk-forward training fold (and every inner CV
    fold from CalibratedClassifierCV), so there is no leakage from selecting
    features on data outside the current fold."""

    def __init__(self, C: float = 0.1):
        self.C = C

    def fit(self, X, y):
        X = np.asarray(X)
        self.selector_ = LogisticRegression(penalty="l1", solver="liblinear", C=self.C, max_iter=2000)
        self.selector_.fit(X, y)
        mask = self.selector_.coef_[0] != 0
        # guard against L1 zeroing out everything at very low C
        self.mask_ = mask if mask.any() else np.ones_like(mask, dtype=bool)
        return self

    def transform(self, X):
        return np.asarray(X)[:, self.mask_]


def _build_pipeline(strategy: str) -> Pipeline:
    steps = [("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler())]
    if strategy == "pca":
        steps.append(("reduce", PCA(n_components=0.90, random_state=42)))
    elif strategy == "l1":
        steps.append(("reduce", L1FeatureSelector(C=0.1)))
    steps.append(("clf", HistGradientBoostingClassifier(random_state=42, max_depth=4, learning_rate=0.05)))
    return Pipeline(steps)


def run(games: pd.DataFrame, target: str):
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    rows = []
    selected_counts = {}  # strategy -> list of (season, n_selected)
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, FEATURE_COLS], df.loc[train_mask, target]
        X_test, y_test = df.loc[test_mask, FEATURE_COLS], df.loc[test_mask, target].to_numpy()

        for strategy in ("raw", "pca", "l1"):
            pipe = _build_pipeline(strategy)
            model = CalibratedClassifierCV(pipe, method="sigmoid", cv=3)
            model.fit(X_train, y_train)
            proba = model.predict_proba(X_test)[:, 1]
            m = evaluate._metrics(y_test, proba)
            rows.append({"test_season": test_season, "target": target, "strategy": strategy, **m})

            if strategy == "l1":
                # refit once on the full training fold (outside the calibration
                # inner-CV) just to report which features this fold's L1 model kept
                sel = Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler())])
                X_train_t = sel.fit_transform(X_train)
                l1 = L1FeatureSelector(C=0.1).fit(X_train_t, y_train)
                n_selected = int(l1.mask_.sum())
                kept = [c for c, keep in zip(FEATURE_COLS, l1.mask_) if keep]
                selected_counts.setdefault("l1", []).append((test_season, n_selected, kept))
            elif strategy == "pca":
                sel = Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler())])
                X_train_t = sel.fit_transform(X_train)
                pca = PCA(n_components=0.90, random_state=42).fit(X_train_t)
                selected_counts.setdefault("pca", []).append((test_season, pca.n_components_, None))

    return pd.DataFrame(rows), selected_counts


def main():
    print(f"Building game table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    print("=" * 96)
    print("Feature-reduction comparison: raw vs PCA vs L1-selection (HistGradientBoosting, both targets)")
    print("=" * 96)

    all_rows = []
    for target in ["home_win", "home_covers"]:
        metrics, selected = run(games, target)
        all_rows.append(metrics)

        print(f"\n--- target: {target} ---")
        for season, grp in metrics.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['strategy']:<5} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        pooled = metrics.groupby("strategy").apply(
            lambda g: (g["accuracy"] * g["n"]).sum() / g["n"].sum(), include_groups=False
        )
        print(f"  pooled accuracy: {dict(pooled.round(4))}")

        if "l1" in selected:
            for season, n_sel, kept in selected["l1"]:
                print(f"  L1 kept {n_sel}/{len(FEATURE_COLS)} features for test season {season}:")
                print(f"    {kept}")
        if "pca" in selected:
            for season, n_comp, _ in selected["pca"]:
                print(f"  PCA kept {n_comp}/{len(FEATURE_COLS)} components (90% variance) for test season {season}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(all_rows, ignore_index=True).to_csv(OUTPUT_DIR / "selection_methods.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'selection_methods.csv'}")


if __name__ == "__main__":
    main()
