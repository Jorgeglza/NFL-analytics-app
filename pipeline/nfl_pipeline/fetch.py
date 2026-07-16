"""Raw data fetch with local parquet cache.

Ports the source-access logic of the old app's data_utils.py
(_load_player_week_year_with_fallback). All network access lives here so a
future nflverse library switch touches only this module.
"""
import pandas as pd

from .config import RAW_CACHE_DIR, SEASONS


def _cache_path(name: str):
    RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return RAW_CACHE_DIR / f"{name}.parquet"


def _load_player_week_year_with_fallback(year: int) -> pd.DataFrame:
    """Verbatim port of data_utils.py:_load_player_week_year_with_fallback."""
    import nfl_data_py as nfl
    try:
        df = nfl.import_weekly_data([year], downcast=True)
        print(f"loaded weekly {year} via nfl_data_py")
        if "team" not in df.columns and "recent_team" in df.columns:
            df = df.rename(columns={"recent_team": "team"})
        df["source"] = "nfl_data_py"
        return df
    except Exception as e1:
        print(f"nfl_data_py failed for {year}: {e1}")
        import nflreadpy as nr
        ps = nr.load_player_stats([year])
        df = ps.to_pandas()
        if "team" not in df.columns and "recent_team" in df.columns:
            df = df.rename(columns={"recent_team": "team"})
        if "opponent_team" not in df.columns:
            if "opponent" in df.columns:
                df = df.rename(columns={"opponent": "opponent_team"})
            elif "opp" in df.columns:
                df = df.rename(columns={"opp": "opponent_team"})
        if "season_type" not in df.columns and "game_type" in df.columns:
            df = df.rename(columns={"game_type": "season_type"})
        # Newer nflreadpy schemas ship schedule-owned columns (game_id, gameday,
        # game_type); drop them so the schedule merge in transform.py stays the
        # single source of those fields (matches original nfl_data_py schema).
        df = df.drop(columns=[c for c in ("game_id", "gameday", "game_type") if c in df.columns])
        df["source"] = "nflreadpy"
        print(f"fallback succeeded for {year} via nflreadpy")
        return df


def fetch_weekly(years=None, refresh=False) -> pd.DataFrame:
    """Player-week raw data for all seasons, cached per year."""
    years = years or SEASONS
    frames = []
    for year in years:
        path = _cache_path(f"weekly_{year}")
        if path.exists() and not refresh:
            frames.append(pd.read_parquet(path))
            continue
        df = _load_player_week_year_with_fallback(year)
        df.to_parquet(path, index=False)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def fetch_schedules(years=None, refresh=False) -> pd.DataFrame:
    years = years or SEASONS
    path = _cache_path("schedules")
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    import nfl_data_py as nfl
    df = nfl.import_schedules(years)
    df.to_parquet(path, index=False)
    return df


def fetch_team_desc(refresh=False) -> pd.DataFrame:
    path = _cache_path("team_desc")
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    import nfl_data_py as nfl
    df = nfl.import_team_desc()
    df.to_parquet(path, index=False)
    return df
