"""Streitmatter (2023)-style approach: instead of training two disconnected
classifiers (home_win, home_covers), fit ONE regression on point margin
(home_score - away_score), estimate the residual (uncertainty) distribution
from out-of-fold training predictions, and derive both win probability and
ATS-cover probability from that single fitted distribution — Monte Carlo
simulating each game's outcome the way Streitmatter's article describes
(10,000 draws per game), plus a closed-form normal-CDF version as a
faster/exact cross-check when residuals are roughly normal.

Same walk-forward gate as every other round this session (train strictly
before each test season) and the same Round 4 feature set (spread_line/
moneylines still excluded from the regression's own inputs — only used to
define the home_covers evaluation target and to compute the cover-probability
threshold, exactly as before).

    python pipeline/predictive_model/margin_regression.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore", category=UserWarning)

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from predictive_model import evaluate, features
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS

FEATURE_COLS = features.ROUND4_DIFF_FEATURE_COLS
N_SIMS = 10_000


def _reg_builders():
    return {
        "hgb_reg": lambda: HistGradientBoostingRegressor(random_state=42, max_depth=4, learning_rate=0.05),
        "lin_reg": lambda: Pipeline([("impute", SimpleImputer(strategy="mean")), ("scale", StandardScaler()), ("reg", LinearRegression())]),
    }


def _simulate(predicted_margin: np.ndarray, residual_pool: np.ndarray, spread_line: np.ndarray, seed: int = 42):
    """Monte Carlo: resample residuals (with replacement) from the actual
    out-of-fold training residual distribution — captures skew/fat tails
    rather than assuming normality, closer to Streitmatter's literal method
    than the normal-CDF shortcut."""
    rng = np.random.default_rng(seed)
    sims = rng.choice(residual_pool, size=(len(predicted_margin), N_SIMS), replace=True)
    simulated_margin = predicted_margin[:, None] + sims
    p_home_win = (simulated_margin > 0).mean(axis=1)
    p_home_covers = (simulated_margin + spread_line[:, None] > 0).mean(axis=1)
    return p_home_win, p_home_covers


def _normal_cdf(predicted_margin: np.ndarray, sigma: float, spread_line: np.ndarray):
    """Closed-form cross-check assuming residuals ~ Normal(0, sigma) — the
    Ruscio & Brady / PFR-style shortcut, exact instead of simulated."""
    p_home_win = norm.cdf(predicted_margin / sigma)
    p_home_covers = norm.cdf((predicted_margin + spread_line) / sigma)
    return p_home_win, p_home_covers


def run(games: pd.DataFrame):
    df = games.dropna(subset=["home_margin"]).copy()
    rows = []
    pooled = {}  # (model, method) -> {"home_win": (y,p), "home_covers": (y,p)}
    residual_diagnostics = []

    for test_season in TEST_SEASONS:
        train_mask = df["season"] < test_season
        test_mask = df["season"] == test_season
        if train_mask.sum() < 100 or test_mask.sum() == 0:
            continue
        X_train, y_train = df.loc[train_mask, FEATURE_COLS], df.loc[train_mask, "home_margin"]
        X_test = df.loc[test_mask, FEATURE_COLS]
        y_test_win = df.loc[test_mask, "home_win"].to_numpy()
        spread_test = df.loc[test_mask, "spread_line"].to_numpy()
        covers_mask = df.loc[test_mask, "home_covers"].notna().to_numpy()
        y_test_covers = df.loc[test_mask, "home_covers"].to_numpy()

        for model_name, build in _reg_builders().items():
            # out-of-fold residuals on TRAIN only, to estimate uncertainty
            # without peeking at the test season
            oof_pred = cross_val_predict(build(), X_train, y_train, cv=KFold(5, shuffle=True, random_state=42))
            residuals = (y_train.to_numpy() - oof_pred)
            sigma = residuals.std(ddof=1)
            residual_diagnostics.append({
                "test_season": test_season, "model": model_name, "sigma": sigma,
                "residual_skew": pd.Series(residuals).skew(), "residual_kurtosis": pd.Series(residuals).kurt(),
            })

            model = build()
            model.fit(X_train, y_train)
            predicted_margin = model.predict(X_test)

            p_win_sim, p_cov_sim = _simulate(predicted_margin, residuals, spread_test)
            p_win_cdf, p_cov_cdf = _normal_cdf(predicted_margin, sigma, spread_test)

            for method, (p_win, p_cov) in [("simulate", (p_win_sim, p_cov_sim)), ("normal_cdf", (p_win_cdf, p_cov_cdf))]:
                m_win = evaluate._metrics(y_test_win, p_win)
                rows.append({"test_season": test_season, "target": "home_win", "model": model_name, "method": method, **m_win})
                if covers_mask.any():
                    m_cov = evaluate._metrics(y_test_covers[covers_mask].astype(int), p_cov[covers_mask])
                    rows.append({"test_season": test_season, "target": "home_covers", "model": model_name, "method": method, **m_cov})

                key = (model_name, method)
                pooled.setdefault(key, {"home_win": [[], []], "home_covers": [[], []]})
                pooled[key]["home_win"][0].append(y_test_win)
                pooled[key]["home_win"][1].append(p_win)
                if covers_mask.any():
                    pooled[key]["home_covers"][0].append(y_test_covers[covers_mask].astype(int))
                    pooled[key]["home_covers"][1].append(p_cov[covers_mask])

    return pd.DataFrame(rows), pooled, pd.DataFrame(residual_diagnostics)


def main():
    print(f"Building game table (round-4 feature set, {len(FEATURE_COLS)} columns) "
          f"for seasons {SEASONS[0]}-{SEASONS[-1]}...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games.\n")

    metrics, pooled, diag = run(games)

    print("=" * 100)
    print("MARGIN REGRESSION (Streitmatter-style) — one fitted distribution -> both win-prob and ATS-prob")
    print("=" * 100)
    print("\nResidual diagnostics (out-of-fold, train only):")
    print(diag.to_string(index=False))

    for target in ["home_win", "home_covers"]:
        print(f"\n--- target: {target} ---")
        sub = metrics[metrics["target"] == target]
        for season, grp in sub.groupby("test_season"):
            print(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                print(f"    {r['model']:<8} {r['method']:<10} n={int(r['n']):<4} acc={r['accuracy']:.4f} "
                      f"brier={r['brier']:.4f} logloss={r['log_loss']:.4f}")

        print(f"\n  Pooled (both test seasons):")
        for (model_name, method), targets in pooled.items():
            y_true = np.concatenate(targets[target][0])
            p = np.concatenate(targets[target][1])
            acc = ((p >= 0.5).astype(int) == y_true).mean()
            table = evaluate.calibration_table(y_true, p, n_bins=8)
            r = evaluate.calibration_correlation(table)
            r_str = f"{r:.4f}" if r is not None else "n/a"
            print(f"    {model_name:<8} {method:<10} pooled_acc={acc:.4f} n={len(y_true):<4} calibration_r={r_str}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    metrics.to_csv(OUTPUT_DIR / "margin_regression.csv", index=False)
    diag.to_csv(OUTPUT_DIR / "margin_regression_residuals.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'margin_regression.csv'}")


if __name__ == "__main__":
    main()
