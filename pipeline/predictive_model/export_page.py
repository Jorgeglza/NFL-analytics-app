"""Export step for the /data/predictive_model app page (P2).

Reuses margin_regression.py's walk-forward loop (lin_reg builder, _simulate,
_normal_cdf) but widens the test-season range to "all available history" (per
user decision) and writes per-game predictions + aggregates as frontend-
consumable JSON, instead of just the research metrics CSV margin_regression.py
produces.

Deliberately writes to app/public/data/predictive_model/ (not
data/predictive_model/, where every other script in this package writes) --
this is the one export in the isolated predictive_model package meant for the
frontend to actually load, same as every other page's JSON extract. See
docs/predictive-model.md / docs/predictive-model-decision.md for the research
behind the model choice.

    python pipeline/predictive_model/export_page.py
"""
import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.model_selection import KFold, cross_val_predict

from predictive_model import evaluate, features
from predictive_model.config import FIRST_SEASON, REPO_ROOT, current_season
from predictive_model.margin_regression import FEATURE_COLS, _normal_cdf, _reg_builders, _simulate

APP_DATA_DIR = REPO_ROOT / "app" / "public" / "data" / "predictive_model"

# Every season with >=3 strictly-earlier seasons of training data, through the
# latest completed season -- "backtest from all available data" per user
# decision, wider than the 2-7 season windows used during research.
EXPORT_TEST_SEASONS = list(range(FIRST_SEASON + 3, current_season() + 1))


def _clean(v):
    if v is None or v is pd.NaT or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, float):
        if np.isnan(v) or np.isinf(v):
            return None
        return round(v, 4)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return _clean(float(v))
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def _compact(df: pd.DataFrame) -> dict:
    return {
        "cols": list(df.columns),
        "rows": [[_clean(v) for v in row] for row in df.itertuples(index=False, name=None)],
    }


def _write_json(name: str, obj) -> None:
    path = APP_DATA_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text, encoding="utf-8")
    print(f"wrote {name}  ({len(text) // 1024} KB raw)")


