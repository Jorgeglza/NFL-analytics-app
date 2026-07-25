"""Round 3: retest with the newly engineered features (snap-weighted injury
severity, pass/rush EPA split, starting field position/expected points,
red-zone/third-down/pressure situational context) on top of baseline + NGS,
apply PCA dimensionality reduction, and try several model types — all on the
same walk-forward gateway used throughout this spike (train strictly before
each test season, evaluate against the market/baseline reference).

Model builders here are self-contained (not added to train.py's shared
MODEL_BUILDERS) so run_spike.py's original baseline result stays exactly
reproducible and unaffected by this round's additions.

    python pipeline/predictive_model/compare_models_pca.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from predictive_model import features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_COLS = features.ROUND3_DIFF_FEATURE_COLS
PCA_VARIANCE = 0.90  # keep enough components to explain 90% of variance


def _model_builders():
    return {
        "hgb": lambda: HistGradientBoostingClassifier(random_state=42, max_depth=4, learning_rate=0.05),
        "logreg": lambda: LogisticRegression(max_iter=1000, C=1.0),
        "random_forest": lambda: RandomForestClassifier(n_estimators=300, max_depth=6, random_state=42, n_jobs=-1),
        "svm_rbf": lambda: SVC(kernel="rbf", C=1.0, probability=True, random_state=42),
        "mlp": lambda: MLPClassifier(hidden_layer_sizes=(16,), alpha=1.0, max_iter=2000, random_state=42),
    }


def _make_pipeline(build_clf, use_pca: bool) -> Pipeline:
    steps = [("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler())]
    if use_pca:
        steps.append(("pca", PCA(n_components=PCA_VARIANCE, random_state=42)))
    steps.append(("clf", build_clf()))
    return Pipeline(steps)


def _metrics(y_true, y_proba):
    y_pred = (y_proba >= 0.5).astype(int)
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "brier": brier_score_loss(y_true, y_proba),
        "log_loss": log_loss(y_true, y_proba, labels=[0, 1]),
    }


def pca_summary(df: pd.DataFrame, train_mask: pd.Series) -> dict:
    """How much the feature set actually compresses — fit on a training fold
    only, so this reflects what each walk-forward split really sees."""
    X = df.loc[train_mask, FEATURE_COLS]
    pipe = Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler())])
    X_t = pipe.fit_transform(X)
    pca = PCA(n_components=PCA_VARIANCE, random_state=42).fit(X_t)
    return {"n_components": pca.n_components_, "n_features": len(FEATURE_COLS), "variance_explained": pca.explained_variance_ratio_.sum()}


def run_target(games: pd.DataFrame, target: str) -> list[dict]:
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

        pca_info = pca_summary(df, train_mask)
        rows.append({"test_season": test_season, "target": target, "model": "(PCA info)", "pca": True, "n": len(y_test),
                     "accuracy": np.nan, "brier": np.nan, "log_loss": np.nan, **pca_info})

        for model_name, build_clf in _model_builders().items():
            for use_pca in (False, True):
                pipe = _make_pipeline(build_clf, use_pca)
                # SVM/MLP are deterministic enough without extra calibration wrapping;
                # still wrap everything in CalibratedClassifierCV for comparable
                # Brier/log-loss across model types.
                model = CalibratedClassifierCV(pipe, method="sigmoid", cv=3)
                model.fit(X_train, y_train)
                proba = model.predict_proba(X_test)[:, 1]
                m = _metrics(y_test, proba)
                rows.append({
                    "test_season": test_season, "target": target, "model": model_name, "pca": use_pca,
                    "n": len(y_test), **m,
                })
    return rows


def main():
    print(f"Building game table (round-3 engineered feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    all_rows = []
    for target in ["home_win", "home_covers"]:
        all_rows.extend(run_target(games, target))
    summary = pd.DataFrame(all_rows)

    print("=" * 100)
    print(f"ROUND 3 — engineered features + PCA + multiple model types (baseline reference: HGB 67.4%/61.4% SU, 51.3%/51.3% ATS)")
    print("=" * 100)
    for target in ["home_win", "home_covers"]:
        print(f"\n--- target: {target} ---")
        sub = summary[summary["target"] == target]
        for season, grp in sub.groupby("test_season"):
            pca_row = grp[grp["model"] == "(PCA info)"]
            if not pca_row.empty:
                r = pca_row.iloc[0]
                print(f"  season {season}: PCA keeps {int(r['n_components'])}/{int(r['n_features'])} components "
                      f"({100 * r['variance_explained']:.1f}% variance)")
            models = grp[grp["model"] != "(PCA info)"].sort_values("accuracy", ascending=False)
            for _, r in models.iterrows():
                pca_tag = "PCA" if r["pca"] else "raw"
                print(f"    {r['model']:<14} {pca_tag:<3} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary.to_csv(OUTPUT_DIR / "round3_pca_models.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'round3_pca_models.csv'}")


if __name__ == "__main__":
    main()
