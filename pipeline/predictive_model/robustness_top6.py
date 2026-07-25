"""Robustness check for the top 6 distinct configurations from the final
results table (docs/predictive-model.md): instead of the usual 2 held-out
test seasons, walk-forward across 7 (2019-2025) to see whether each
configuration's straight-up accuracy holds up consistently or swings around
season to season — a 2-season sample is thin for telling a real ~2pt edge
apart from noise, which is exactly the caveat flagged after the final results
table. Straight-up (home_win) only, matching that table's scope.

The 6 configs (chosen for being distinct approaches, not near-duplicates of
each other — the weighted ensemble and Random-Forest+PCA were dropped as
redundant with AdaBoost and Random-Forest-raw respectively):

  1. AdaBoost              (round4 features, complexity 3) -- the best result
  2. LogReg                (round3 features, complexity 2) -- simplest near-best
  3. L1-selected HGB       (round4 features, complexity 4)
  4. Random Forest         (round3 features, complexity 3)
  5. Naive Bayes           (round4 features, complexity 2)
  6. Margin regression     (round4 features, complexity 5) -- LogReg-style, simulated

    python pipeline/predictive_model/robustness_top6.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import AdaBoostClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from predictive_model import evaluate, features
from predictive_model.compare_selection_methods import L1FeatureSelector
from predictive_model.config import OUTPUT_DIR, SEASONS
from predictive_model.margin_regression import N_SIMS, _reg_builders, _simulate

# 2015-2018 is reserved as a minimum training floor; 2019-2025 gives 7 test
# seasons with 4-10 seasons of training data each, growing every fold as usual.
TEST_SEASONS_ROBUST = list(range(2019, 2026))

CONFIGS = {
    "adaboost_r4": {
        "label": "AdaBoost (round4)", "kind": "classifier",
        "features": features.ROUND4_DIFF_FEATURE_COLS, "n_features": len(features.ROUND4_DIFF_FEATURE_COLS),
        "complexity": 3,
        "build": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")),
                                    ("clf", AdaBoostClassifier(n_estimators=100, random_state=42))]),
    },
    "logreg_r3": {
        "label": "LogReg (round3)", "kind": "classifier",
        "features": features.ROUND3_DIFF_FEATURE_COLS, "n_features": len(features.ROUND3_DIFF_FEATURE_COLS),
        "complexity": 2,
        "build": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()), ("clf", LogisticRegression(max_iter=1000))]),
    },
    "l1_hgb_r4": {
        "label": "L1-selected HGB (round4)", "kind": "classifier",
        "features": features.ROUND4_DIFF_FEATURE_COLS, "n_features": len(features.ROUND4_DIFF_FEATURE_COLS),
        "complexity": 4,
        "build": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()),
                                    ("reduce", L1FeatureSelector(C=0.1)),
                                    ("clf", HistGradientBoostingClassifier(random_state=42, max_depth=4, learning_rate=0.05))]),
    },
    "rf_r3": {
        "label": "Random Forest (round3)", "kind": "classifier",
        "features": features.ROUND3_DIFF_FEATURE_COLS, "n_features": len(features.ROUND3_DIFF_FEATURE_COLS),
        "complexity": 3,
        "build": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()),
                                    ("clf", RandomForestClassifier(n_estimators=300, max_depth=6, random_state=42, n_jobs=-1))]),
    },
    "naive_bayes_r4": {
        "label": "Naive Bayes (round4)", "kind": "classifier",
        "features": features.ROUND4_DIFF_FEATURE_COLS, "n_features": len(features.ROUND4_DIFF_FEATURE_COLS),
        "complexity": 2,
        "build": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()), ("clf", GaussianNB())]),
    },
    "margin_linreg_r4": {
        "label": "Margin regression, LogReg-style (round4)", "kind": "margin_regression",
        "features": features.ROUND4_DIFF_FEATURE_COLS, "n_features": len(features.ROUND4_DIFF_FEATURE_COLS),
        "complexity": 5,
        "build": _reg_builders()["lin_reg"],
    },
}


def run_classifier(cfg, df, cols, train_mask, test_mask):
    X_train, y_train = df.loc[train_mask, cols], df.loc[train_mask, "home_win"].astype(int)
    X_test, y_test = df.loc[test_mask, cols], df.loc[test_mask, "home_win"].astype(int).to_numpy()
    model = CalibratedClassifierCV(cfg["build"](), method="sigmoid", cv=3)
    model.fit(X_train, y_train)
    proba = model.predict_proba(X_test)[:, 1]
    return evaluate._metrics(y_test, proba)


def run_margin_regression(cfg, df, cols, train_mask, test_mask):
    df_m = df.dropna(subset=["home_margin"])
    train_mask = train_mask & df.index.isin(df_m.index)
    test_mask = test_mask & df.index.isin(df_m.index)
    X_train, y_train = df.loc[train_mask, cols], df.loc[train_mask, "home_margin"]
    X_test = df.loc[test_mask, cols]
    y_test = df.loc[test_mask, "home_win"].astype(int).to_numpy()

    oof_pred = cross_val_predict(cfg["build"](), X_train, y_train, cv=KFold(5, shuffle=True, random_state=42))
    residuals = y_train.to_numpy() - oof_pred
    model = cfg["build"]()
    model.fit(X_train, y_train)
    predicted_margin = model.predict(X_test)
    spread_dummy = np.zeros(len(predicted_margin))  # only need p_home_win here
    p_home_win, _ = _simulate(predicted_margin, residuals, spread_dummy)
    return evaluate._metrics(y_test, p_home_win)


def main():
    print(f"Building game table for seasons {SEASONS[0]}-{SEASONS[-1]}, robustness test seasons "
          f"{TEST_SEASONS_ROBUST[0]}-{TEST_SEASONS_ROBUST[-1]}...")
    games = features.build_game_table(SEASONS)
    df = games.dropna(subset=["home_win"]).copy()
    df["home_win"] = df["home_win"].astype(int)
    print(f"{len(df)} completed REG games.\n")

    all_rows = []
    for name, cfg in CONFIGS.items():
        print(f"Running {cfg['label']}...")
        for test_season in TEST_SEASONS_ROBUST:
            train_mask = df["season"] < test_season
            test_mask = df["season"] == test_season
            if train_mask.sum() < 100 or test_mask.sum() == 0:
                continue
            if cfg["kind"] == "classifier":
                m = run_classifier(cfg, df, cfg["features"], train_mask, test_mask)
            else:
                m = run_margin_regression(cfg, df, cfg["features"], train_mask, test_mask)
            all_rows.append({"config": name, "label": cfg["label"], "test_season": test_season,
                              "n_features": cfg["n_features"], "complexity": cfg["complexity"], **m})

    results = pd.DataFrame(all_rows)

    print("\n" + "=" * 100)
    print("TOP-6 ROBUSTNESS CHECK -- straight-up (home_win) accuracy across 7 seasons")
    print("=" * 100)
    summary_rows = []
    for name, cfg in CONFIGS.items():
        sub = results[results["config"] == name]
        pooled_acc = (sub["accuracy"] * sub["n"]).sum() / sub["n"].sum()
        summary_rows.append({
            "config": cfg["label"], "n_features": cfg["n_features"], "complexity": cfg["complexity"],
            "pooled_acc": pooled_acc, "mean_acc": sub["accuracy"].mean(), "std_acc": sub["accuracy"].std(),
            "min_acc": sub["accuracy"].min(), "max_acc": sub["accuracy"].max(),
        })
        print(f"\n{cfg['label']} ({cfg['n_features']} features, complexity {cfg['complexity']}):")
        for _, r in sub.iterrows():
            print(f"    season {int(r['test_season'])}: n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f}")
        print(f"    pooled={pooled_acc:.4f}  mean={sub['accuracy'].mean():.4f}  std={sub['accuracy'].std():.4f}  "
              f"range=[{sub['accuracy'].min():.4f}, {sub['accuracy'].max():.4f}]")

    summary = pd.DataFrame(summary_rows).sort_values("pooled_acc", ascending=False)
    print("\n" + "=" * 100)
    print("SUMMARY (sorted by pooled accuracy across all 7 seasons)")
    print("=" * 100)
    print(summary.to_string(index=False))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUTPUT_DIR / "robustness_top6.csv", index=False)
    summary.to_csv(OUTPUT_DIR / "robustness_top6_summary.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'robustness_top6.csv'} and {OUTPUT_DIR / 'robustness_top6_summary.csv'}")


if __name__ == "__main__":
    main()
