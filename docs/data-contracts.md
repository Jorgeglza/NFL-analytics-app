# Data contracts

## JSON extracts (`app/public/data/`)
All tabular files use a compact column-oriented format:
```json
{ "cols": ["team", "season", ...], "rows": [["KC", 2024, ...], ...] }
```
Floats rounded to 4 dp; NaN/NaT → null. Loaded via `app/src/lib/data/loader.ts` (`toRecords`).

| File | Grain | Notes |
|---|---|---|
| `meta.json` | — | generated_at, seasons, current_season, row counts |
| `teams.json` | team | abbr, name, conf, division, colors, logos (from import_team_desc) |
| `schedule.json` | game (all seasons) | includes derived Winner/Favorite/Win Type, spread_line home-persp. |
| `grades.json` | team-season-week (REG) | `*_raw` + normalized Offensive/Defensive/Overall Grade |
| `feature_importance.json` | feature | Offensive/Defensive/Overall Importance |
| `contrib_params.json` | grade type | features, MinMax data_min/data_max, importance, mode — lets the frontend reproduce compute_week_contributions client-side |
| `team_week/{season}.json` | team-week | full ~190-col frame incl. `_allowed` |
| `team_week_ranks/{season}.json` | team-week | `{metric}_rank` columns only |
| `player_week/{season}.json` | player-week | id/schedule cols + all numeric stats (all-null cols dropped per season) |

## SQLite (`data/nfl.sqlite`)
Tables mirror the extracts 1:1: `schedule`, `team_week`, `team_week_ranks`, `player_week`,
`grades`, `feature_importance`, `team_meta`, `meta(key,value)`. Dates stored as `YYYY-MM-DD`
strings. This is the migration path to a hosted DB — the frontend does not read it.

## Frontend contribution math (from contrib_params.json)
```
norm = (raw - data_min[i]) / (data_max[i] - data_min[i])   // no clipping (sklearn transform)
signed = importance[i] * (mode == "defense" ? (1 - norm) : norm)
contribution = |signed|
```
