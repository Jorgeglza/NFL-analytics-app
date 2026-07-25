"""Slices the ATS (home_covers) predictions by team/week/scenario to check
whether any subset clears the ~52.4% breakeven even though the aggregate
doesn't — run after run_spike.py shows no overall edge, to see whether
anything is salvageable rather than a uniform "no" everywhere.

    python pipeline/predictive_model/analyze_slices.py

Uses the same walk-forward discipline as train.py (each test season scored by
a model fit only on strictly-earlier seasons) — this is a diagnostic pass, not
a new modeling approach, so it reuses train.MODEL_BUILDERS directly.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV

from predictive_model import features
from predictive_model.config import SEASONS, TEST_SEASONS
from predictive_model.evaluate import BREAKEVEN_ATS
from predictive_model.train import MODEL_BUILDERS

TARGET = "home_covers"
MODEL_NAME = "hgb"  # the ATS-best model from run_spike.py


def build_predictions() -> pd.DataFrame:
    games = features.build_game_table(SEASONS)
    df = games.dropna(subset=[TARGET]).copy()
    df[TARGET] = df[TARGET].astype(int)

    rows = []
    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, features.DIFF_FEATURE_COLS], df.loc[train_mask, TARGET]
        X_test = df.loc[test_mask, features.DIFF_FEATURE_COLS]
        model = CalibratedClassifierCV(MODEL_BUILDERS[MODEL_NAME](), method="sigmoid", cv=3)
        model.fit(X_train, y_train)
        proba = model.predict_proba(X_test)[:, 1]
        chunk = df.loc[test_mask, [
            "season", "week", "home_team", "away_team", "spread_line", "div_game",
            "roof", "wind", "temp", TARGET,
        ]].copy()
        chunk["pred_proba"] = proba
        chunk["pred"] = (proba >= 0.5).astype(int)
        chunk["correct"] = (chunk["pred"] == chunk[TARGET]).astype(int)
        chunk["conf"] = np.abs(proba - 0.5)
        chunk["home_favorite"] = chunk["spread_line"] < 0
        chunk["abs_spread"] = chunk["spread_line"].abs()
        rows.append(chunk)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def _slice_report(df: pd.DataFrame, group_col: str, min_n: int = 15) -> pd.DataFrame:
    g = df.groupby(group_col).agg(n=("correct", "size"), acc=("correct", "mean")).reset_index()
    g = g[g["n"] >= min_n].sort_values("acc", ascending=False)
    g["beats_breakeven"] = g["acc"] > BREAKEVEN_ATS
    return g


def _team_slice(df: pd.DataFrame, min_n: int = 15) -> pd.DataFrame:
    home = df[["home_team", "correct"]].rename(columns={"home_team": "team"})
    away = df[["away_team", "correct"]].rename(columns={"away_team": "team"})
    both = pd.concat([home, away], ignore_index=True)
    g = both.groupby("team").agg(n=("correct", "size"), acc=("correct", "mean")).reset_index()
    g = g[g["n"] >= min_n].sort_values("acc", ascending=False)
    g["beats_breakeven"] = g["acc"] > BREAKEVEN_ATS
    return g


def main():
    df = build_predictions()
    print(f"{len(df)} predictions across test seasons {TEST_SEASONS} (model={MODEL_NAME}, target={TARGET})")
    overall_acc = df["correct"].mean()
    print(f"Overall ATS accuracy: {overall_acc:.4f} (breakeven {BREAKEVEN_ATS:.4f})\n")

    print("=== By week ===")
    print(_slice_report(df, "week").to_string(index=False))

    print("\n=== By team (home or away) ===")
    print(_team_slice(df).to_string(index=False))

    print("\n=== By home_favorite ===")
    print(_slice_report(df, "home_favorite").to_string(index=False))

    print("\n=== By div_game ===")
    print(_slice_report(df, "div_game").to_string(index=False))

    df["spread_bucket"] = pd.cut(df["abs_spread"], [0, 3, 7, 100], labels=["0-3", "3-7", "7+"], include_lowest=True)
    print("\n=== By |spread| bucket ===")
    print(_slice_report(df, "spread_bucket").to_string(index=False))

    df["conf_bucket"] = pd.cut(df["conf"], [0, 0.05, 0.15, 1], labels=["toss-up(<55%)", "mid(55-65%)", "high(>65%)"], include_lowest=True)
    print("\n=== By model confidence ===")
    print(_slice_report(df, "conf_bucket").to_string(index=False))

    df["is_dome"] = df["roof"].isin(["dome", "closed"])
    print("\n=== By dome/outdoor ===")
    print(_slice_report(df, "is_dome").to_string(index=False))

    print("\n=== By season ===")
    print(_slice_report(df, "season", min_n=1).to_string(index=False))


if __name__ == "__main__":
    main()
