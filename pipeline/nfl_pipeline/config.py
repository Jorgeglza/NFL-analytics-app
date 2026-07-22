import datetime as _dt
from pathlib import Path

FIRST_SEASON = 2015


def current_season(today: "_dt.date | None" = None) -> int:
    """Latest NFL season expected to have data on nflverse.

    The new season's schedule is published well before kickoff (typically
    mid-May); from August onward the new calendar year's season is the
    newest one available (schedule only, until games are actually played).
    """
    today = today or _dt.date.today()
    return today.year if today.month >= 8 else today.year - 1


# Seasons included in the app (mirrors old settings.json season_range,
# rolling forward automatically each August)
SEASONS = list(range(FIRST_SEASON, current_season() + 1))

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_CACHE_DIR = DATA_DIR / "raw_cache"
SQLITE_PATH = DATA_DIR / "nfl.sqlite"
EXTRACTS_DIR = REPO_ROOT / "app" / "public" / "data"
FIXTURES_DIR = REPO_ROOT / "app" / "src" / "lib" / "logic" / "__fixtures__"

# Old app (parity oracle). Read-only; used by the parity stage only.
OLD_APP_DIR = Path(r"C:\Users\Jorge\OneDrive\Escritorio\JGA_Files\NFL app")
OLD_CACHE_DIR = OLD_APP_DIR / "modules" / "data" / "cache"
OLD_MODEL_PKL = OLD_APP_DIR / "modules" / "data" / "grading_model" / "model_results.pkl"
