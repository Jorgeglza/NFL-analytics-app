# Page mapping — old Dash app → new SPA

| Old file (modules/…) | Old route | New route | New component | Status |
|---|---|---|---|---|
| game_analysis/game_picks_page_1.py | /game_analysis/game_picks | same | pages/game-analysis/GamePicks | ☐ |
| game_analysis/win_types_page_2.py | /game_analysis/win_types | same | pages/game-analysis/WinTypes | ✅ |
| game_analysis/team_comparison_page_3.py | /game_analysis/team_comparison | same | pages/game-analysis/TeamComparison | ☐ |
| game_analysis/scorecards_teams_page_4.py | /game_analysis/scorecards_teams | same | pages/game-analysis/Scorecards | ☐ |
| game_analysis/spread_win_percentage_page_6.py | /game_analysis/spread_win_percentage | same | pages/game-analysis/SpreadWinPct | ☐ |
| game_analysis/matchup_previews/* (3 tabs) | /game_analysis/game_previews | /game_analysis/matchup_previews | pages/game-analysis/previews/* | ☐ |
| player_analysis/prop_bets_players_page_1.py | /player_analysis/prop_bets_players | same | pages/player-analysis/PropBets | ☐ |
| player_analysis/build_parlay_page_2.py | /player_analysis/build_parlay | same | pages/player-analysis/ParlayBuilder | ☐ |
| player_analysis/player_team_stats_page_3.py | /player_analysis/player_team_stats | same | pages/player-analysis/PlayerTeamStats | ☐ |
| player_analysis/matchup_bets_page_4.py | /player_analysis/matchup_bets | same | pages/player-analysis/MatchupBets | ☐ |
| player_analysis/value_bets_page_5.py | /player_analysis/value_bets | same | pages/player-analysis/ValueBets | ☐ |
| data/grading_model/* (4 tabs) | /data/grading_model | same | pages/grading-model/* | ☐ |
| data/data_settings_page_2.py | /data/data_settings | — dropped | replaced by pipeline | n/a |
| data/upload_page_3.py | /data/upload | — dropped | replaced by pipeline | n/a |
| home.py | / | / | pages/Home | ☐ |

## Dash concept → React equivalent
- callbacks → React state + derived memos; cascading dropdowns → dependent selects
- dcc.Store (manual winners, parlay legs) → localStorage
- dash DataTable pivots → TanStack Table components (`components/tables/PivotTable`)
- Plotly figures → ECharts wrappers (`components/charts/*`)

## Deliberate deviations (keep updated)
1. Timezone: browser-local instead of hardcoded America/Monterrey (default-week selection).
2. game_id parsing validated; malformed ids surface as "—" instead of wrong labels.
3. Model Overview matrix precomputed in pipeline (`model_overview.json`) instead of at app startup.
4. Settings/upload pages removed; season range lives in `pipeline/nfl_pipeline/config.py`.
5. Home countdown (hardcoded 2025-08-22) dropped.
