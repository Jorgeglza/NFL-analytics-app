"""Export step for the *upcoming* week's live predictions (P3).

Fits margin_regression.py's lin_reg pipeline on every completed REG game
through the most recent finished week, then scores the next scheduled-but-
unplayed week (features.build_upcoming_game_table) -- unlike export_page.py,
which only ever backtests already-played games.

Writes app/public/data/predictive_model/upcoming.json, kept separate from
games.json (export_page.py's historical-only output, already consumed by
engine.ts's predictiveIdx) so this export can't disturb that existing schema.

Meant to run on its own weekly cron (see .github/workflows/predictive-refresh.yml),
independent of the main pipeline's weekly-refresh.yml -- reads data/nfl.sqlite
read-only, never writes to it.

    python pipeline/predictive_model/export_upcoming.py
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
from sklearn.model_selection import KFold, cross_val_predict

from predictive_model import features
from predictive_model.config import REPO_ROOT, SEASONS
from predictive_model.margin_regression import FEATURE_COLS, _normal_cdf, _reg_builders

APP_DATA_DIR = REPO_ROOT / "app" / "public" / "data" / "predictive_model"


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


def main():
    target = features.next_unplayed_week(SEASONS)
    if target is None:
        print("No unplayed REG games found in the configured season range -- nothing to score.")
        _write_json("upcoming.json", {"cols": [], "rows": []})
        _write_json("upcoming_meta.json", {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "season": None, "week": None, "n_games": 0,
        })
        return
    season, week = target
    print(f"Upcoming week: season={season} week={week}")

    print(f"Building training table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    train_games = features.build_game_table(SEASONS).dropna(subset=["home_margin"])
    print(f"{len(train_games)} completed REG games available for training.")

    if len(train_games) < 100:
        print("Fewer than 100 completed games -- too early in history to fit; skipping.")
        return

    upcoming = features.build_upcoming_game_table(season, week)
    print(f"{len(upcoming)} scheduled games for season {season} week {week}.")
    if upcoming.empty:
        _write_json("upcoming.json", {"cols": [], "rows": []})
        _write_json("upcoming_meta.json", {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "season": season, "week": week, "n_games": 0,
        })
        return

    build = _reg_builders()["lin_reg"]
    X_train, y_train = train_games[FEATURE_COLS], train_games["home_margin"]
    X_test = upcoming[FEATURE_COLS]

    oof_pred = cross_val_predict(build(), X_train, y_train, cv=KFold(5, shuffle=True, random_state=42))
    residuals = y_train.to_numpy() - oof_pred
    sigma = residuals.std(ddof=1)

    model = build()
    model.fit(X_train, y_train)
    predicted_margin = model.predict(X_test)
    spread = upcoming["spread_line"].fillna(0).to_numpy()

    p_win, p_cov = _normal_cdf(predicted_margin, sigma, spread)

    rows = []
    for i, (_, row) in enumerate(upcoming.iterrows()):
        rows.append({
            "season": int(row["season"]),
            "week": int(row["week"]),
            "home_team": row["home_team"],
            "away_team": row["away_team"],
            "gameday": None if pd.isna(row.get("gameday")) else str(row["gameday"]),
            "predicted_margin": float(predicted_margin[i]),
            "home_win_prob": float(p_win[i]),
            "home_covers_prob": float(p_cov[i]) if pd.notna(row["spread_line"]) else None,
            "spread_line": None if pd.isna(row["spread_line"]) else float(row["spread_line"]),
            "market_home_fair": None if pd.isna(row["market_home_fair"]) else float(row["market_home_fair"]),
            "elo_p_home": None if pd.isna(row["elo_p_home"]) else float(row["elo_p_home"]),
        })

    upcoming_df = pd.DataFrame(rows)
    _write_json("upcoming.json", _compact(upcoming_df))
    _write_json("upcoming_meta.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "season": season, "week": week, "n_games": len(upcoming_df),
        "n_train_games": len(train_games), "sigma": round(float(sigma), 4),
        "model": "margin_regression_lin_reg",
    })
    print(f"\nSaved to {APP_DATA_DIR}")


if __name__ == "__main__":
    main()
