"""Evaluation harness: accuracy/Brier/log-loss for straight-up winner
predictions, plus ATS accuracy for spread-cover predictions — the metric that
actually measures "edge" (beating the closing line), which nothing in the
existing app computes today (only straight-up accuracy + Brier — see
docs/predictive-model.md).
"""
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss

from .train import FoldResult

BREAKEVEN_ATS = 110 / (110 + 100)  # ~52.38% at standard -110 vig


def _metrics(y_true: np.ndarray, y_pred_proba: np.ndarray) -> dict:
    y_pred = (y_pred_proba >= 0.5).astype(int)
    return {
        "n": len(y_true),
        "accuracy": accuracy_score(y_true, y_pred),
        "brier": brier_score_loss(y_true, y_pred_proba),
        "log_loss": log_loss(y_true, y_pred_proba, labels=[0, 1]),
    }


def summarize_folds(folds: list[FoldResult]) -> pd.DataFrame:
    rows = []
    for f in folds:
        m = _metrics(f.y_true, f.y_pred_proba)
        rows.append({"test_season": f.test_season, "model": f.model_name, "target": f.target, **m})
    return pd.DataFrame(rows)


def market_baseline(games: pd.DataFrame, test_seasons: list[int]) -> pd.DataFrame:
    """The market's own vig-free moneyline (straight-up) and Elo, evaluated
    the same way as the trained model, for the same held-out seasons."""
    rows = []
    for season in test_seasons:
        sub = games[games["season"] == season]
        for col, name in [("market_home_fair", "market_moneyline"), ("elo_p_home", "elo")]:
            s = sub.dropna(subset=[col, "home_win"])
            if s.empty:
                continue
            m = _metrics(s["home_win"].to_numpy(), s[col].to_numpy())
            rows.append({"test_season": season, "model": name, "target": "home_win", **m})
    return pd.DataFrame(rows)


def ats_trivial_baselines(games: pd.DataFrame, test_seasons: list[int]) -> pd.DataFrame:
    """Context baselines for the ATS target: always pick home, always pick
    the favorite. Neither is a real prediction — the market sets the spread
    so both sides cover ~50% of the time by design — but they show what
    "no edge" looks like next to the trained model's ATS accuracy."""
    rows = []
    for season in test_seasons:
        sub = games[(games["season"] == season) & games["home_covers"].notna()]
        if sub.empty:
            continue
        n = len(sub)
        rows.append({"test_season": season, "model": "always_home", "target": "home_covers",
                     "n": n, "accuracy": (sub["home_covers"] == 1).mean(), "brier": np.nan, "log_loss": np.nan})
        fav_home = sub["spread_line"] < 0
        favorite_covers = np.where(fav_home, sub["home_covers"] == 1, sub["home_covers"] == 0)
        rows.append({"test_season": season, "model": "always_favorite", "target": "home_covers",
                     "n": n, "accuracy": favorite_covers.mean(), "brier": np.nan, "log_loss": np.nan})
    return pd.DataFrame(rows)


def calibration_table(y_true: np.ndarray, y_pred_proba: np.ndarray, n_bins: int = 10) -> pd.DataFrame:
    """Reliability diagram data (Ruscio & Brady, 2021): bin predicted
    probabilities, and within each bin compare the mean predicted probability
    to the observed win rate. A well-calibrated model's points fall on the
    y=x diagonal — e.g. among all predictions of ~75%, the team should
    actually win ~75% of the time. More rigorous than accuracy/Brier alone
    because it shows *where* in the probability range a model is over- or
    under-confident, not just an aggregate score."""
    edges = np.linspace(0, 1, n_bins + 1)
    bin_idx = np.clip(np.digitize(y_pred_proba, edges[1:-1], right=True), 0, n_bins - 1)
    rows = []
    for b in range(n_bins):
        mask = bin_idx == b
        n = int(mask.sum())
        if n == 0:
            continue
        rows.append({
            "bin_lo": edges[b], "bin_hi": edges[b + 1], "n": n,
            "mean_predicted": float(y_pred_proba[mask].mean()),
            "observed_rate": float(y_true[mask].mean()),
        })
    return pd.DataFrame(rows)


def calibration_correlation(table: pd.DataFrame) -> float | None:
    """Pearson r between mean predicted and observed rate across bins —
    Ruscio & Brady report r > .99 as their calibration bar for a "well
    calibrated" model. Needs >=2 bins with data to be defined."""
    if len(table) < 2:
        return None
    return float(np.corrcoef(table["mean_predicted"], table["observed_rate"])[0, 1])


def print_report(model_summary: pd.DataFrame, market_summary: pd.DataFrame, ats_baselines: pd.DataFrame) -> str:
    lines = []
    lines.append("=" * 78)
    lines.append("PREDICTIVE MODEL SPIKE - walk-forward evaluation")
    lines.append("=" * 78)
    lines.append("")
    lines.append(f"ATS breakeven at standard -110 vig: {BREAKEVEN_ATS:.4%}")
    lines.append("")
    for target in ["home_win", "home_covers"]:
        lines.append(f"--- target: {target} ---")
        combined = pd.concat([
            model_summary[model_summary["target"] == target],
            market_summary[market_summary["target"] == target] if target == "home_win" else pd.DataFrame(),
            ats_baselines[ats_baselines["target"] == target] if target == "home_covers" else pd.DataFrame(),
        ], ignore_index=True)
        if combined.empty:
            lines.append("  (no data)")
            continue
        for season, grp in combined.groupby("test_season"):
            lines.append(f"  season {season}:")
            for _, r in grp.sort_values("accuracy", ascending=False).iterrows():
                brier = f"{r['brier']:.4f}" if pd.notna(r["brier"]) else "n/a"
                ll = f"{r['log_loss']:.4f}" if pd.notna(r["log_loss"]) else "n/a"
                lines.append(f"    {r['model']:<18} n={int(r['n']):<4} acc={r['accuracy']:.4f} brier={brier} logloss={ll}")
        lines.append("")
    report = "\n".join(lines)
    print(report)
    return report
