# NFL Analytics App

Static TypeScript rebuild of the JGA NFL Dash app. A Python pipeline fetches nflverse data,
computes all derived stats and Random Forest grading models, and writes a SQLite DB plus
JSON extracts. The Vite + React SPA loads only those local files — no runtime data fetching
or model execution.

## Layout
- `pipeline/` — Python data pipeline (`python pipeline/run_pipeline.py --stage all`)
- `data/nfl.sqlite` — committed database (source of truth, hosted-DB migration path)
- `app/` — Vite + React + TS frontend; reads `app/public/data/*.json`
- `docs/` — logic reference, page mapping, known issues, runbook, implementation log
- `.github/workflows/` — weekly data refresh + Pages deploy

## Quick start
```bash
# 1. Pipeline
python -m venv pipeline/.venv
pipeline/.venv/Scripts/pip install -r pipeline/requirements.txt
pipeline/.venv/Scripts/python pipeline/run_pipeline.py --stage all

# 2. App
cd app && npm install && npm run dev
```

See `docs/IMPLEMENTATION_LOG.md` for current status and next steps.
