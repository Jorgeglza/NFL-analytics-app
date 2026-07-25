"""Entry point for the predictive-model research spike.

    python pipeline/predictive_model/run_spike.py

Fetches the new nflverse data (cached separately under data/raw_cache_predictive/,
never touching data/raw_cache/), builds leakage-safe features, trains
walk-forward models, and prints/saves a metrics report — this pass produces
no UI and touches no existing pipeline output (see docs/predictive-model.md).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from predictive_model import evaluate, features, train
from predictive_model.config import OUTPUT_DIR, SEASONS, TEST_SEASONS


def main():
    print(f"Building game table for seasons {SEASONS[0]}-{SEASONS[-1]} (test seasons: {TEST_SEASONS})...")
    games = features.build_game_table(SEASONS)
    print(f"{len(games)} completed REG games with features.\n")

    all_folds = []
    for target in ["home_win", "home_covers"]:
        folds = train.walk_forward(games, features.DIFF_FEATURE_COLS, target, TEST_SEASONS)
        all_folds.extend(folds)

    model_summary = evaluate.summarize_folds(all_folds)
    market_summary = evaluate.market_baseline(games, TEST_SEASONS)
    ats_baselines = evaluate.ats_trivial_baselines(games, TEST_SEASONS)
    report = evaluate.print_report(model_summary, market_summary, ats_baselines)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DIR / "metrics.json", "w", encoding="utf-8") as fh:
        json.dump({
            "model_summary": model_summary.to_dict(orient="records"),
            "market_summary": market_summary.to_dict(orient="records"),
            "ats_baselines": ats_baselines.to_dict(orient="records"),
        }, fh, indent=2)
    with open(OUTPUT_DIR / "report.txt", "w", encoding="utf-8") as fh:
        fh.write(report)
    print(f"\nSaved metrics to {OUTPUT_DIR / 'metrics.json'} and {OUTPUT_DIR / 'report.txt'}")


if __name__ == "__main__":
    main()
