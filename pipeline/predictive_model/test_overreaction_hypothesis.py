"""Does Vergin (2001)'s market-overreaction claim actually show up in our own
data? Rather than just adding a feature and hoping, this directly tests the
hypothesis: bucket games by how "surprising" each team's most recent result
was (diff_surprise_points_margin = home's surprise minus away's surprise,
already computed leakage-safe in features.py), and check whether the
market's own pregame probability (market_home_fair) is systematically biased
in the direction the overreaction theory predicts — overrating a team coming
off an unusually good week, underrating one coming off an unusually bad week.

Uses the FULL 2015-2025 history (not just the 2 held-out test seasons) for
statistical power, the same way home_underdog_backtest.py did — this is a
market-bias audit, not a walk-forward-validated model.

    python pipeline/predictive_model/test_overreaction_hypothesis.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd

from predictive_model import features
from predictive_model.config import OUTPUT_DIR, SEASONS


def bucket_report(df: pd.DataFrame, surprise_col: str, n_buckets: int = 5) -> pd.DataFrame:
    sub = df.dropna(subset=[surprise_col, "market_home_fair", "home_win"]).copy()
    sub["bucket"] = pd.qcut(sub[surprise_col], n_buckets, duplicates="drop")
    rows = []
    for bucket, grp in sub.groupby("bucket", observed=True):
        n = len(grp)
        predicted = grp["market_home_fair"].mean()
        observed = grp["home_win"].mean()
        rows.append({
            "bucket": str(bucket), "n": n,
            "surprise_range_mean": grp[surprise_col].mean(),
            "market_predicted_home_win": predicted,
            "actual_home_win_rate": observed,
            "market_bias (predicted-actual)": predicted - observed,
        })
    return pd.DataFrame(rows)


def main():
    print(f"Building game table for seasons {SEASONS[0]}-{SEASONS[-1]} (full history, market-bias audit)...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} games.\n")

    print("=" * 96)
    print("MARKET OVERREACTION HYPOTHESIS TEST (Vergin, 2001)")
    print("If the market overreacts to a team's most recent surprising result, the bucket where")
    print("the home team was MOST positively surprised last week should show market_bias > 0")
    print("(market overrates them this week), and the most-negative-surprise bucket should show")
    print("market_bias < 0 (market underrates them) -- i.e. bias should trend with the bucket.")
    print("=" * 96)

    for col, label in [("diff_surprise_points_margin", "point-margin surprise"), ("diff_surprise_epa_diff", "EPA surprise")]:
        print(f"\n--- bucketed by {label} (home - away), quintiles ---")
        report = bucket_report(games, col)
        print(report.to_string(index=False))
        # correlation between the raw surprise value and the market's bias, pooled (no bucketing)
        sub = games.dropna(subset=[col, "market_home_fair", "home_win"])
        bias = sub["market_home_fair"] - sub["home_win"]
        corr = np.corrcoef(sub[col], bias)[0, 1]
        print(f"  Pearson correlation (surprise vs. market bias), n={len(sub)}: r={corr:.4f}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    bucket_report(games, "diff_surprise_points_margin").to_csv(OUTPUT_DIR / "overreaction_hypothesis.csv", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'overreaction_hypothesis.csv'}")


if __name__ == "__main__":
    main()
