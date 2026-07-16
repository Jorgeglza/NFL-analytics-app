"""Verbatim port of the old app's grading_model_utils.py (model logic only).

Quirk preserved intentionally: the defensive model does NOT apply
_apply_directionality; it inverts the final score instead. See docs/known-issues.md.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import MinMaxScaler

offensive_negative = [
    'turnovers', 'int_per_attempt', 'interceptions', 'receiving_fumbles', 'receiving_fumbles_lost',
    'rushing_fumbles', 'rushing_fumbles_lost', 'sack_fumbles', 'sack_fumbles_lost', 'sack_yards', 'sacks'
]


def _apply_directionality(normalized_df: pd.DataFrame) -> pd.DataFrame:
    adj = normalized_df.copy()
    for col in adj.columns:
        base = col[:-8] if col.endswith('_allowed') else col
        if col.endswith('_allowed'):
            if base in offensive_negative:
                continue
            else:
                adj[col] = 1.0 - adj[col]
        else:
            if base in offensive_negative:
                adj[col] = 1.0 - adj[col]
    return adj


def generate_offense_grades_per_week(team_week_df):
    if 'team_stats_id' in team_week_df.columns:
        team_week_df = team_week_df.set_index('team_stats_id')

    descriptive_cols = [
        'team', 'season', 'week', 'season_type', 'opponent_team',
        'gameday', 'game_id', 'game_type'
    ]

    offensive_df = team_week_df.drop(
        columns=[col for col in team_week_df.columns
                 if col in descriptive_cols or col.endswith("_allowed")],
        errors="ignore"
    )

    for col in ['total_tds', 'points_margin', 'fantasy_points', 'fantasy_points_ppr']:
        offensive_df = offensive_df.drop(columns=col, errors='ignore')

    meta_cols = team_week_df[['team', 'season', 'week']]
    offensive_df_with_meta = offensive_df.copy()
    offensive_df_with_meta[['team', 'season', 'week']] = meta_cols.values

    features = offensive_df.drop(columns=['win', 'points'], errors='ignore').fillna(0)

    if 'win' in offensive_df.columns and 'points' in offensive_df.columns:
        y_win = offensive_df['win'].fillna(0)
        y_points = offensive_df['points'].fillna(0)

        clf = RandomForestClassifier(n_estimators=100, random_state=42)
        clf.fit(features, y_win)
        importances_win = clf.feature_importances_

        reg = RandomForestRegressor(n_estimators=100, random_state=42)
        reg.fit(features, y_points)
        importances_points = reg.feature_importances_

        combined_weights = (importances_win + importances_points) / 2
    else:
        raise ValueError("Missing 'win' or 'points' columns.")

    feature_importance_df = pd.DataFrame({
        'Feature': features.columns,
        'Win Importance': importances_win,
        'Points Importance': importances_points,
        'Combined Importance': combined_weights
    }).sort_values("Combined Importance", ascending=False).reset_index(drop=True)

    grouped_stats = offensive_df_with_meta.groupby(['team', 'season', 'week'])[features.columns].mean()

    scaler = MinMaxScaler()
    normalized_stats = pd.DataFrame(
        scaler.fit_transform(grouped_stats),
        columns=grouped_stats.columns,
        index=grouped_stats.index
    )
    normalized_stats = _apply_directionality(normalized_stats)
    weighted_scores = (normalized_stats * combined_weights).sum(axis=1)
    normalized_scores = 100 * (weighted_scores - weighted_scores.min()) / (weighted_scores.max() - weighted_scores.min())

    team_week_grades = normalized_scores.round(1).reset_index()
    team_week_grades.columns = ['Team', 'Season', 'Week', 'Grade']
    team_week_grades = team_week_grades.sort_values(by=['Season', 'Week', 'Grade'], ascending=[True, True, False])

    return team_week_grades, feature_importance_df


def generate_defensive_grades_per_week(team_week_df):
    if 'team_stats_id' in team_week_df.columns:
        team_week_df = team_week_df.set_index('team_stats_id')

    defensive_features = [c for c in team_week_df.columns if c.endswith('_allowed') and c != 'points_allowed']
    features = team_week_df[defensive_features].copy()

    meta_cols = team_week_df[['team', 'season', 'week']]
    defensive_df_with_meta = features.copy()
    defensive_df_with_meta[['team', 'season', 'week']] = meta_cols.values

    if 'win' not in team_week_df.columns or 'points_allowed' not in team_week_df.columns:
        raise ValueError("Missing 'win' and/or 'points_allowed' for defensive grading.")

    y_win = pd.to_numeric(team_week_df['win'], errors='coerce')
    y_pa = pd.to_numeric(team_week_df['points_allowed'], errors='coerce')
    fit_mask = y_win.notna() & y_pa.notna()

    X_fit = features.loc[fit_mask].fillna(0.0)
    y_win_f = y_win.loc[fit_mask].astype(int)
    y_pa_f = y_pa.loc[fit_mask].astype(float)

    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    reg = RandomForestRegressor(n_estimators=100, random_state=42)
    importances_win = np.zeros(X_fit.shape[1]) if y_win_f.nunique() < 2 else (clf.fit(X_fit, y_win_f).feature_importances_)
    importances_pa = np.zeros(X_fit.shape[1]) if len(y_pa_f) < 2 else (reg.fit(X_fit, y_pa_f).feature_importances_)
    combined_weights = (importances_win + importances_pa) / 2.0
    if not np.isfinite(combined_weights).any() or np.allclose(combined_weights, 0):
        combined_weights = np.ones(len(defensive_features)) / max(1, len(defensive_features))

    feature_importance_df = (pd.DataFrame({
        'Feature': defensive_features,
        'Win Importance': importances_win,
        'Points Allowed Importance': importances_pa,
        'Combined Importance': combined_weights
    }).fillna(0.0).sort_values('Combined Importance', ascending=False).reset_index(drop=True))

    grouped_stats = defensive_df_with_meta.groupby(['team', 'season', 'week'])[defensive_features].mean().fillna(0.0)
    scaler = MinMaxScaler()
    normalized_stats = pd.DataFrame(
        scaler.fit_transform(grouped_stats),
        columns=grouped_stats.columns,
        index=grouped_stats.index
    )

    weighted_scores = (normalized_stats * combined_weights).sum(axis=1)
    normalized_scores = 100 * (1 - (weighted_scores - weighted_scores.min()) / (weighted_scores.max() - weighted_scores.min()))
    team_week_grades = normalized_scores.round(1).reset_index()
    team_week_grades.columns = ['Team', 'Season', 'Week', 'Grade']
    team_week_grades = team_week_grades.sort_values(by=['Season', 'Week', 'Grade'], ascending=[True, True, False])

    return team_week_grades, feature_importance_df


def generate_overall_grades_per_week(team_week_df):
    if 'team_stats_id' in team_week_df.columns:
        team_week_df = team_week_df.set_index('team_stats_id')

    descriptive_cols = [
        'team', 'season', 'week', 'season_type', 'opponent_team',
        'gameday', 'game_id', 'game_type'
    ]

    overall_df = team_week_df.drop(
        columns=[col for col in team_week_df.columns if col in descriptive_cols],
        errors="ignore"
    )

    for col in ['total_tds', 'fantasy_points', 'fantasy_points_ppr', 'points', 'points_allowed', 'epa_diff']:
        overall_df = overall_df.drop(columns=col, errors='ignore')

    meta_cols = team_week_df[['team', 'season', 'week']]
    overall_df_with_meta = overall_df.copy()
    overall_df_with_meta[['team', 'season', 'week']] = meta_cols.values

    features = overall_df.drop(columns=['win', 'points_margin'], errors='ignore').fillna(0)

    if 'win' in overall_df.columns and 'points_margin' in overall_df.columns:
        y_win = overall_df['win'].fillna(0)
        y_margin = overall_df['points_margin'].fillna(0)

        clf = RandomForestClassifier(n_estimators=100, random_state=42)
        clf.fit(features, y_win)
        importances_win = clf.feature_importances_

        reg = RandomForestRegressor(n_estimators=100, random_state=42)
        reg.fit(features, y_margin)
        importances_margin = reg.feature_importances_

        combined_weights = (importances_win + importances_margin) / 2
    else:
        raise ValueError("Missing 'win' or 'points_margin' columns.")

    feature_importance_df = pd.DataFrame({
        'Feature': features.columns,
        'Win Importance': importances_win,
        'Margin Importance': importances_margin,
        'Combined Importance': combined_weights
    }).sort_values("Combined Importance", ascending=False).reset_index(drop=True)

    grouped_stats = overall_df_with_meta.groupby(['team', 'season', 'week'])[features.columns].mean()

    scaler = MinMaxScaler()
    normalized_stats = pd.DataFrame(
        scaler.fit_transform(grouped_stats),
        columns=grouped_stats.columns,
        index=grouped_stats.index
    )
    normalized_stats = _apply_directionality(normalized_stats)
    weighted_scores = (normalized_stats * combined_weights).sum(axis=1)
    normalized_scores = 100 * (weighted_scores - weighted_scores.min()) / (weighted_scores.max() - weighted_scores.min())

    team_week_grades = normalized_scores.round(1).reset_index()
    team_week_grades.columns = ['Team', 'Season', 'Week', 'Grade']
    team_week_grades = team_week_grades.sort_values(by=['Season', 'Week', 'Grade'], ascending=[True, True, False])

    return team_week_grades, feature_importance_df


def compute_all_model_results(team_week_df):
    offensive_grades_df, offensive_importance_df = generate_offense_grades_per_week(team_week_df.copy())
    defensive_grades_df, defensive_importance_df = generate_defensive_grades_per_week(team_week_df.copy())
    overall_grades_df, overall_importance_df = generate_overall_grades_per_week(team_week_df.copy())

    grade_models = offensive_grades_df.rename(columns={'Grade': 'Offensive Grade'}).merge(
        defensive_grades_df.rename(columns={'Grade': 'Defensive Grade'}),
        on=['Team', 'Season', 'Week'], how='outer'
    ).merge(
        overall_grades_df.rename(columns={'Grade': 'Overall Grade'}),
        on=['Team', 'Season', 'Week'], how='outer'
    )

    grade_models = grade_models.rename(columns={
        'Offensive Grade': 'Offensive Grade_raw',
        'Defensive Grade': 'Defensive Grade_raw',
        'Overall Grade': 'Overall Grade_raw'
    })

    grade_cols_raw = ['Offensive Grade_raw', 'Defensive Grade_raw', 'Overall Grade_raw']
    grade_cols_norm = ['Offensive Grade', 'Defensive Grade', 'Overall Grade']

    for raw_col, norm_col in zip(grade_cols_raw, grade_cols_norm):
        scaler = MinMaxScaler()
        grade_models[norm_col] = scaler.fit_transform(grade_models[[raw_col]].fillna(0)) * 100
        grade_models[norm_col] = grade_models[norm_col].round(1)

    offensive_feat = offensive_importance_df[['Feature', 'Combined Importance']].rename(columns={'Combined Importance': 'Offensive Importance'})
    defensive_feat = defensive_importance_df[['Feature', 'Combined Importance']].rename(columns={'Combined Importance': 'Defensive Importance'})
    overall_feat = overall_importance_df[['Feature', 'Combined Importance']].rename(columns={'Combined Importance': 'Overall Importance'})

    models_feature_importance_df = offensive_feat.merge(
        defensive_feat, on='Feature', how='outer'
    ).merge(
        overall_feat, on='Feature', how='outer'
    ).fillna(0)

    models_feature_importance_df = models_feature_importance_df.sort_values("Overall Importance", ascending=False)

    return grade_models, models_feature_importance_df
