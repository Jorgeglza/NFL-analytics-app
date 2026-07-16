"""Port of teams_tab.py:compute_week_contributions + feature-set helpers.

Runs for every (team, season, week, grade_type) so the frontend never needs
to fit scalers at runtime.
"""
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

DESC_COLS = {'team', 'season', 'week', 'season_type', 'opponent_team', 'gameday', 'game_id', 'game_type'}


def _off_cols(df: pd.DataFrame):
    drop_cols = DESC_COLS | {'total_tds', 'points_margin', 'fantasy_points', 'fantasy_points_ppr', 'win', 'points'}
    numeric = df.select_dtypes(include='number').columns
    return [c for c in numeric if c not in drop_cols and not c.endswith("_allowed")]


def _def_cols(df: pd.DataFrame):
    numeric = df.select_dtypes(include='number').columns
    return [c for c in numeric if c.endswith("_allowed") and c != 'points_allowed']


def _overall_cols(df: pd.DataFrame):
    drop_cols = DESC_COLS | {'total_tds', 'fantasy_points', 'fantasy_points_ppr', 'points',
                             'points_allowed', 'epa_diff', 'win', 'points_margin'}
    numeric = df.select_dtypes(include='number').columns
    return [c for c in numeric if c not in drop_cols]


def _select_cols(df: pd.DataFrame, grade_type: str):
    if grade_type == "Offensive Grade":
        return _off_cols(df), "Offensive Importance", "offense"
    if grade_type == "Defensive Grade":
        return _def_cols(df), "Defensive Importance", "defense"
    return _overall_cols(df), "Overall Importance", "overall"


def contribution_params(team_week_df: pd.DataFrame, weights_df: pd.DataFrame) -> dict:
    """Export the parameters the frontend needs to reproduce
    compute_week_contributions exactly, instead of materializing ~1.6M rows.

    For each grade type: the feature list (order preserved), MinMax data_min /
    data_max fitted on ALL rows (identical to teams_tab.py fitting the scaler
    on the whole league frame), the importance weight, and the mode.
    Frontend math: norm = clip-free (raw - min)/(max - min) [sklearn transform,
    no clipping]; signed = w*(1-norm) for defense else w*norm.
    """
    league = team_week_df.reset_index(drop=True)
    out = {}
    for grade_type in ["Offensive Grade", "Defensive Grade", "Overall Grade"]:
        feat_cols, weight_col, mode = _select_cols(league, grade_type)
        if not feat_cols or weight_col not in weights_df.columns:
            continue
        X_raw = league[feat_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)
        scaler = MinMaxScaler().fit(X_raw)

        w = (weights_df[['Feature', weight_col]]
             .dropna(subset=['Feature'])
             .set_index('Feature')
             .reindex(feat_cols)
             .fillna(0.0)[weight_col])

        out[grade_type] = {
            "mode": mode,
            "features": feat_cols,
            "data_min": [float(v) for v in scaler.data_min_],
            "data_max": [float(v) for v in scaler.data_max_],
            "importance": [float(v) for v in w.values],
        }
    return out
