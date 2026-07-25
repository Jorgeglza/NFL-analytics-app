"""Python port of app/src/lib/logic/elo.ts — kept faithful so the spike's
evaluation can compare against the exact same Elo the app's Model Picker uses.
Pre-game ratings only (no leakage): the rating used for a game is always the
value as it stood before that game was played.
"""
import math

import pandas as pd

ELO_INIT = 1505.0
ELO_K = 20.0
ELO_HFA = 48.0
ELO_SEASON_REGRESS = 1 / 3

TEAM_ALIAS = {"SD": "LAC", "OAK": "LV", "STL": "LA"}


def elo_team_key(team: str) -> str:
    return TEAM_ALIAS.get(team, team)


def elo_p_home(elo_away: float, elo_home: float) -> float:
    return 1 / (1 + 10 ** (-(elo_home + ELO_HFA - elo_away) / 400))


def elo_mov_multiplier(margin: float, elo_diff_winner: float) -> float:
    return math.log(abs(margin) + 1) * (2.2 / (0.001 * abs(elo_diff_winner) + 2.2))


def build_elo_index(schedule: pd.DataFrame) -> pd.DataFrame:
    """schedule: rows with game_id, season, week, gameday, away_team, home_team,
    away_score, home_score (REG + non-REG both fine, sorted chronologically
    inside). Returns one row per game_id with pre-game elo_away/elo_home/p_home.
    """
    df = schedule.copy()
    df["_order"] = pd.to_datetime(df["gameday"], errors="coerce").astype("int64") + df["week"].astype(float) / 1000
    df = df.sort_values(["_order", "game_id"])

    ratings: dict[str, float] = {}
    last_season: dict[str, int] = {}

    def get(team):
        return ratings.get(elo_team_key(team), ELO_INIT)

    def set_(team, v):
        ratings[elo_team_key(team)] = v

    out_rows = []
    for row in df.itertuples(index=False):
        for t in (row.away_team, row.home_team):
            k = elo_team_key(t)
            if last_season.get(k) != row.season:
                if k in last_season:
                    set_(t, get(t) * (1 - ELO_SEASON_REGRESS) + ELO_INIT * ELO_SEASON_REGRESS)
                last_season[k] = row.season

        ea = get(row.away_team)
        eh = get(row.home_team)
        p_home = elo_p_home(ea, eh)
        out_rows.append({"game_id": row.game_id, "elo_away": ea, "elo_home": eh, "elo_p_home": p_home})

        if pd.isna(row.away_score) or pd.isna(row.home_score):
            continue
        margin = row.home_score - row.away_score
        actual_home = 1.0 if margin > 0 else (0.0 if margin < 0 else 0.5)
        diff_winner = (eh + ELO_HFA - ea) if margin >= 0 else (ea - (eh + ELO_HFA))
        mult = 1.0 if margin == 0 else elo_mov_multiplier(margin, diff_winner)
        delta = ELO_K * mult * (actual_home - p_home)
        set_(row.home_team, eh + delta)
        set_(row.away_team, ea - delta)

    return pd.DataFrame(out_rows)
