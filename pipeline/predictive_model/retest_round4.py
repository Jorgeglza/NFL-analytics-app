"""Round 4: retest with Bouzianis (2019)-inspired nonlinear feature transforms
(signed square/sqrt of Elo, starting field position, starting EP, season-to-
date grade) added on top of Round 3, plus a calibration/reliability table
(Ruscio & Brady, 2021's method) for the two most relevant models from Round 3
(HGB — the original reference model; LogisticRegression — Round 3's best
straight-up performer).

    python pipeline/predictive_model/retest_round4.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV

from predictive_model import evaluate, features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS
from predictive_model.train import MODEL_BUILDERS

FEATURE_SETS = {
    "round3": features.ROUND3_DIFF_FEATURE_COLS,
    "round4": features.ROUND4_DIFF_FEATURE_COLS,
}
MODELS = ["hgb", "logreg"]


def run(games: pd.DataFrame, target: str):
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    metric_rows = []
    # pooled (both test seasons together) predictions per (feature_set, model),
    # for a calibration table with enough samples per bin
    pooled_preds = {}
    for fs_name, cols in FEATURE_SETS.items():
        for model_name in MODELS:
            y_true_all, proba_all = [], []
            for test_season in TEST_SEASONS:
                train_mask = df["season"] < test_season
                test_mask = df["season"] == test_season
                if train_mask.sum() < 100 or test_mask.sum() == 0:
                    continue
                X_train, y_train = df.loc[train_mask, cols], df.loc[train_mask, target]
                X_test, y_test = df.loc[test_mask, cols], df.loc[test_mask, target].to_numpy()
                model = CalibratedClassifierCV(MODEL_BUILDERS[model_name](), method="sigmoid", cv=3)
                model.fit(X_train, y_train)
                proba = model.predict_proba(X_test)[:, 1]
                m = evaluate._metrics(y_test, proba)
                metric_rows.append({"test_season": test_season, "target": target, "feature_set": fs_name, "model": model_name, **m})
                y_true_all.append(y_test)
                proba_all.append(proba)
            pooled_preds[(fs_name, model_name)] = (np.concatenate(y_true_all), np.concatenate(proba_all))
    return pd.DataFrame(metric_rows), pooled_preds


def main():
    print(f"Building game table (round-4 feature set, {len(features.ROUND4_FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    print("=" * 96)
    print("ROUND 4 — nonlinear feature transforms (round3 vs round4) + calibration tables")
    print("=" * 96)

    all_metric_rows = []
    for target in ["home_win", "home_covers"]:
        metrics, pooled = run(games, target)
        all_metric_rows.append(metrics)

        print(f"\n--- target: {target} ---")
        for season, grp in metrics.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['feature_set']:<8} {r['model']:<8} n={int(r['n']):<4} acc={r['accuracy']:.4f} "
                      f"brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        print(f"\n  Pooled (both test seasons) accuracy + calibration correlation:")
        for (fs_name, model_name), (y_true, proba) in pooled.items():
            acc = (proba >= 0.5).astype(int)
            pooled_acc = (acc == y_true).mean()
            table = evaluate.calibration_table(y_true, proba, n_bins=8)
            r = evaluate.calibration_correlation(table)
            r_str = f"{r:.4f}" if r is not None else "n/a"
            print(f"    {fs_name:<8} {model_name:<8} pooled_acc={pooled_acc:.4f} n={len(y_true):<4} calibration_r={r_str}")
            if fs_name == "round4":  # print the calibration table itself for the feature set under test
                print(f"      calibration table ({fs_name}/{model_name}):")
                for _, row in table.iterrows():
                    print(f"        [{row['bin_lo']:.2f}-{row['bin_hi']:.2f}] n={int(row['n']):<4} "
                          f"predicted={row['mean_predicted']:.3f} observed={row['observed_rate']:.3f}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(all_metric_rows, ignore_index=True).to_csv(OUTPUT_DIR / "round4_transforms.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'round4_transforms.csv'}")


if __name__ == "__main__":
    main()
