"""Verbatim ports of the old app's data_utils.py transforms.

Differences from the original are I/O-only: raw frames come from fetch.py's
parquet cache instead of hitting the network inside each function.
"""
import numpy as np
import pandas as pd

from .fetch import fetch_schedules, fetch_weekly


def calculate_win_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Port of data_utils.py:calculate_win_flags."""
    df['Winner'] = np.where(df['home_score'].isna() | df['away_score'].isna(), None,
                            np.where(df['home_score'] > df['away_score'], 'home',
                            np.where(df['home_score'] < df['away_score'], 'away', 'tie')))

    df['Favorite'] = np.where(df['spread_line'].isna(), None,
                              np.where(df['spread_line'] < 0, 'home',
                              np.where(df['spread_line'] > 0, 'away', 'none')))

    def favorite_win(row):
        if row['Favorite'] is None or row['Winner'] is None or row['Winner'] == 'tie':
            return None
        return int(row['Favorite'] == row['Winner'])

    df['Favorite Win'] = df.apply(favorite_win, axis=1)

    df['Home Win'] = np.where(df['Winner'] == 'home', 1,
                              np.where(df['Winner'] == 'away', 0, None))

    def determine_win_type(row):
        if pd.isna(row['Favorite Win']) or pd.isna(row['Home Win']):
            return None
        if row['Favorite Win'] == 1 and row['Home Win'] == 1:
            return 'Favorite home'
        elif row['Favorite Win'] == 1 and row['Home Win'] == 0:
            return 'Favorite away'
        elif row['Favorite Win'] == 0 and row['Home Win'] == 0:
            return 'Underdog away'
        elif row['Favorite Win'] == 0 and row['Home Win'] == 1:
            return 'Underdog home'
        else:
            return 'Other'

    df['Win Type'] = df.apply(determine_win_type, axis=1)
    return df


def load_schedule_df(years=None) -> pd.DataFrame:
    """Port of data_utils.py:load_schedule_df (spread flipped to home perspective)."""
    schedule_df = fetch_schedules(years).copy()
    schedule_df['spread_line'] = schedule_df['spread_line'].astype(float) * -1
    schedule_df = calculate_win_flags(schedule_df)
    return schedule_df


def get_player_week_data(years=None, include_schedule=True) -> pd.DataFrame:
    """Port of data_utils.py:get_player_week_data."""
    player_week_df = fetch_weekly(years).copy()
    if player_week_df.empty:
        return player_week_df

    if include_schedule:
        schedule = fetch_schedules(years).copy()
        schedule['gameday'] = pd.to_datetime(schedule['gameday'], errors='coerce')

        home = schedule[['season', 'week', 'home_team', 'gameday', 'game_id', 'game_type']].rename(
            columns={'home_team': 'team'})
        away = schedule[['season', 'week', 'away_team', 'gameday', 'game_id', 'game_type']].rename(
            columns={'away_team': 'team'})
        schedule_team_level = pd.concat([home, away], ignore_index=True)

        player_week_df = player_week_df.merge(
            schedule_team_level, on=['season', 'week', 'team'], how='left')

    return player_week_df


def get_team_week_stats(years=None) -> pd.DataFrame:
    """Port of data_utils.py:get_team_week_stats."""
    weekly = fetch_weekly(years).copy()
    if weekly.empty:
        return pd.DataFrame()

    schedule = fetch_schedules(years).copy()
    schedule['gameday'] = pd.to_datetime(schedule['gameday'])

    home = schedule[['season', 'week', 'home_team', 'gameday', 'game_id', 'game_type']].rename(columns={'home_team': 'team'})
    away = schedule[['season', 'week', 'away_team', 'gameday', 'game_id', 'game_type']].rename(columns={'away_team': 'team'})
    schedule_team_level = pd.concat([home, away], ignore_index=True)

    weekly = weekly.merge(schedule_team_level, on=['season', 'week', 'team'], how='left')

    group_cols = ['team', 'season', 'week', 'season_type', 'opponent_team', 'gameday', 'game_id', 'game_type']
    numeric_cols = weekly.select_dtypes(include='number').columns.difference(group_cols).tolist()

    team_week_stats = weekly.groupby(group_cols, as_index=False)[numeric_cols].sum(min_count=1)

    team_week_stats['total_yards'] = team_week_stats['passing_yards'] + team_week_stats['rushing_yards']
    team_week_stats['total_tds'] = team_week_stats['passing_tds'] + team_week_stats['rushing_tds']

    team_week_stats['yds_per_pass'] = team_week_stats['passing_yards'] / team_week_stats['attempts']
    team_week_stats['yds_per_rush'] = team_week_stats['rushing_yards'] / team_week_stats['carries']
    team_week_stats['completion_pct'] = team_week_stats['completions'] / team_week_stats['attempts']
    team_week_stats['td_per_attempt'] = team_week_stats['passing_tds'] / team_week_stats['attempts']
    team_week_stats['int_per_attempt'] = team_week_stats['interceptions'] / team_week_stats['attempts']

    team_week_stats['turnovers'] = (team_week_stats['interceptions']
                                    + team_week_stats['rushing_fumbles_lost']
                                    + team_week_stats['receiving_fumbles_lost']
                                    + team_week_stats['sack_fumbles_lost'])

    team_week_stats['team_stats_id'] = team_week_stats['game_id'] + "_" + team_week_stats['team']

    score_df = schedule[['game_id', 'home_team', 'home_score', 'away_team', 'away_score']].copy()
    home_scores = score_df[['game_id', 'home_team', 'home_score']].rename(
        columns={'home_team': 'team', 'home_score': 'points'})
    away_scores = score_df[['game_id', 'away_team', 'away_score']].rename(
        columns={'away_team': 'team', 'away_score': 'points'})
    points = pd.concat([home_scores, away_scores], ignore_index=True)

    team_week_stats = team_week_stats.merge(points, on=['game_id', 'team'], how='left')
    numeric_cols.extend([
        'points', 'total_yards', 'total_tds', 'yds_per_pass', 'yds_per_rush',
        'completion_pct', 'td_per_attempt', 'int_per_attempt', 'turnovers'
    ])

    opponent_stats = team_week_stats.copy()
    opponent_stats = opponent_stats.rename(columns={col: f"{col}_allowed" for col in numeric_cols})
    opponent_stats = opponent_stats.rename(columns={'team': 'opponent_team', 'opponent_team': 'team'})

    team_week_stats = team_week_stats.merge(
        opponent_stats[['season', 'week', 'team', 'opponent_team'] + [f"{col}_allowed" for col in numeric_cols]],
        on=['season', 'week', 'team', 'opponent_team'],
        how='left'
    )
    team_week_stats['win'] = (team_week_stats['points'] > team_week_stats['points_allowed']).astype(int)
    team_week_stats['points_margin'] = team_week_stats['points'] - team_week_stats['points_allowed']
    team_week_stats['turnover_margin'] = (team_week_stats['interceptions_allowed']
                                          + team_week_stats['rushing_fumbles_lost_allowed']
                                          + team_week_stats['receiving_fumbles_lost_allowed']
                                          + team_week_stats['sack_fumbles_lost_allowed']
                                          - team_week_stats['turnovers'])
    team_week_stats['epa_diff'] = (
        (team_week_stats['passing_epa'] + team_week_stats['rushing_epa']
         - team_week_stats['passing_epa_allowed'] - team_week_stats['rushing_epa_allowed']).round(2)
    )
    print("aggregated to team-week level with opponent stats")
    return team_week_stats


def get_cumulative_team_week_ranks(team_week_stats: pd.DataFrame) -> pd.DataFrame:
    """Port of data_utils.py:get_cumulative_team_week_ranks."""
    offensive_positive = [
        'points', 'points_margin', 'turnover_margin', 'epa_diff',
        'total_yards', 'total_tds', 'yds_per_pass', 'yds_per_rush', 'completion_pct', 'td_per_attempt',
        'attempts', 'carries', 'completions', 'dakota', 'fantasy_points', 'fantasy_points_ppr',
        'pacr', 'passing_2pt_conversions', 'passing_air_yards', 'passing_epa',
        'passing_first_downs', 'passing_tds', 'passing_yards', 'passing_yards_after_catch',
        'racr', 'receiving_2pt_conversions', 'receiving_air_yards', 'receiving_epa',
        'receiving_first_downs', 'receiving_tds', 'receiving_yards',
        'receiving_yards_after_catch', 'receptions', 'rushing_2pt_conversions',
        'rushing_epa', 'rushing_first_downs', 'rushing_tds', 'rushing_yards',
        'special_teams_tds', 'targets', 'wopr'
    ]

    offensive_negative = [
        'turnovers', 'int_per_attempt', 'interceptions', 'receiving_fumbles', 'receiving_fumbles_lost',
        'rushing_fumbles', 'rushing_fumbles_lost', 'sack_fumbles', 'sack_fumbles_lost', 'sack_yards', 'sacks'
    ]

    offensive_positive_available = [m for m in offensive_positive if m in team_week_stats.columns]
    offensive_negative_available = [m for m in offensive_negative if m in team_week_stats.columns]
    defensive_positive_allowed = [f"{m}_allowed" for m in offensive_positive if f"{m}_allowed" in team_week_stats.columns]
    defensive_negative_allowed = [f"{m}_allowed" for m in offensive_negative if f"{m}_allowed" in team_week_stats.columns]

    all_metrics = (offensive_positive_available + offensive_negative_available
                   + defensive_positive_allowed + defensive_negative_allowed)

    team_week_stats_sorted = team_week_stats.sort_values(by=['season', 'team', 'week'])

    cum_data = {
        f'cum_{metric}': team_week_stats_sorted.groupby(['season', 'team'])[metric].cumsum()
        for metric in all_metrics
    }
    team_week_stats_sorted = pd.concat(
        [team_week_stats_sorted, pd.DataFrame(cum_data, index=team_week_stats_sorted.index)], axis=1)

    team_week_stats_sorted['games_played'] = (
        team_week_stats_sorted.groupby(['season', 'team']).cumcount() + 1
    )

    avg_data = {
        f'{metric}_avg': team_week_stats_sorted[f'cum_{metric}'] / team_week_stats_sorted['games_played']
        for metric in all_metrics
    }
    team_week_stats_sorted = pd.concat(
        [team_week_stats_sorted, pd.DataFrame(avg_data, index=team_week_stats_sorted.index)], axis=1)

    # Equivalent to the old groupby(['season','week']).apply(rank_week) but
    # stable across pandas versions (pandas 3 drops group keys inside apply).
    gb = team_week_stats_sorted.groupby(['season', 'week'])
    rank_data = {}
    for metric in offensive_positive_available:
        rank_data[f'{metric}_rank'] = gb[f'{metric}_avg'].rank(ascending=False, method='min')
    for metric in offensive_negative_available:
        rank_data[f'{metric}_rank'] = gb[f'{metric}_avg'].rank(ascending=True, method='min')
    for metric in defensive_positive_allowed:
        rank_data[f'{metric}_rank'] = gb[f'{metric}_avg'].rank(ascending=True, method='min')
    for metric in defensive_negative_allowed:
        rank_data[f'{metric}_rank'] = gb[f'{metric}_avg'].rank(ascending=False, method='min')
    ranked = pd.concat(
        [team_week_stats_sorted, pd.DataFrame(rank_data, index=team_week_stats_sorted.index)], axis=1)

    id_cols = ['season', 'week', 'team', 'game_id', 'gameday']
    rank_cols = [f'{m}_rank' for m in all_metrics]
    result = ranked[id_cols + rank_cols].copy()
    print("computed weekly ranks")
    return result
