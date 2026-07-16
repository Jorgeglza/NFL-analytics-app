from pathlib import Path

# Seasons included in the app (mirrors old settings.json season_range)
SEASONS = list(range(2015, 2026))

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
