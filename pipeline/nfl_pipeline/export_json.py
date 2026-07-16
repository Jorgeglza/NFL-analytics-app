"""JSON extract writer — the static files the SPA loads.

Format: compact column-oriented {"cols": [...], "rows": [[...], ...]} to keep
files small and diffs stable (keys not repeated per row).
"""
import gzip
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .config import EXTRACTS_DIR, SEASONS

# player_week columns the pages actually use (identifiers + schedule + stats).
PLAYER_ID_COLS = [
    "player_id", "player_display_name", "player_name", "position", "position_group",
    "headshot_url", "team", "season", "week", "season_type", "opponent_team",
    "game_id", "gameday", "game_type",
]


def _clean(v):
    if v is None or v is pd.NaT or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, float):
        if np.isnan(v) or np.isinf(v):
            return None
        return round(v, 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return _clean(float(v))
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def df_to_compact(df: pd.DataFrame) -> dict:
    return {
        "cols": list(df.columns),
        "rows": [[_clean(v) for v in row] for row in df.itertuples(index=False, name=None)],
    }


def write_json(name: str, obj) -> None:
    path = EXTRACTS_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text, encoding="utf-8")
    gz_kb = len(gzip.compress(text.encode())) // 1024
    print(f"wrote {name}  ({len(text)//1024} KB raw, {gz_kb} KB gz)")


def export_all(schedule_df, team_week_df, ranks_df, player_week_df, team_desc_df,
               grade_models, feature_importance_df, contrib_params) -> None:
    now = datetime.now(timezone.utc).isoformat()

    played = schedule_df.dropna(subset=["home_score"])
    current_season = int(played["season"].max()) if not played.empty else SEASONS[-1]

    write_json("meta.json", {
        "generated_at": now,
        "seasons": SEASONS,
        "current_season": current_season,
        "counts": {
            "schedule": len(schedule_df),
            "team_week": len(team_week_df),
            "player_week": len(player_week_df),
            "grades": len(grade_models),
        },
    })

    write_json("teams.json", df_to_compact(team_desc_df))
    write_json("schedule.json", df_to_compact(schedule_df))
    write_json("grades.json", df_to_compact(grade_models))
    write_json("feature_importance.json", df_to_compact(feature_importance_df))
    write_json("contrib_params.json", contrib_params)

    for season in sorted(team_week_df["season"].dropna().unique()):
        season = int(season)
        write_json(f"team_week/{season}.json",
                   df_to_compact(team_week_df[team_week_df["season"] == season]))
        write_json(f"team_week_ranks/{season}.json",
                   df_to_compact(ranks_df[ranks_df["season"] == season]))

        pw = player_week_df[player_week_df["season"] == season]
        stat_cols = [c for c in pw.select_dtypes(include="number").columns
                     if c not in ("season", "week")]
        keep = [c for c in PLAYER_ID_COLS if c in pw.columns] + stat_cols
        pw = pw[keep]
        # drop all-null stat columns for this season to save space
        pw = pw.dropna(axis=1, how="all")
        write_json(f"player_week/{season}.json", df_to_compact(pw))
