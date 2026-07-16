# NFL Analytics App (TypeScript rebuild)

Rebuild of the Python Dash app at `..\NFL app` (read-only reference — NEVER modify it).
Goal: identical data, calculations, and model results; modern responsive UI.

## Architecture (decided — do not re-litigate)
- **Pipeline: Python** (`pipeline/`). Ports the old app's pandas/scikit-learn logic verbatim so results match exactly. Run manually now; weekly via GitHub Actions later.
- **Storage:** `data/nfl.sqlite` (committed, migration-friendly) + per-page JSON extracts in `app/public/data/` (what the frontend actually loads). Frontend never fetches external data or runs models.
- **Frontend:** Vite + React + TypeScript SPA in `app/`. Tailwind + shadcn-style components, ECharts for charts, TanStack Table for pivots, react-router.
- Old settings/upload Dash pages are intentionally dropped — the pipeline replaces them.

## Key commands
```bash
# Pipeline (from repo root; use the venv in pipeline/.venv)
python pipeline/run_pipeline.py --stage all        # fetch -> transform -> model -> export
python pipeline/run_pipeline.py --stage parity     # compare vs old app caches (needs old app path)
python pipeline/run_pipeline.py --stage validate   # invariant checks (used by CI)

# App (from app/)
npm run dev / npm run build / npm test
```

## Parity rules (Phase 1)
- Formulas come from the old app files; port them **verbatim, including known quirks** (documented in `docs/known-issues.md`). Do not "fix" logic before parity is reached and the change is documented.
- Grading models: RandomForest 100 trees, `random_state=42`; results are only reproducible with pinned sklearn/numpy versions (`pipeline/requirements.lock.txt`).
- Parity oracles: `..\NFL app\modules\data\cache\*.parquet` (team/player frames) and `..\NFL app\modules\data\grading_model\model_results.pkl` (grades/importances).
- Quirk to preserve: defensive grades do NOT apply `_apply_directionality`; the final score is inverted instead (`100*(1 - ...)`).

## Source-of-truth references (old app)
- `modules/data/data_utils.py` — schedule/win flags, team_week aggregation, cumulative ranks, player_week.
- `modules/data/grading_model/grading_model_utils.py` — 3 grading models.
- `modules/data/grading_model/tabs/teams_tab.py:compute_week_contributions` — attribution.
- Page formulas & constants: see `docs/logic-reference.md` and the plan appendix in `docs/page-mapping.md`.

## Working process
- **Always read `docs/IMPLEMENTATION_LOG.md` first** — it tracks milestone status and exact next steps. Update it (status + notes) after every meaningful change.
- Work milestone by milestone (M0 scaffold → M1 pipeline parity → M2 TS shared logic → M3 page-by-page parity → M4 UI polish → M5 deploy). M1 parity gates everything downstream.
- Per page in M3: match numbers against the running old app (env `pda-ie`, `python index.py`) on ≥3 filter combos before styling.
- Repo lives inside OneDrive — avoid huge churn; `data/raw_cache/` is gitignored.
