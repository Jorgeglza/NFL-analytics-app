"""Beal, Norman & Ramchurn (2020) found Naive Bayes (67.53%) and AdaBoost
(66.35%) were the two best-performing classifiers of nine tested on NFL match
outcomes — neither has been tried in this spike (HGB/LogReg/RandomForest/SVM/
MLP only, see compare_models_pca.py). This adds both on the Round 4 feature
set, same walk-forward gate, for direct comparison against everything tried
so far this session.

    python pipeline/predictive_model/compare_new_models.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import AdaBoostClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from predictive_model import evaluate, features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_COLS = features.ROUND4_DIFF_FEATURE_COLS


def model_builders():
    return {
        "hgb": lambda: HistGradientBoostingClassifier(random_state=42, max_depth=4, learning_rate=0.05),
        "logreg": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()), ("clf", LogisticRegression(max_iter=1000))]),
        "naive_bayes": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()), ("clf", GaussianNB())]),
        "adaboost": lambda: AdaBoostClassifier(n_estimators=100, random_state=42),
    }


def run(games: pd.DataFrame, target: str) -> pd.DataFrame:
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)

    rows = []
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, FEATURE_COLS], df.loc[train_mask, target]
        X_test, y_test = df.loc[test_mask, FEATURE_COLS], df.loc[test_mask, target].to_numpy()

        # AdaBoost/GaussianNB can't handle NaN natively -> impute for everything
        # so the comparison isn't confounded by which models get NaN for free.
        imputer = SimpleImputer(strategy="mean")
        X_train_imp = imputer.fit_transform(X_train)
        X_test_imp = imputer.transform(X_test)

        for model_name, build in model_builders().items():
            model = CalibratedClassifierCV(build(), method="sigmoid", cv=3)
            if model_name in ("hgb",):
                model.fit(X_train, y_train)  # HGB keeps native NaN handling
                proba = model.predict_proba(X_test)[:, 1]
            else:
                model.fit(X_train_imp, y_train)
                proba = model.predict_proba(X_test_imp)[:, 1]
            m = evaluate._metrics(y_test, proba)
            rows.append({"test_season": test_season, "target": target, "model": model_name, **m})
    return pd.DataFrame(rows)


def main():
    print(f"Building game table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    print("=" * 96)
    print("Naive Bayes + AdaBoost vs. existing models (Beal, Norman & Ramchurn 2020's top performers)")
    print("=" * 96)

    all_rows = []
    for target in ["home_win", "home_covers"]:
        metrics = run(games, target)
        all_rows.append(metrics)

        print(f"\n--- target: {target} ---")
        for season, grp in metrics.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['model']:<12} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        pooled = metrics.groupby("model").apply(lambda g: (g["accuracy"] * g["n"]).sum() / g["n"].sum(), include_groups=False)
        print(f"  pooled accuracy: {dict(pooled.round(4))}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(all_rows, ignore_index=True).to_csv(OUTPUT_DIR / "new_models.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'new_models.csv'}")


if __name__ == "__main__":
    main()
