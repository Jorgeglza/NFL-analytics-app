"""Retest with the overreaction/surprise feature added (Round 4 vs. Round 5
feature sets), using the two strongest models found this session so far
(AdaBoost — the current best straight-up performer — and HGB, the running
reference point). Same walk-forward gate, McNemar significance test per
model/target so a small delta isn't mistaken for a real effect — the direct
hypothesis test in test_overreaction_hypothesis.py already found a weak,
near-zero, non-monotonic correlation between surprise and market bias, so a
strong result here would be worth scrutinizing rather than taking at face
value.

    python pipeline/predictive_model/retest_round5_surprise.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import numpy as np
import pandas as pd
from scipy.stats import chi2
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer

from predictive_model import evaluate, features
from predictive_model.compare_new_models import model_builders
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_SETS = {
    "round4": features.ROUND4_DIFF_FEATURE_COLS,
    "round5": features.ROUND5_DIFF_FEATURE_COLS,
}
MODELS = ["adaboost", "hgb"]


def _mcnemar(correct_a: np.ndarray, correct_b: np.ndarray) -> dict:
    b = int(((correct_a == 1) & (correct_b == 0)).sum())
    c = int(((correct_a == 0) & (correct_b == 1)).sum())
    if b + c == 0:
        return {"round4_only_right": b, "round5_only_right": c, "p_value": 1.0}
    stat = (abs(b - c) - 1) ** 2 / (b + c)
    return {"round4_only_right": b, "round5_only_right": c, "p_value": 1 - chi2.cdf(stat, df=1)}


def run(games: pd.DataFrame, target: str):
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    rows = []
    mcnemar_rows = []
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        y_train = df.loc[train_mask, target]
        y_test = df.loc[test_mask, target].to_numpy()

        for model_name in MODELS:
            correct_by_fs = {}
            for fs_name, cols in FEATURE_SETS.items():
                build = model_builders()[model_name]
                X_train, X_test = df.loc[train_mask, cols], df.loc[test_mask, cols]
                if model_name != "hgb":
                    imputer = SimpleImputer(strategy="mean")
                    X_train = imputer.fit_transform(X_train)
                    X_test = imputer.transform(X_test)
                model = CalibratedClassifierCV(build(), method="sigmoid", cv=3)
                model.fit(X_train, y_train)
                proba = model.predict_proba(X_test)[:, 1]
                m = evaluate._metrics(y_test, proba)
                rows.append({"test_season": test_season, "target": target, "model": model_name, "feature_set": fs_name, **m})
                correct_by_fs[fs_name] = ((proba >= 0.5).astype(int) == y_test).astype(int)
            mc = _mcnemar(correct_by_fs["round4"], correct_by_fs["round5"])
            mcnemar_rows.append({"test_season": test_season, "target": target, "model": model_name, **mc})

    return pd.DataFrame(rows), pd.DataFrame(mcnemar_rows)


def main():
    print(f"Building game table (round-5 feature set, {len(features.ROUND5_FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    print("=" * 96)
    print("ROUND 5 (surprise feature) vs. ROUND 4 -- AdaBoost + HGB, both targets")
    print("=" * 96)

    all_rows = []
    for target in ["home_win", "home_covers"]:
        metrics, mcnemar = run(games, target)
        all_rows.append(metrics)

        print(f"\n--- target: {target} ---")
        for season, grp in metrics.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['model']:<10} {r['feature_set']:<7} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        pooled = metrics.groupby(["model", "feature_set"]).apply(
            lambda g: (g["accuracy"] * g["n"]).sum() / g["n"].sum(), include_groups=False
        )
        print(f"  pooled accuracy:")
        for (model_name, fs_name), acc in pooled.items():
            print(f"    {model_name:<10} {fs_name:<7} {acc:.4f}")

        print(f"  McNemar (round4 vs round5) per fold:")
        for _, r in mcnemar.iterrows():
            sig = "SIGNIFICANT" if r["p_value"] < 0.05 else "not significant"
            print(f"    season {int(r['test_season'])} {r['model']:<10} round4-only-right={int(r['round4_only_right'])} "
                  f"round5-only-right={int(r['round5_only_right'])} p={r['p_value']:.4f} ({sig})")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(all_rows, ignore_index=True).to_csv(OUTPUT_DIR / "round5_surprise.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'round5_surprise.csv'}")


if __name__ == "__main__":
    main()
