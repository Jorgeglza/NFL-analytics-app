"""Walk-forward training: for each test season, fit only on strictly-earlier
seasons (never on the test season, never on future weeks relative to test
rows) — the discipline the plan calls for so metrics reflect genuine
out-of-sample performance instead of the in-sample fit the old grading
RandomForest reports (it fits and scores on the same data).
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


@dataclass
class FoldResult:
    test_season: int
    model_name: str
    target: str
    y_true: np.ndarray
    y_pred_proba: np.ndarray
    spread_line: np.ndarray | None = None


def _hgb() -> HistGradientBoostingClassifier:
    # Native NaN support — no imputation needed (early-season rows with no
    # rolling history yet stay NaN rather than being mean-filled).
    return HistGradientBoostingClassifier(random_state=42, max_depth=4, learning_rate=0.05)


def _logreg() -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="mean")),
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=1000, C=1.0)),
    ])


MODEL_BUILDERS = {
    "hgb": _hgb,
    "logreg": _logreg,
}


def walk_forward(games: pd.DataFrame, feature_cols: list[str], target: str, test_seasons: list[int]) -> list[FoldResult]:
    df = games.dropna(subset=[target]).copy()
    df[target] = df[target].astype(int)
    results = []
    for test_season in test_seasons:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, feature_cols], df.loc[train_mask, target]
        X_test, y_test = df.loc[test_mask, feature_cols], df.loc[test_mask, target]
        for name, build in MODEL_BUILDERS.items():
            base = build()
            model = CalibratedClassifierCV(base, method="sigmoid", cv=3)
            model.fit(X_train, y_train)
            proba = model.predict_proba(X_test)[:, 1]
            results.append(FoldResult(
                test_season=test_season,
                model_name=name,
                target=target,
                y_true=y_test.to_numpy(),
                y_pred_proba=proba,
                spread_line=df.loc[test_mask, "spread_line"].to_numpy() if "spread_line" in df.columns else None,
            ))
    return results
