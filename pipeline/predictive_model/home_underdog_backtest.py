"""Szalkowski & Nelson (2012)'s single most concrete, reproducible finding:
home underdogs covered the spread 53.5% of the time (2002-2011), above the
52.38% breakeven — a small, well-documented, if "diminishing over time"
market bias. This is a pure historical strategy backtest (not an ML model):
does the bias still hold on our own 2015-2025 dataset, at a much larger
sample than any single-season slice tried earlier this session
(analyze_slices.py's away-favorite slice was n=224, one season pair only)?

    python pipeline/predictive_model/home_underdog_backtest.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from scipy.stats import norm

from predictive_model import features
from predictive_model.config import OUTPUT_DIR, SEASONS
from predictive_model.evaluate import BREAKEVEN_ATS

Z95 = 1.96


def wilson_ci(wins: int, n: int, z: float = Z95) -> tuple[float, float, float]:
    """Wilson score interval — same formula already used by the app's own
    lib/logic/wilson.ts (docs/logic-reference.md #5), reused here for
    consistency rather than a plain normal-approximation interval."""
    if n == 0:
        return (np.nan, np.nan, np.nan)
    p = wins / n
    center = (p + z ** 2 / (2 * n)) / (1 + z ** 2 / n)
    half = z * np.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2)) / (1 + z ** 2 / n)
    return center, center - half, center + half


def z_test_vs(p_hat: float, n: int, p0: float) -> float:
    se = np.sqrt(p0 * (1 - p0) / n)
    return (p_hat - p0) / se


def main():
    print(f"Building game table for seasons {SEASONS[0]}-{SEASONS[-1]} (full history, no test-season split -- "
          f"this is a historical strategy backtest, not a walk-forward-validated model)...")
    games = features.build_game_table(SEASONS)
    games = games[games["home_covers"].notna()].copy()
    print(f"{len(games)} REG games with a graded spread.\n")

    games["home_underdog"] = games["spread_line"] > 0  # spread_line<0 => home favored (see logic-reference.md #1)

    print("=" * 90)
    print("HOME-UNDERDOG ATS BACKTEST (Szalkowski & Nelson, 2012 methodology)")
    print("=" * 90)

    for label, mask in [("Home underdogs", games["home_underdog"]), ("Home favorites", ~games["home_underdog"])]:
        sub = games[mask]
        n = len(sub)
        wins = int(sub["home_covers"].sum())
        p_hat = wins / n
        center, lo, hi = wilson_ci(wins, n)
        z_vs_breakeven = z_test_vs(p_hat, n, BREAKEVEN_ATS)
        z_vs_half = z_test_vs(p_hat, n, 0.5)
        print(f"\n{label}: n={n}, covers={wins}, cover_rate={p_hat:.4f}")
        print(f"  Wilson 95% CI: [{lo:.4f}, {hi:.4f}]")
        print(f"  z vs. 50.00% (coin flip):    z={z_vs_half:+.3f}  (|z|>1.96 => p<0.05)")
        print(f"  z vs. {BREAKEVEN_ATS:.4%} (ATS breakeven): z={z_vs_breakeven:+.3f}  (|z|>1.96 => p<0.05)")

    print(f"\n--- Year-by-year (home underdogs only) -- Szalkowski found this bias diminishing over time ---")
    yearly = games[games["home_underdog"]].groupby("season").agg(n=("home_covers", "size"), wins=("home_covers", "sum"))
    yearly["cover_rate"] = yearly["wins"] / yearly["n"]
    for season, row in yearly.iterrows():
        center, lo, hi = wilson_ci(int(row["wins"]), int(row["n"]))
        flag = " *** clears breakeven ***" if row["cover_rate"] > BREAKEVEN_ATS else ""
        print(f"  {int(season)}: n={int(row['n']):<3} covers={int(row['wins']):<3} rate={row['cover_rate']:.4f} "
              f"95% CI=[{lo:.4f},{hi:.4f}]{flag}")

    # simple linear trend check on year-by-year cover rate (diminishing-bias hypothesis)
    seasons_arr = yearly.index.to_numpy(dtype=float)
    rates_arr = yearly["cover_rate"].to_numpy()
    slope = np.polyfit(seasons_arr, rates_arr, 1)[0]
    print(f"\n  Linear trend in yearly cover rate: slope={slope:+.5f} per season "
          f"({'declining' if slope < 0 else 'rising'} -- Szalkowski's own data showed a declining trend)")

    print(f"\n--- Reference: Szalkowski & Nelson (2012), 2002-2011 (n=2560 games) ---")
    print(f"  Home underdogs covered 53.5% (vs. our {games[games['home_underdog']]['home_covers'].mean():.4%} on 2015-2025)")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    yearly.to_csv(OUTPUT_DIR / "home_underdog_backtest.csv")
    print(f"\nSaved to {OUTPUT_DIR / 'home_underdog_backtest.csv'}")


if __name__ == "__main__":
    main()
