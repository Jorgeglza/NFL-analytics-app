"""A/B/C/D test: baseline feature set vs. NGS-only, FTN-only, and combined
(NGS + FTN) feature sets, on identical walk-forward train/test splits and the
identical model type — the only variable that changes per run is which
columns are fed in. The combined run (2026-07-24) showed no improvement and a
mild ATS regression; NGS and FTN are isolated here to see whether one of them
is responsible (FTN's 2022-2025-only history was the suspected culprit) or
whether neither carries real signal on its own either.

Uses a paired significance test (McNemar, each non-baseline set vs baseline)
so a small accuracy delta isn't mistaken for a real improvement the way the
earlier team/week slice analysis turned out to be noise.

    python pipeline/predictive_model/compare_feature_sets.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from scipy.stats import chi2
from sklearn.calibration import CalibratedClassifierCV
from sklearn.inspection import permutation_importance
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss

from predictive_model import features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS
from predictive_model.train import MODEL_BUILDERS

MODEL_NAME = "hgb"
BASELINE_KEY = "baseline"
FEATURE_SETS = {
    "baseline": features.BASELINE_DIFF_FEATURE_COLS,
    "ngs_only": features.NGS_ONLY_DIFF_FEATURE_COLS,
    "ftn_only": features.FTN_ONLY_DIFF_FEATURE_COLS,
    "combined": features.EXTENDED_DIFF_FEATURE_COLS,
}
NEW_COLS_BY_SET = {
    "ngs_only": features.NGS_FEATURE_COLS,
    "ftn_only": features.FTN_FEATURE_COLS,
    "combined": features.NEW_FEATURE_COLS,
}


def _metrics(y_true, y_proba):
    y_pred = (y_proba >= 0.5).astype(int)
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "brier": brier_score_loss(y_true, y_proba),
        "log_loss": log_loss(y_true, y_proba, labels=[0, 1]),
    }, y_pred


def _mcnemar(correct_baseline: np.ndarray, correct_other: np.ndarray) -> dict:
    """b = baseline right/other wrong, c = baseline wrong/other right
    (discordant pairs only). Continuity-corrected chi-square, 1 dof.
    p < 0.05 means the difference in per-game correctness is unlikely to be
    chance, in either direction."""
    b = int(((correct_baseline == 1) & (correct_other == 0)).sum())
    c = int(((correct_baseline == 0) & (correct_other == 1)).sum())
    if b + c == 0:
        return {"baseline_only_right": b, "other_only_right": c, "statistic": 0.0, "p_value": 1.0}
    stat = (abs(b - c) - 1) ** 2 / (b + c)
    p = 1 - chi2.cdf(stat, df=1)
    return {"baseline_only_right": b, "other_only_right": c, "statistic": stat, "p_value": p}


def run_target(games: pd.DataFrame, target: str) -> tuple[list[dict], dict]:
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    fold_rows = []
    importances_by_season = {}
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        y_train = df.loc[train_mask, target]
        y_test = df.loc[test_mask, target].to_numpy()

        preds = {}
        for fs_name, cols in FEATURE_SETS.items():
            X_train = df.loc[train_mask, cols]
            X_test = df.loc[test_mask, cols]
            model = CalibratedClassifierCV(MODEL_BUILDERS[MODEL_NAME](), method="sigmoid", cv=3)
            model.fit(X_train, y_train)
            proba = model.predict_proba(X_test)[:, 1]
            m, y_pred = _metrics(y_test, proba)
            preds[fs_name] = {"proba": proba, "pred": y_pred, "metrics": m}
            fold_rows.append({"test_season": test_season, "target": target, "feature_set": fs_name, "n": len(y_test), **m})

        correct = {fs: (p["pred"] == y_test).astype(int) for fs, p in preds.items()}
        for fs_name in FEATURE_SETS:
            if fs_name == BASELINE_KEY:
                continue
            mc = _mcnemar(correct[BASELINE_KEY], correct[fs_name])
            fold_rows.append({
                "test_season": test_season, "target": target,
                "feature_set": f"mcnemar(baseline_vs_{fs_name})", "n": len(y_test), **mc,
            })

        # Permutation importance of each non-baseline model's own new columns
        # only — do they actually get used, or is any delta not attributable
        # to them at all.
        fold_importances = {}
        for fs_name, new_cols in NEW_COLS_BY_SET.items():
            cols = FEATURE_SETS[fs_name]
            model = CalibratedClassifierCV(MODEL_BUILDERS[MODEL_NAME](), method="sigmoid", cv=3)
            model.fit(df.loc[train_mask, cols], y_train)
            X_test_fs = df.loc[test_mask, cols]
            pi = permutation_importance(model, X_test_fs, y_test, n_repeats=20, random_state=42, scoring="neg_brier_score")
            imp = pd.Series(pi.importances_mean, index=cols).sort_values(ascending=False)
            fold_importances[fs_name] = imp
        importances_by_season[test_season] = fold_importances

    return fold_rows, importances_by_season


def main():
    print(f"Building game table (all feature sources) for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    all_rows = []
    all_importances = {}
    for target in ["home_win", "home_covers"]:
        rows, importances = run_target(games, target)
        all_rows.extend(rows)
        all_importances[target] = importances

    summary = pd.DataFrame(all_rows)

    print("=" * 96)
    print("BASELINE vs NGS-only vs FTN-only vs COMBINED - walk-forward comparison")
    print("=" * 96)
    for target in ["home_win", "home_covers"]:
        print(f"\n--- target: {target} ---")
        sub = summary[summary["target"] == target]
        for season, grp in sub.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.iterrows():
                if r["feature_set"] in FEATURE_SETS:
                    print(f"    {r['feature_set']:<10} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")
                else:
                    sig = "SIGNIFICANT" if r["p_value"] < 0.05 else "not significant"
                    print(f"    {r['feature_set']:<32} baseline-only-right={int(r['baseline_only_right'])} "
                          f"other-only-right={int(r['other_only_right'])} p={r['p_value']:.4f} ({sig})")

        for fs_name in ("ngs_only", "ftn_only", "combined"):
            print(f"\n  Top permutation importances ({fs_name} model, its own new columns marked with *):")
            new_diff_cols = {f"diff_{c}" for c in NEW_COLS_BY_SET[fs_name]}
            for season in all_importances[target]:
                imp = all_importances[target][season][fs_name]
                print(f"  -- season {season} --")
                for name, val in imp.head(8).items():
                    marker = "*" if name in new_diff_cols else " "
                    print(f"    {marker} {name:<28} {val:.5f}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary.to_csv(OUTPUT_DIR / "feature_ab_test.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'feature_ab_test.csv'}")


if __name__ == "__main__":
    main()
