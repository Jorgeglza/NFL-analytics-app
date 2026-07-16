"""NFL data pipeline orchestrator.

Usage:
    python pipeline/run_pipeline.py --stage all
    python pipeline/run_pipeline.py --stage fetch|transform|model|export|parity|validate
    python pipeline/run_pipeline.py --stage fetch --refresh   # re-download raw data

Stages:
    fetch     download raw nflverse data into data/raw_cache/ (parquet)
    transform build team_week / player_week / ranks / schedule frames
    model     run the 3 Random Forest grading models + contribution params
    export    write data/nfl.sqlite and app/public/data/*.json
    parity    compare outputs against the old Dash app's caches (local only)
    validate  invariant checks for CI (fails non-zero on problems)
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nfl_pipeline import config  # noqa: E402


def build_frames():
    from nfl_pipeline.transform import (
        get_cumulative_team_week_ranks,
        get_player_week_data,
        get_team_week_stats,
        load_schedule_df,
    )
    schedule_df = load_schedule_df()
    team_week_df = get_team_week_stats()
    ranks_df = get_cumulative_team_week_ranks(team_week_df)
    player_week_df = get_player_week_data(include_schedule=True)
    return schedule_df, team_week_df, ranks_df, player_week_df


def run_model(team_week_df):
    from nfl_pipeline.contributions import contribution_params
    from nfl_pipeline.grading import compute_all_model_results
    # Old app grades on REG games only (grading_model_page_1.py filters game_type == 'REG')
    reg = team_week_df[team_week_df["game_type"] == "REG"].copy()
    grade_models, feature_importance_df = compute_all_model_results(reg)
    contrib = contribution_params(reg, feature_importance_df)
    return grade_models, feature_importance_df, contrib


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    choices=["all", "fetch", "transform", "model", "export", "parity", "validate"])
    ap.add_argument("--refresh", action="store_true", help="re-download raw data")
    args = ap.parse_args()

    if args.stage == "fetch" or (args.stage in ("all",) and True):
        from nfl_pipeline.fetch import fetch_schedules, fetch_team_desc, fetch_weekly
        fetch_weekly(refresh=args.refresh)
        fetch_schedules(refresh=args.refresh)
        fetch_team_desc(refresh=args.refresh)
        print("fetch done")
        if args.stage == "fetch":
            return

    if args.stage in ("transform",):
        schedule_df, team_week_df, ranks_df, player_week_df = build_frames()
        print(f"transform done: schedule={len(schedule_df)} team_week={len(team_week_df)} "
              f"ranks={len(ranks_df)} player_week={len(player_week_df)}")
        return

    if args.stage in ("all", "model", "export"):
        schedule_df, team_week_df, ranks_df, player_week_df = build_frames()
        grade_models, feature_importance_df, contrib = run_model(team_week_df)
        print(f"model done: grades={len(grade_models)}")

        if args.stage == "model":
            return

        from nfl_pipeline.db import write_sqlite
        from nfl_pipeline.export_json import export_all
        from nfl_pipeline.fetch import fetch_team_desc

        team_desc_df = fetch_team_desc()
        keep_meta = ["team_abbr", "team_name", "team_conf", "team_division",
                     "team_color", "team_color2", "team_logo_espn", "team_logo_wikipedia"]
        team_desc_df = team_desc_df[[c for c in keep_meta if c in team_desc_df.columns]]

        import importlib.metadata as im
        versions = {p: im.version(p) for p in ("pandas", "numpy", "scikit-learn")}

        write_sqlite(
            {
                "schedule": schedule_df,
                "team_week": team_week_df,
                "team_week_ranks": ranks_df,
                "player_week": player_week_df,
                "grades": grade_models,
                "feature_importance": feature_importance_df,
                "team_meta": team_desc_df,
            },
            meta={"seasons": config.SEASONS, "library_versions": versions},
        )
        export_all(schedule_df, team_week_df, ranks_df, player_week_df, team_desc_df,
                   grade_models, feature_importance_df, contrib)
        print("export done")
        return

    if args.stage == "parity":
        from nfl_pipeline.parity import check_grades, check_player_week, check_team_week
        schedule_df, team_week_df, ranks_df, player_week_df = build_frames()
        grade_models, feature_importance_df, _ = run_model(team_week_df)
        ok = all([
            check_team_week(team_week_df),
            check_player_week(player_week_df),
            check_grades(grade_models, feature_importance_df),
        ])
        sys.exit(0 if ok else 1)

    if args.stage == "validate":
        import json
        problems = []
        meta_path = config.EXTRACTS_DIR / "meta.json"
        if not meta_path.exists():
            problems.append("meta.json missing")
        else:
            meta = json.loads(meta_path.read_text())
            for k, v in meta.get("counts", {}).items():
                if v <= 0:
                    problems.append(f"count {k} is {v}")
        grades_path = config.EXTRACTS_DIR / "grades.json"
        if grades_path.exists():
            g = json.loads(grades_path.read_text())
            cols = g["cols"]
            for gc in ["Offensive Grade", "Defensive Grade", "Overall Grade"]:
                i = cols.index(gc)
                vals = [r[i] for r in g["rows"] if r[i] is not None]
                if vals and (min(vals) < 0 or max(vals) > 100):
                    problems.append(f"{gc} outside [0,100]")
        if not config.SQLITE_PATH.exists():
            problems.append("nfl.sqlite missing")
        if problems:
            print("VALIDATE FAILED:\n- " + "\n- ".join(problems))
            sys.exit(1)
        print("validate OK")


if __name__ == "__main__":
    main()
