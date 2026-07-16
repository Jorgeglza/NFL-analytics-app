# Pipeline runbook

## Local setup (once)
```bash
python -m venv pipeline/.venv
pipeline/.venv/Scripts/pip install pandas==3.0.0 numpy==1.26.4 scikit-learn==1.8.0 nflreadpy==0.1.2 pyarrow joblib
pipeline/.venv/Scripts/pip install --no-deps nfl_data_py==0.3.3 appdirs fastparquet
```
(Two steps because nfl_data_py 0.3.3 declares `pandas<3` while the reference
environment runs pandas 3.0.0 — same combination as the old `pda-ie` conda env.)

## Weekly manual run
```bash
pipeline/.venv/Scripts/python pipeline/run_pipeline.py --stage all --refresh
pipeline/.venv/Scripts/python pipeline/run_pipeline.py --stage validate
git add data/nfl.sqlite app/public/data && git commit -m "data: weekly refresh"
```
`--refresh` re-downloads raw data; without it, cached parquet in `data/raw_cache/` is reused.

## Stages
| Stage | What it does |
|---|---|
| fetch | nfl_data_py (+ nflreadpy fallback per year) → `data/raw_cache/*.parquet` |
| transform | team_week / player_week / cumulative ranks / schedule with win flags |
| model | 3 RF grading models (REG games only) + contribution scaler params |
| export | `data/nfl.sqlite` + `app/public/data/*.json` (compact column format) |
| parity | compare vs old app caches (local only; skips if old files absent) |
| validate | CI invariants: counts > 0, grades in [0,100], sqlite exists |

## Adding a season
Edit `SEASONS` in `pipeline/nfl_pipeline/config.py`, run `--stage all --refresh`.

## Data source notes
- 2015–2024 load via nfl_data_py; 2025+ falls back to nflreadpy (nfl_data_py's
  endpoint 404s). Newer nflreadpy schemas ship `game_id`/`game_type` columns —
  fetch.py drops them so the schedule merge stays canonical.
- nfl_data_py is in maintenance mode; if it breaks entirely, extend the
  nflreadpy path in `fetch.py` to all years and re-run parity.
