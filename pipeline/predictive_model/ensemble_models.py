"""Beal, Norman & Ramchurn (2020) found that the single best model changed
season to season (Naive Bayes won overall, but AdaBoost or Random Forest won
individual years) and explicitly recommended ensembling as the fix — echoed
independently by the Song/Boulier/Stekler survey ("combining forecasts does
improve accuracy"). This builds a weighted ensemble of the four model types
tested this session (HGB, LogisticRegression, GaussianNB, AdaBoost) two ways:

  - "equal"        : simple average of the 4 models' probabilities
  - "brier_weighted": weighted average, weights inversely proportional to
                      each model's out-of-fold Brier score on the TRAINING
                      fold only (never touches test data) — models that were
                      better-calibrated on training data get more say

    python pipeline/predictive_model/ensemble_models.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.metrics import brier_score_loss
from sklearn.model_selection import KFold, cross_val_predict

from predictive_model import evaluate, features
from predictive_model.compare_new_models import model_builders
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_COLS = features.ROUND4_DIFF_FEATURE_COLS
BASE_MODELS = ["hgb", "logreg", "naive_bayes", "adaboost"]


def run(games: pd.DataFrame, target: str):
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    rows = []
    weight_rows = []
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, FEATURE_COLS], df.loc[train_mask, target]
        X_test, y_test = df.loc[test_mask, FEATURE_COLS], df.loc[test_mask, target].to_numpy()

        imputer = SimpleImputer(strategy="mean")
        X_train_imp = imputer.fit_transform(X_train)
        X_test_imp = imputer.transform(X_test)

        test_probas = {}
        briers = {}
        for model_name in BASE_MODELS:
            build = model_builders()[model_name]
            X_tr, X_te = (X_train, X_test) if model_name == "hgb" else (X_train_imp, X_test_imp)

            # out-of-fold Brier on TRAIN only, to weight this model in the ensemble
            oof_proba = cross_val_predict(build(), X_tr, y_train, cv=KFold(5, shuffle=True, random_state=42), method="predict_proba")[:, 1]
            briers[model_name] = brier_score_loss(y_train, oof_proba)

            # final fit on full train, predict on held-out test season
            model = CalibratedClassifierCV(build(), method="sigmoid", cv=3)
            model.fit(X_tr, y_train)
            test_probas[model_name] = model.predict_proba(X_te)[:, 1]
            m = evaluate._metrics(y_test, test_probas[model_name])
            rows.append({"test_season": test_season, "target": target, "model": model_name, **m})

        inv_brier = {k: 1.0 / v for k, v in briers.items()}
        total = sum(inv_brier.values())
        brier_weights = {k: v / total for k, v in inv_brier.items()}
        equal_weights = {k: 1.0 / len(BASE_MODELS) for k in BASE_MODELS}
        weight_rows.append({"test_season": test_season, **{f"brier_{k}": v for k, v in briers.items()},
                             **{f"weight_{k}": v for k, v in brier_weights.items()}})

        for ens_name, weights in [("equal", equal_weights), ("brier_weighted", brier_weights)]:
            p_ens = sum(weights[k] * test_probas[k] for k in BASE_MODELS)
            m = evaluate._metrics(y_test, p_ens)
            rows.append({"test_season": test_season, "target": target, "model": f"ensemble_{ens_name}", **m})

    return pd.DataFrame(rows), pd.DataFrame(weight_rows)


def main():
    print(f"Building game table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    print("=" * 96)
    print(f"WEIGHTED ENSEMBLE of {BASE_MODELS} (Beal 2020's ensembling recommendation)")
    print("=" * 96)

    all_rows = []
    for target in ["home_win", "home_covers"]:
        metrics, weights = run(games, target)
        all_rows.append(metrics)

        print(f"\n--- target: {target} ---")
        for season, grp in metrics.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['model']:<18} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        pooled = metrics.groupby("model").apply(lambda g: (g["accuracy"] * g["n"]).sum() / g["n"].sum(), include_groups=False)
        print(f"  pooled accuracy: {dict(pooled.round(4))}")
        print(f"\n  Brier-inverse ensemble weights per fold:")
        print(weights.to_string(index=False))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(all_rows, ignore_index=True).to_csv(OUTPUT_DIR / "ensemble_models.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'ensemble_models.csv'}")


if __name__ == "__main__":
    main()
