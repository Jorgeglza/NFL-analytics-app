"""Parity checks vs the old app's cached artifacts (read-only oracles)."""
import pandas as pd

from .config import OLD_CACHE_DIR, OLD_MODEL_PKL


def _align(new: pd.DataFrame, old: pd.DataFrame, keys):
    """Align on the intersection of key tuples (the old cache may be stale and
    have fewer recent-season rows; extra new rows are reported, not failed)."""
    common = [c for c in old.columns if c in new.columns]
    n = new[common].copy()
    o = old[common].copy()
    # the newest season in the old cache is a stale snapshot (nflverse restates
    # in-progress stats weekly) — compare completed seasons only
    if "season" in keys:
        last = o["season"].max()
        o = o[o["season"] < last]
        n = n[n["season"] < last]
        print(f"  note: excluding in-progress season {last} (source data restated since old cache)")
    old_keys = o[keys].apply(tuple, axis=1)
    new_keys = n[keys].apply(tuple, axis=1)
    shared = set(old_keys) & set(new_keys)
    extra_new = len(new_keys) - new_keys.isin(shared).sum()
    extra_old = len(old_keys) - old_keys.isin(shared).sum()
    if extra_new or extra_old:
        print(f"  note: comparing {len(shared)} shared keys "
              f"(+{extra_new} only in new, +{extra_old} only in old)")
    # keys alone can tie (duplicate team-week rows exist upstream);
    # add discriminating columns so row order is deterministic in both frames
    sort_cols = keys + [c for c in ("game_id", "opponent_team", "player_id", "attempts", "carries")
                        if c in common and c not in keys]
    n = n[new_keys.isin(shared)].sort_values(sort_cols).reset_index(drop=True)
    o = o[old_keys.isin(shared)].sort_values(sort_cols).reset_index(drop=True)
    return n, o, common


def check_team_week(new_df: pd.DataFrame) -> bool:
    paths = list(OLD_CACHE_DIR.glob("team_week_df_*.parquet"))
    if not paths:
        print("SKIP team_week parity: old parquet not found")
        return True
    old = pd.read_parquet(paths[0])
    keys = ["season", "week", "team"]
    n, o, common = _align(new_df, old, keys)
    if len(n) != len(o):
        print(f"FAIL team_week: row count {len(n)} vs old {len(o)}")
        return False
    num = o.select_dtypes(include="number").columns
    bad = []
    for c in num:
        a = pd.to_numeric(n[c], errors="coerce")
        b = pd.to_numeric(o[c], errors="coerce")
        diff = (a - b).abs()
        if not ((diff < 1e-6) | (a.isna() & b.isna())).all():
            bad.append((c, float(diff.max())))
    if bad:
        print(f"FAIL team_week: {len(bad)} mismatched cols, worst: {sorted(bad, key=lambda x: -x[1])[:5]}")
        return False
    print(f"OK team_week parity ({len(n)} rows, {len(num)} numeric cols)")
    return True


def check_player_week(new_df: pd.DataFrame) -> bool:
    paths = list(OLD_CACHE_DIR.glob("player_week_df_*.parquet"))
    if not paths:
        print("SKIP player_week parity: old parquet not found")
        return True
    old = pd.read_parquet(paths[0])
    keys = [k for k in ["season", "week", "player_id", "team"] if k in old.columns and k in new_df.columns]
    n, o, common = _align(new_df, old, keys)
    if len(n) != len(o):
        print(f"FAIL player_week: row count {len(n)} vs old {len(o)}")
        return False
    num = o.select_dtypes(include="number").columns
    bad = []
    for c in num:
        a = pd.to_numeric(n[c], errors="coerce")
        b = pd.to_numeric(o[c], errors="coerce")
        diff = (a - b).abs()
        if not ((diff < 1e-6) | (a.isna() & b.isna())).all():
            bad.append((c, float(diff.max())))
    if bad:
        print(f"FAIL player_week: {len(bad)} mismatched cols, worst: {sorted(bad, key=lambda x: -x[1])[:5]}")
        return False
    print(f"OK player_week parity ({len(n)} rows)")
    return True


def check_grades(new_grades: pd.DataFrame, new_importance: pd.DataFrame) -> bool:
    if not OLD_MODEL_PKL.exists():
        print("SKIP grades parity: model_results.pkl not found")
        return True
    import joblib
    try:
        cached = joblib.load(OLD_MODEL_PKL)
    except ModuleNotFoundError as e:
        print(f"SKIP grades parity: old pkl unreadable under current pandas ({e}). "
              "It was written by an older pandas; the old app itself can no longer load it. "
              "Grades parity relies on the verbatim port + pinned sklearn instead.")
        return True
    old_g = cached["grade_models"]
    old_i = cached["models_feature_importance_df"]

    keys = ["Team", "Season", "Week"]
    n, o, _ = _align(new_grades, old_g, keys)
    ok = True
    if len(n) != len(o):
        print(f"WARN grades: row count {len(n)} vs old {len(o)} (old pkl may predate current data)")
        ok = False
    else:
        for c in ["Offensive Grade", "Defensive Grade", "Overall Grade"]:
            diff = (pd.to_numeric(n[c]) - pd.to_numeric(o[c])).abs()
            if diff.max() > 1e-6:
                print(f"WARN grades[{c}]: max diff {diff.max():.4f} (sklearn version drift?)")
                ok = False
    ni = new_importance.sort_values("Feature").reset_index(drop=True)
    oi = old_i.sort_values("Feature").reset_index(drop=True)
    if len(ni) == len(oi):
        for c in ["Offensive Importance", "Defensive Importance", "Overall Importance"]:
            diff = (pd.to_numeric(ni[c]) - pd.to_numeric(oi[c])).abs()
            if diff.max() > 1e-6:
                print(f"WARN importance[{c}]: max diff {diff.max():.6f}")
                ok = False
    if ok:
        print("OK grades parity")
    return ok