def run(games: pd.DataFrame):
    """Walk-forward lin_reg loop, same fit/residual/probability logic as
    margin_regression.py, but recording a per-game prediction row every fold
    instead of only aggregate metrics."""
    build = _reg_builders()["lin_reg"]
    game_rows = []
    game_feature_rows = []
    residual_pool_all = []
    importance_by_season = []
    diag_rows = []

    for test_season in EXPORT_TEST_SEASONS:
        train_mask = games["season"] < test_season
        test_mask = games["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue

        X_train, y_train = games.loc[train_mask, FEATURE_COLS], games.loc[train_mask, "home_margin"]
        test = games.loc[test_mask]
        X_test = test[FEATURE_COLS]

        oof_pred = cross_val_predict(build(), X_train, y_train, cv=KFold(5, shuffle=True, random_state=42))
        residuals = y_train.to_numpy() - oof_pred
        sigma = residuals.std(ddof=1)
        residual_pool_all.append(residuals)
        diag_rows.append({
            "test_season": test_season, "sigma": sigma,
            "residual_skew": float(pd.Series(residuals).skew()),
            "residual_kurtosis": float(pd.Series(residuals).kurt()),
            "n_train": int(train_mask.sum()),
        })

        model = build()
        model.fit(X_train, y_train)
        predicted_margin = model.predict(X_test)
        spread_test = test["spread_line"].fillna(0).to_numpy()

        p_win_cdf, p_cov_cdf = _normal_cdf(predicted_margin, sigma, spread_test)

        # Per-game linear decomposition: lin_reg is impute -> scale -> linear,
        # so predicted_margin == intercept + sum(coef_i * scaled_feature_i).
        # Reconstructing that sum per game gives an exact, additive "how do
        # these stats convert to this prediction" breakdown -- unlike
        # permutation importance (which is a global, not per-game, measure).
        imputed = model.named_steps["impute"].transform(X_test)
        scaled = model.named_steps["scale"].transform(imputed)
        coef = model.named_steps["reg"].coef_
        intercept = float(model.named_steps["reg"].intercept_)
        contributions = scaled * coef  # (n_games, n_features)

        for i, (_, row) in enumerate(test.iterrows()):
            game_rows.append({
                "season": int(row["season"]),
                "week": int(row["week"]),
                "home_team": row["home_team"],
                "away_team": row["away_team"],
                "home_score": None if pd.isna(row["home_score"]) else int(row["home_score"]),
                "away_score": None if pd.isna(row["away_score"]) else int(row["away_score"]),
                "predicted_margin": float(predicted_margin[i]),
                "actual_margin": float(row["home_margin"]),
                "home_win_prob": float(p_win_cdf[i]),
                "home_covers_prob": float(p_cov_cdf[i]) if pd.notna(row["spread_line"]) else None,
                "home_win": int(row["home_win"]),
                "home_covers": None if pd.isna(row["home_covers"]) else int(row["home_covers"]),
                "spread_line": None if pd.isna(row["spread_line"]) else float(row["spread_line"]),
                "market_home_fair": None if pd.isna(row["market_home_fair"]) else float(row["market_home_fair"]),
                "elo_p_home": None if pd.isna(row["elo_p_home"]) else float(row["elo_p_home"]),
            })

            feat_row = {
                "season": int(row["season"]), "week": int(row["week"]),
                "home_team": row["home_team"], "away_team": row["away_team"],
                "intercept": intercept,
            }
            for j, col in enumerate(FEATURE_COLS):
                feat_row[col] = None if pd.isna(row[col]) else float(row[col])
                feat_row[f"{col}_contrib"] = float(contributions[i, j])
                # Per-team raw values behind each diff_ feature, so the game
                # inspector table can show actual home/away stats instead of
                # only the (home - away) diff the model actually trains on.
                # Context columns (is_dome/wind/temp/div_game) have no
                # per-team split; rest_diff's is home_rest/away_rest.
                if col.startswith("diff_"):
                    underlying = col[len("diff_"):]
                    home_col, away_col = f"home_{underlying}", f"away_{underlying}"
                elif col == "rest_diff":
                    home_col, away_col = "home_rest", "away_rest"
                else:
                    home_col, away_col = None, None
                if home_col is not None and home_col in row.index and away_col in row.index:
                    feat_row[f"{col}_home"] = None if pd.isna(row[home_col]) else float(row[home_col])
                    feat_row[f"{col}_away"] = None if pd.isna(row[away_col]) else float(row[away_col])
            game_feature_rows.append(feat_row)

        # Permutation importance against the regression target (MAE-based --
        # lin_reg, not a classifier), per test-season fold.
        pi = permutation_importance(
            model, X_test, test["home_margin"], n_repeats=20, random_state=42,
            scoring="neg_mean_absolute_error",
        )
        imp = pd.Series(pi.importances_mean, index=FEATURE_COLS)
        importance_by_season.append(imp)

    games_df = pd.DataFrame(game_rows)
    game_features_df = pd.DataFrame(game_feature_rows)
    diag_df = pd.DataFrame(diag_rows)
    residual_pool = np.concatenate(residual_pool_all) if residual_pool_all else np.array([])
    importance_df = pd.concat(importance_by_season, axis=1).mean(axis=1).sort_values(ascending=False) \
        if importance_by_season else pd.Series(dtype=float)

    return games_df, game_features_df, diag_df, residual_pool, importance_df


def build_season_summary(games_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for season, grp in games_df.groupby("season"):
        rows.append(_summary_row(season, grp))
    rows.append(_summary_row("pooled", games_df))
    return pd.DataFrame(rows)


def _summary_row(season, grp: pd.DataFrame) -> dict:
    model_acc = (grp["predicted_margin"] > 0).astype(int).eq(grp["home_win"]).mean()
    market_acc = (grp["market_home_fair"] >= 0.5).astype(int).eq(grp["home_win"]).mean() \
        if grp["market_home_fair"].notna().any() else None
    elo_acc = (grp["elo_p_home"] >= 0.5).astype(int).eq(grp["home_win"]).mean() \
        if grp["elo_p_home"].notna().any() else None

    ats = grp.dropna(subset=["home_covers", "home_covers_prob"])
    model_ats_acc = (ats["home_covers_prob"] >= 0.5).astype(int).eq(ats["home_covers"]).mean() \
        if not ats.empty else None

    return {
        "season": season,
        "n": len(grp),
        "model_accuracy": float(model_acc),
        "market_accuracy": float(market_acc) if market_acc is not None else None,
        "elo_accuracy": float(elo_acc) if elo_acc is not None else None,
        "model_ats_accuracy": float(model_ats_acc) if model_ats_acc is not None else None,
        "ats_n": len(ats),
    }


def build_calibration(games_df: pd.DataFrame) -> dict:
    table = evaluate.calibration_table(
        games_df["home_win"].to_numpy(), games_df["home_win_prob"].to_numpy(), n_bins=10,
    )
    r = evaluate.calibration_correlation(table)
    return {"table": table, "correlation": r}


def main():
    print(f"Building game table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {FIRST_SEASON}-{current_season()}...")
    games = features.build_game_table(range(FIRST_SEASON, current_season() + 1))
    games = games.dropna(subset=["home_margin"])
    print(f"{len(games)} completed REG games. Test seasons: {EXPORT_TEST_SEASONS[0]}-{EXPORT_TEST_SEASONS[-1]}\n")

    games_df, game_features_df, diag_df, residual_pool, importance = run(games)
    print(f"Exported {len(games_df)} walk-forward predictions across "
          f"{games_df['season'].nunique()} seasons.")

    season_summary = build_season_summary(games_df)
    print("\nSeason summary:")
    print(season_summary.to_string(index=False))

    calib = build_calibration(games_df)
    print(f"\nCalibration r: {calib['correlation']}")

    importance_df = importance.rename("importance").reset_index().rename(columns={"index": "feature"})

    _write_json("games.json", _compact(games_df))
    _write_json("game_features.json", _compact(game_features_df))
    _write_json("season_summary.json", _compact(season_summary))
    _write_json("importance.json", _compact(importance_df))
    _write_json("calibration.json", {
        "table": _compact(calib["table"]),
        "correlation": _clean(calib["correlation"]),
        "residual_pool": [round(float(x), 2) for x in residual_pool],
        "residual_diagnostics": _compact(diag_df),
    })
    _write_json("meta.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "test_seasons": EXPORT_TEST_SEASONS,
        "n_features": len(FEATURE_COLS),
        "feature_cols": FEATURE_COLS,
        "model": "margin_regression_lin_reg",
    })
    print(f"\nSaved to {APP_DATA_DIR}")


if __name__ == "__main__":
    main()
