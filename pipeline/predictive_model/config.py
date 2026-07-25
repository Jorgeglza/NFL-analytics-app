"""Isolated config for the predictive-model research spike.

Deliberately separate from nfl_pipeline.config's DATA_DIR/RAW_CACHE_DIR/SQLITE_PATH/
EXTRACTS_DIR: this spike must never write into the parity-critical pipeline outputs.
Only SEASONS/current_season are reused (read-only) so the spike covers the same
season range as the main app.
"""
from pathlib import Path

from nfl_pipeline.config import SEASONS, FIRST_SEASON, current_season  # noqa: F401

REPO_ROOT = Path(__file__).resolve().parents[2]

# Own raw cache — separate from data/raw_cache/ (the M1-parity cache).
RAW_CACHE_DIR = REPO_ROOT / "data" / "raw_cache_predictive"

# Own output dir for trained model artifacts + metrics — not data/nfl.sqlite,
# not app/public/data/.
OUTPUT_DIR = REPO_ROOT / "data" / "predictive_model"

# Read-only inputs from the existing, already-exported pipeline outputs.
NFL_SQLITE_PATH = REPO_ROOT / "data" / "nfl.sqlite"
GRADES_JSON = REPO_ROOT / "app" / "public" / "data" / "grades.json"

# First season with usable play-by-play/injury/snap-count coverage from
# nflverse for this spike; earlier seasons (back to FIRST_SEASON) are still
# used for the schedule/team_week-only features.
PBP_FIRST_SEASON = FIRST_SEASON

# Walk-forward test seasons: train on everything strictly before each of
# these, test on that single season.
TEST_SEASONS = [current_season() - 1, current_season()]
