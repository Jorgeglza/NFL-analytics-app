"""Raw data fetch for the predictive-model spike, cached separately from the
main pipeline's data/raw_cache/ (see config.RAW_CACHE_DIR).

Schedule/team_week/grades are NOT re-fetched here — they're read straight out
of the already-built data/nfl.sqlite (read-only) via features.py, since that
data is already correct and there's no reason to duplicate the M1 pipeline's
network calls. This module only pulls the genuinely new sources: play-by-play,
injuries, snap counts.
"""
import pandas as pd

from .config import RAW_CACHE_DIR, SEASONS

PBP_COLS = [
    "game_id", "play_id", "season", "week", "posteam", "defteam",
    "epa", "success", "play_type", "down", "yards_gained",
    "pass", "rush", "penalty",
    # field position / drive-level (starting field position, expected points)
    "yardline_100", "drive", "fixed_drive", "ep", "drive_inside20", "fixed_drive_result",
    # situational (third down, pressure)
    "third_down_converted", "third_down_failed", "qb_hit", "sack",
]

NGS_STAT_TYPES = ["passing", "rushing", "receiving"]


def _cache_path(name: str):
    RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return RAW_CACHE_DIR / f"{name}.parquet"


def fetch_pbp(years=None, refresh=False) -> pd.DataFrame:
    """Play-by-play, trimmed to the columns needed for team-week success/
    explosive-play aggregation, cached per season."""
    import nflreadpy as nr

    years = years or SEASONS
    frames = []
    for year in years:
        path = _cache_path(f"pbp_{year}")
        if path.exists() and not refresh:
            frames.append(pd.read_parquet(path))
            continue
        try:
            df = nr.load_pbp([year]).to_pandas()
        except Exception as e:
            if year == max(years):
                print(f"WARNING: no play-by-play for newest season {year} yet, skipping ({e})")
                continue
            raise
        cols = [c for c in PBP_COLS if c in df.columns]
        df = df[cols].copy()
        df.to_parquet(path, index=False)
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=PBP_COLS)


def fetch_injuries(years=None, refresh=False) -> pd.DataFrame:
    import nflreadpy as nr

    years = years or SEASONS
    path = _cache_path("injuries")
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    df = nr.load_injuries(years).to_pandas()
    df.to_parquet(path, index=False)
    return df


def fetch_snap_counts(years=None, refresh=False) -> pd.DataFrame:
    import nflreadpy as nr

    years = years or SEASONS
    path = _cache_path("snap_counts")
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    df = nr.load_snap_counts(years).to_pandas()
    df.to_parquet(path, index=False)
    return df


def fetch_ngs(stat_type: str, years=None, refresh=False) -> pd.DataFrame:
    """Next Gen Stats (tracking-derived player-week metrics): time to throw,
    completion % above expectation, aggressiveness (passing); rush yards over
    expected, % runs into a stacked box (rushing); separation, cushion, YAC
    above expectation (receiving). Covers 2016 onward. One file per stat_type
    covering all seasons upstream, so cache whole-history per stat_type."""
    import nflreadpy as nr

    years = years or SEASONS
    path = _cache_path(f"ngs_{stat_type}")
    if path.exists() and not refresh:
        df = pd.read_parquet(path)
    else:
        df = nr.load_nextgen_stats(stat_type=stat_type, seasons=True).to_pandas()
        df.to_parquet(path, index=False)
    return df[df["season"].isin(years)].copy()


def fetch_ftn(years=None, refresh=False) -> pd.DataFrame:
    """FTN charting: manually-charted pre-snap/scheme context per play (motion,
    play-action, RPO, box count, blitzers, drops, contested catches) — genuinely
    complementary to EPA, not derivable from box scores. Coverage: 2022 onward
    only (shorter history than everything else in this pipeline)."""
    import nflreadpy as nr

    years = years or SEASONS
    frames = []
    for year in years:
        path = _cache_path(f"ftn_{year}")
        if path.exists() and not refresh:
            frames.append(pd.read_parquet(path))
            continue
        try:
            df = nr.load_ftn_charting([year]).to_pandas()
        except Exception as e:
            print(f"WARNING: no FTN charting for {year} (likely pre-2022 or unpublished), skipping ({e})")
            continue
        df.to_parquet(path, index=False)
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
