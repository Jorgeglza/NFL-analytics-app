"""Leakage-safe feature engineering for the predictive-model spike.

Every per-team feature is computed strictly from games *before* the game being
predicted (rolling/expanding windows shifted by one), or from information that
is genuinely known before kickoff (announced starting QB, injury reports,
weather, rest days, market odds excluded from the feature set — see
build_game_table's docstring). Reads schedule/team_week/grades read-only from
the already-built data/nfl.sqlite; never writes back to it.
"""
import re
import sqlite3

import numpy as np
import pandas as pd

from . import fetch
from .config import NFL_SQLITE_PATH
from .elo import build_elo_index, elo_team_key

DOME_ROOFS = {"dome", "closed"}


def _read_sql(query: str) -> pd.DataFrame:
    con = sqlite3.connect(NFL_SQLITE_PATH)
    try:
        return pd.read_sql(query, con)
    finally:
        con.close()


def load_schedule() -> pd.DataFrame:
    return _read_sql("select * from schedule")


def load_team_week() -> pd.DataFrame:
    df = _read_sql(
        "select team, season, week, game_id, points_margin, epa_diff, turnover_margin, win, "
        "passing_epa, rushing_epa, passing_epa_allowed, rushing_epa_allowed "
        "from team_week"
    )
    # team_week carries a small number of duplicate (team, season, week) "phantom"
    # rows, a known upstream nflverse quirk preserved verbatim in the parity-critical
    # main pipeline (docs/known-issues.md) -- correct to keep there, but merging two
    # frames that both carry duplicate keys here would fan out into a Cartesian
    # product (not just double-count), silently inflating every downstream feature
    # table. This is a read-only consumer with no parity requirement, so dedupe here.
    return df.drop_duplicates(subset=["team", "season", "week"], keep="first")


def load_grades() -> pd.DataFrame:
    return _read_sql(
        'select Team as team, Season as season, Week as week, '
        '"Overall Grade" as overall_grade, "Offensive Grade" as offense_grade, '
        '"Defensive Grade" as defense_grade from grades'
    )


def _rolling_trend(team_week: pd.DataFrame) -> pd.DataFrame:
    """L3 (last-3-games) trailing means, computed *before* the current week —
    shift(1) so the current week's own row never leaks into its own feature."""
    df = team_week.sort_values(["team", "season", "week"]).copy()
    df["pass_epa_diff"] = df["passing_epa"] - df["passing_epa_allowed"]
    df["rush_epa_diff"] = df["rushing_epa"] - df["rushing_epa_allowed"]
    grp = df.groupby(["team", "season"], group_keys=False)
    src_cols = ["points_margin", "epa_diff", "turnover_margin", "pass_epa_diff", "rush_epa_diff"]
    for col in src_cols:
        df[f"l3_{col}"] = grp[col].apply(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    return df[["team", "season", "week"] + [f"l3_{c}" for c in src_cols]]


def _surprise_rolling(team_week: pd.DataFrame) -> pd.DataFrame:
    """"Overreaction" feature (Vergin, 2001, cited in the Stekler survey): the
    betting market is documented to overreact to a team's most recent
    large-margin result — overrating a team after a big win, underrating
    after a big loss. This measures how much of an outlier last week's game
    actually was relative to the team's established baseline BEFORE that
    game: shift(1) gives last week's own result, shift(2).expanding() gives
    the cumulative average strictly before that game (so week W's feature
    never touches week W-1's or later data — the "surprise" game itself is
    excluded from its own baseline, not just from the current week)."""
    df = team_week.sort_values(["team", "season", "week"]).copy()
    grp = df.groupby(["team", "season"], group_keys=False)
    for col in ["points_margin", "epa_diff"]:
        last_week = grp[col].shift(1)
        baseline_before = grp[col].apply(lambda s: s.shift(2).expanding().mean())
        df[f"surprise_{col}"] = last_week - baseline_before
    return df[["team", "season", "week", "surprise_points_margin", "surprise_epa_diff"]]


def _cumulative_grades(grades: pd.DataFrame) -> pd.DataFrame:
    """Expanding (all prior weeks) mean, shifted so the current week's own
    grade — which encodes that week's own result — never leaks in."""
    df = grades.sort_values(["team", "season", "week"]).copy()
    grp = df.groupby(["team", "season"], group_keys=False)
    for col in ["overall_grade", "offense_grade", "defense_grade"]:
        df[f"cum_{col}"] = grp[col].apply(lambda s: s.shift(1).expanding().mean())
    return df[["team", "season", "week", "cum_overall_grade", "cum_offense_grade", "cum_defense_grade"]]


def _pbp_rolling(seasons) -> pd.DataFrame:
    """Season-to-date L3 success rate / explosive-play rate per team-week,
    aggregated from play-by-play (independent of team_week's box-score epa_diff
    — a richer per-play signal instead of a per-game aggregate)."""
    pbp = fetch.fetch_pbp(seasons)
    if pbp.empty:
        return pd.DataFrame(columns=["team", "season", "week", "l3_success_rate", "l3_explosive_rate"])
    pbp = pbp[pbp["posteam"].notna() & pbp["play_type"].isin(["pass", "run"])].copy()
    pbp["explosive"] = np.where(pbp["play_type"] == "run", pbp["yards_gained"] >= 12, pbp["yards_gained"] >= 20)
    agg = (
        pbp.groupby(["posteam", "season", "week"])
        .agg(success_rate=("success", "mean"), explosive_rate=("explosive", "mean"))
        .reset_index()
        .rename(columns={"posteam": "team"})
    )
    agg = agg.sort_values(["team", "season", "week"])
    grp = agg.groupby(["team", "season"], group_keys=False)
    agg["l3_success_rate"] = grp["success_rate"].apply(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    agg["l3_explosive_rate"] = grp["explosive_rate"].apply(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    return agg[["team", "season", "week", "l3_success_rate", "l3_explosive_rate"]]


def _roll_l3(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Shared L3-rolling helper: shift(1).rolling(3, min_periods=1).mean() per
    (team, season), applied to every column in `cols`. Same no-leakage pattern
    as _rolling_trend/_pbp_rolling, factored out once NGS/FTN needed it too."""
    df = df.sort_values(["team", "season", "week"]).copy()
    grp = df.groupby(["team", "season"], group_keys=False)
    for col in cols:
        df[f"l3_{col}"] = grp[col].apply(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    return df[["team", "season", "week"] + [f"l3_{c}" for c in cols]]


def _ngs_rolling(seasons) -> pd.DataFrame:
    """Next Gen Stats (tracking-derived) team-week aggregates, L3-rolled:
    - passing: the leading passer's (max attempts that week) time-to-throw,
      completion% above expectation, aggressiveness (into tight windows).
    - rushing: attempt-weighted rush yards over expected/att, % runs into an
      8+-defender box.
    - receiving: target-weighted separation, cushion, YAC above expectation.
    """
    passing = fetch.fetch_ngs("passing", seasons)
    rushing = fetch.fetch_ngs("rushing", seasons)
    receiving = fetch.fetch_ngs("receiving", seasons)

    cols = [
        "time_to_throw", "pass_cpoe", "aggressiveness",
        "rush_yoe", "box8_rate", "separation", "cushion", "yac_above_exp",
    ]
    empty = pd.DataFrame(columns=["team", "season", "week"] + [f"l3_{c}" for c in cols])
    if passing.empty or rushing.empty or receiving.empty:
        return empty

    passing = passing[passing["week"] > 0].copy()
    lead_passer = passing.sort_values("attempts", ascending=False).drop_duplicates(["team_abbr", "season", "week"])
    lead_passer = lead_passer.rename(columns={
        "team_abbr": "team", "avg_time_to_throw": "time_to_throw",
        "completion_percentage_above_expectation": "pass_cpoe",
    })[["team", "season", "week", "time_to_throw", "pass_cpoe", "aggressiveness"]]

    rushing = rushing[rushing["week"] > 0].copy()
    rushing["_w"] = rushing["rush_attempts"].clip(lower=0)
    rush_agg = (
        rushing.groupby(["team_abbr", "season", "week"])
        .apply(lambda g: pd.Series({
            "rush_yoe": np.average(g["rush_yards_over_expected_per_att"].fillna(0), weights=g["_w"] + 1e-9),
            "box8_rate": np.average(g["percent_attempts_gte_eight_defenders"].fillna(0), weights=g["_w"] + 1e-9),
        }), include_groups=False)
        .reset_index()
        .rename(columns={"team_abbr": "team"})
    )

    receiving = receiving[receiving["week"] > 0].copy()
    receiving["_w"] = receiving["targets"].clip(lower=0)
    rec_agg = (
        receiving.groupby(["team_abbr", "season", "week"])
        .apply(lambda g: pd.Series({
            "separation": np.average(g["avg_separation"].fillna(0), weights=g["_w"] + 1e-9),
            "cushion": np.average(g["avg_cushion"].fillna(0), weights=g["_w"] + 1e-9),
            "yac_above_exp": np.average(g["avg_yac_above_expectation"].fillna(0), weights=g["_w"] + 1e-9),
        }), include_groups=False)
        .reset_index()
        .rename(columns={"team_abbr": "team"})
    )

    merged = lead_passer.merge(rush_agg, on=["team", "season", "week"], how="outer")
    merged = merged.merge(rec_agg, on=["team", "season", "week"], how="outer")
    return _roll_l3(merged, cols)


def _ftn_rolling(seasons) -> pd.DataFrame:
    """FTN charting (pre-snap/scheme context), joined onto play-by-play to
    recover which team had the ball (FTN itself carries no team column),
    aggregated to team-week and L3-rolled: motion/play-action/RPO rate,
    box count faced, blitz rate faced, drop rate, contested-catch rate."""
    ftn = fetch.fetch_ftn(seasons)
    cols = ["motion_rate", "play_action_rate", "rpo_rate", "box_count_faced", "blitz_rate", "drop_rate", "contested_rate"]
    empty = pd.DataFrame(columns=["team", "season", "week"] + [f"l3_{c}" for c in cols])
    if ftn.empty:
        return empty

    pbp = fetch.fetch_pbp(seasons)
    pbp_keys = pbp[["game_id", "play_id", "posteam"]].dropna(subset=["posteam"])
    joined = ftn.merge(
        pbp_keys,
        left_on=["nflverse_game_id", "nflverse_play_id"],
        right_on=["game_id", "play_id"],
        how="inner",
    )
    if joined.empty:
        return empty

    has_target = joined["is_catchable_ball"].notna() | joined["is_contested_ball"].notna()
    targeted = joined[has_target]

    agg = joined.groupby(["posteam", "season", "week"]).agg(
        motion_rate=("is_motion", "mean"),
        play_action_rate=("is_play_action", "mean"),
        rpo_rate=("is_rpo", "mean"),
        box_count_faced=("n_defense_box", "mean"),
        blitz_rate=("n_blitzers", lambda s: (s.fillna(0) > 0).mean()),
    ).reset_index()
    drop_agg = targeted.groupby(["posteam", "season", "week"]).agg(
        drop_rate=("is_drop", "mean"),
        contested_rate=("is_contested_ball", "mean"),
    ).reset_index()
    agg = agg.merge(drop_agg, on=["posteam", "season", "week"], how="left").rename(columns={"posteam": "team"})
    return _roll_l3(agg, cols)


def _qb_continuity(schedule: pd.DataFrame) -> pd.DataFrame:
    """1 if the team's announced starting QB for this game differs from the
    QB who started their previous game — the single biggest pregame-known
    signal missing from the existing grade/trend models. Uses each game's OWN
    qb_id (announced pregame, not a result) so this is not a leak."""
    home = schedule[["game_id", "season", "week", "gameday", "home_team", "home_qb_id"]].rename(
        columns={"home_team": "team", "home_qb_id": "qb_id"}
    )
    away = schedule[["game_id", "season", "week", "gameday", "away_team", "away_qb_id"]].rename(
        columns={"away_team": "team", "away_qb_id": "qb_id"}
    )
    both = pd.concat([home, away], ignore_index=True)
    both["_order"] = pd.to_datetime(both["gameday"], errors="coerce").astype("int64") + both["week"].astype(float) / 1000
    both = both.sort_values(["team", "_order"])
    both["prev_qb_id"] = both.groupby("team")["qb_id"].shift(1)
    both["qb_changed"] = ((both["prev_qb_id"].notna()) & (both["qb_id"] != both["prev_qb_id"])).astype(int)
    return both[["team", "season", "week", "game_id", "qb_changed"]]


def _injury_severity(seasons) -> pd.DataFrame:
    inj = fetch.fetch_injuries(seasons)
    if inj.empty:
        return pd.DataFrame(columns=["team", "season", "week", "injury_out_count", "qb_listed_out"])
    severe = inj[inj["report_status"].isin(["Out", "Doubtful"])]
    out_count = severe.groupby(["team", "season", "week"]).size().rename("injury_out_count").reset_index()
    qb_out = (
        severe[severe["position"] == "QB"]
        .groupby(["team", "season", "week"])
        .size()
        .rename("qb_listed_out")
        .reset_index()
    )
    qb_out["qb_listed_out"] = 1
    merged = out_count.merge(qb_out, on=["team", "season", "week"], how="outer")
    merged["injury_out_count"] = merged["injury_out_count"].fillna(0)
    merged["qb_listed_out"] = merged["qb_listed_out"].fillna(0)
    return merged


def _normalize_name(name) -> str:
    s = str(name).lower()
    s = re.sub(r"[.'\-]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"[^a-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _snap_weighted_injury_severity(seasons) -> pd.DataFrame:
    """Injury severity weighted by how much the injured player actually plays
    — an "Out" starter who plays 90% of snaps matters far more than an "Out"
    backup who plays 5%. Joins injuries (report_status, gsis_id) to snap
    counts (offense_pct/defense_pct, pfr_player_id) via normalized player name
    since neither source shares a common id (96.7% match rate spot-checked on
    2023). Snap share is each player's own EXPANDING-MEAN share from strictly
    prior weeks (shift(1).expanding().mean()) — never the current week's own
    snaps, which would be zero/missing precisely because they're injured."""
    inj = fetch.fetch_injuries(seasons)
    snaps = fetch.fetch_snap_counts(seasons)
    empty = pd.DataFrame(columns=["team", "season", "week", "snap_weighted_injury_severity"])
    if inj.empty or snaps.empty:
        return empty

    snaps = snaps.copy()
    snaps["norm_name"] = snaps["player"].map(_normalize_name)
    snaps["snap_share"] = snaps[["offense_pct", "defense_pct"]].max(axis=1).fillna(0)
    snaps = snaps.sort_values(["team", "norm_name", "season", "week"])
    grp = snaps.groupby(["team", "norm_name", "season"], group_keys=False)
    snaps["typical_share"] = grp["snap_share"].apply(lambda s: s.shift(1).expanding().mean())
    share_lookup = snaps[["team", "norm_name", "season", "week", "typical_share"]]

    inj = inj.copy()
    inj["norm_name"] = inj["full_name"].map(_normalize_name)
    severity_weight = {"Out": 1.0, "Doubtful": 1.0, "Questionable": 0.5}
    inj["weight"] = inj["report_status"].map(severity_weight).fillna(0)
    inj = inj[inj["weight"] > 0]
    inj = inj.merge(share_lookup, on=["team", "norm_name", "season", "week"], how="left")
    inj["typical_share"] = inj["typical_share"].fillna(0)
    inj["severity"] = inj["weight"] * inj["typical_share"]

    out = inj.groupby(["team", "season", "week"])["severity"].sum().rename("snap_weighted_injury_severity").reset_index()
    return out


def _field_position_situational(seasons) -> pd.DataFrame:
    """Starting-field-position and situational context, all from pbp:
    - start_field_pos: avg distance to the opponent's goal line at the start
      of each of the team's drives (higher = better starting position,
      reflects special teams / turnover-margin hidden yardage).
    - start_ep: avg expected-points value of that starting position/down —
      a more principled version of raw field position since it accounts for
      situation, not just yardline.
    - redzone_td_rate: of drives that reached the red zone, the % that ended
      in a touchdown (finishing drives, not just moving the ball).
    - third_down_rate: conversion rate on third downs.
    - pressure_rate_faced: share of dropbacks where the offense's QB was
      sacked or hit — o-line/protection quality the box score doesn't show.
    """
    pbp = fetch.fetch_pbp(seasons)
    cols = ["start_field_pos", "start_ep", "redzone_td_rate", "third_down_rate", "pressure_rate_faced"]
    empty = pd.DataFrame(columns=["team", "season", "week"] + [f"l3_{c}" for c in cols])
    if pbp.empty:
        return empty
    pbp = pbp[pbp["posteam"].notna()].copy()

    drive_start = (
        pbp.sort_values(["game_id", "fixed_drive", "play_id"])
        .groupby(["game_id", "fixed_drive", "posteam", "season", "week"])
        .first()
        .reset_index()
    )
    drive_start["field_pos"] = 100 - drive_start["yardline_100"]
    fp_agg = drive_start.groupby(["posteam", "season", "week"]).agg(
        start_field_pos=("field_pos", "mean"),
        start_ep=("ep", "mean"),
    ).reset_index()

    rz = drive_start[drive_start["drive_inside20"] == 1].copy()
    rz["is_td"] = rz["fixed_drive_result"] == "Touchdown"
    rz_agg = rz.groupby(["posteam", "season", "week"]).agg(
        redzone_trips=("is_td", "size"), redzone_tds=("is_td", "sum"),
    ).reset_index()
    rz_agg["redzone_td_rate"] = rz_agg["redzone_tds"] / rz_agg["redzone_trips"].clip(lower=1)

    third = pbp[(pbp["third_down_converted"] == 1) | (pbp["third_down_failed"] == 1)].copy()
    third_agg = third.groupby(["posteam", "season", "week"]).agg(
        third_down_rate=("third_down_converted", "mean"),
    ).reset_index()

    dropbacks = pbp[pbp["pass"] == 1].copy()
    dropbacks["pressured"] = ((dropbacks["qb_hit"] == 1) | (dropbacks["sack"] == 1)).astype(int)
    pressure_agg = dropbacks.groupby(["posteam", "season", "week"]).agg(
        pressure_rate_faced=("pressured", "mean"),
    ).reset_index()

    merged = fp_agg.merge(rz_agg[["posteam", "season", "week", "redzone_td_rate"]], on=["posteam", "season", "week"], how="left")
    merged = merged.merge(third_agg, on=["posteam", "season", "week"], how="left")
    merged = merged.merge(pressure_agg, on=["posteam", "season", "week"], how="left")
    merged = merged.rename(columns={"posteam": "team"})
    return _roll_l3(merged, cols)


# Signed transforms (sign(x)*x**2, sign(x)*sqrt(|x|)) preserve direction —
# unlike a plain square/sqrt, which would treat a strong negative value (bad
# team) as identical to an equally strong positive one (good team).
def _signed_square(s: pd.Series) -> pd.Series:
    return np.sign(s) * s ** 2


def _signed_sqrt(s: pd.Series) -> pd.Series:
    return np.sign(s) * np.sqrt(np.abs(s))


# Bouzianis (2019) found nonlinear transforms of cumulative starting field
# position were independently significant predictors on top of the raw value
# (their single most consistent finding across 32 per-team models) — applied
# here to our closest analogues: field position itself, its EP-adjusted
# version, Elo, and season-to-date grade. Transforms are computed on each
# team's own raw feature value (matching their methodology) before the
# home-minus-away diff is taken in build_game_table, not after.
NONLINEAR_TRANSFORM_SOURCE_COLS = ["elo", "l3_start_field_pos", "l3_start_ep", "cum_overall_grade"]


def _add_nonlinear_transforms(feats: pd.DataFrame) -> pd.DataFrame:
    df = feats.copy()
    for col in NONLINEAR_TRANSFORM_SOURCE_COLS:
        df[f"sq_{col}"] = _signed_square(df[col])
        df[f"sqrt_{col}"] = _signed_sqrt(df[col])
    return df


def build_team_features(seasons) -> pd.DataFrame:
    """One row per (team, season, week): every pregame feature this spike
    uses, keyed the same way as team_week/grades so it can be merged onto
    both the home and away side of a schedule row."""
    schedule = load_schedule()
    team_week = load_team_week()
    grades = load_grades()

    elo = build_elo_index(schedule)
    elo_home = schedule[["game_id", "home_team"]].merge(elo, on="game_id")[["game_id", "home_team", "elo_home"]]
    elo_away = schedule[["game_id", "away_team"]].merge(elo, on="game_id")[["game_id", "away_team", "elo_away"]]
    elo_by_team = pd.concat(
        [
            elo_home.rename(columns={"home_team": "team", "elo_home": "elo"}),
            elo_away.rename(columns={"away_team": "team", "elo_away": "elo"}),
        ],
        ignore_index=True,
    ).merge(schedule[["game_id", "season", "week"]], on="game_id")[["team", "season", "week", "game_id", "elo"]]

    trend = _rolling_trend(team_week)
    surprise = _surprise_rolling(team_week)
    cum_grades = _cumulative_grades(grades)
    pbp_roll = _pbp_rolling(seasons)
    qb_cont = _qb_continuity(schedule)
    injuries = _injury_severity(seasons)
    snap_injury = _snap_weighted_injury_severity(seasons)
    ngs_roll = _ngs_rolling(seasons)
    ftn_roll = _ftn_rolling(seasons)
    field_pos = _field_position_situational(seasons)

    feats = qb_cont.merge(elo_by_team, on=["team", "season", "week", "game_id"], how="left")
    feats = feats.merge(trend, on=["team", "season", "week"], how="left")
    feats = feats.merge(surprise, on=["team", "season", "week"], how="left")
    feats = feats.merge(cum_grades, on=["team", "season", "week"], how="left")
    feats = feats.merge(pbp_roll, on=["team", "season", "week"], how="left")
    feats = feats.merge(injuries, on=["team", "season", "week"], how="left")
    feats = feats.merge(snap_injury, on=["team", "season", "week"], how="left")
    feats = feats.merge(ngs_roll, on=["team", "season", "week"], how="left")
    feats = feats.merge(ftn_roll, on=["team", "season", "week"], how="left")
    feats = feats.merge(field_pos, on=["team", "season", "week"], how="left")
    feats["injury_out_count"] = feats["injury_out_count"].fillna(0)
    feats["qb_listed_out"] = feats["qb_listed_out"].fillna(0)
    feats["snap_weighted_injury_severity"] = feats["snap_weighted_injury_severity"].fillna(0)
    feats = _add_nonlinear_transforms(feats)
    return feats


# Baseline feature set (the original run_spike.py result — market-inefficiency
# question #1: does ML beat the market at all).
BASELINE_FEATURE_COLS = [
    "elo", "l3_points_margin", "l3_epa_diff", "l3_turnover_margin",
    "cum_overall_grade", "cum_offense_grade", "cum_defense_grade",
    "l3_success_rate", "l3_explosive_rate", "qb_changed",
    "injury_out_count", "qb_listed_out",
]
FEATURE_COLS = BASELINE_FEATURE_COLS  # kept for run_spike.py backward-compat

# Question #2: does tracking-derived NGS + charted pre-snap/scheme context (FTN)
# add anything on top of the baseline? Split so each source can be isolated —
# the combined "extended" run made things mildly worse on ATS, and FTN's much
# shorter history (2022-2025 vs NGS's 2016-2025) was the suspected culprit;
# testing them separately (2026-07-24 follow-up) tells them apart.
NGS_FEATURE_COLS = [
    "l3_time_to_throw", "l3_pass_cpoe", "l3_aggressiveness",
    "l3_rush_yoe", "l3_box8_rate", "l3_separation", "l3_cushion", "l3_yac_above_exp",
]
FTN_FEATURE_COLS = [
    "l3_motion_rate", "l3_play_action_rate", "l3_rpo_rate",
    "l3_box_count_faced", "l3_blitz_rate", "l3_drop_rate", "l3_contested_rate",
]
NEW_FEATURE_COLS = NGS_FEATURE_COLS + FTN_FEATURE_COLS
EXTENDED_FEATURE_COLS = BASELINE_FEATURE_COLS + NEW_FEATURE_COLS
NGS_ONLY_FEATURE_COLS = BASELINE_FEATURE_COLS + NGS_FEATURE_COLS
FTN_ONLY_FEATURE_COLS = BASELINE_FEATURE_COLS + FTN_FEATURE_COLS

# Question #3 (this round): snap-count-weighted injury severity, granular
# pass/rush EPA, starting field position/expected points, red-zone/third-down/
# pressure situational context — requested feature engineering on top of the
# baseline + NGS (FTN excluded here: already shown not to help and its short
# 2022-2025 history hurts more than the tracking data helps).
ENGINEERED_FEATURE_COLS = [
    "snap_weighted_injury_severity",
    "l3_pass_epa_diff", "l3_rush_epa_diff",
    "l3_start_field_pos", "l3_start_ep",
    "l3_redzone_td_rate", "l3_third_down_rate", "l3_pressure_rate_faced",
]
ROUND3_FEATURE_COLS = BASELINE_FEATURE_COLS + NGS_FEATURE_COLS + ENGINEERED_FEATURE_COLS

# Round 4: signed square/sqrt transforms of the 4 features closest to
# Bouzianis (2019)'s validated nonlinear predictors, on top of round 3.
NONLINEAR_FEATURE_COLS = (
    [f"sq_{c}" for c in NONLINEAR_TRANSFORM_SOURCE_COLS] + [f"sqrt_{c}" for c in NONLINEAR_TRANSFORM_SOURCE_COLS]
)
ROUND4_FEATURE_COLS = ROUND3_FEATURE_COLS + NONLINEAR_FEATURE_COLS

# Round 5 (of the feature-engineering track — 7th round of the session overall):
# "overreaction" features (Vergin, 2001) — how much of an outlier a team's most
# recent game was relative to its established baseline, on the theory that the
# betting market overreacts to it and a model that doesn't share that bias
# could diverge from the market specifically in these games.
SURPRISE_FEATURE_COLS = ["surprise_points_margin", "surprise_epa_diff"]
ROUND5_FEATURE_COLS = ROUND4_FEATURE_COLS + SURPRISE_FEATURE_COLS

# Union of every feature column across all rounds — build_game_table merges
# this whole set once so any round's *_FEATURE_COLS subset can be sliced out
# of the same game table without re-merging per experiment.
ALL_FEATURE_COLS = list(dict.fromkeys(EXTENDED_FEATURE_COLS + ROUND5_FEATURE_COLS))


def build_game_table(seasons) -> pd.DataFrame:
    """One row per REG-season game with completed scores: model inputs (home
    minus away for every feature in FEATURE_COLS, plus home/away/div/rest/
    weather context), targets (home_win, home_covers), and columns kept aside
    for evaluation only (spread_line, moneylines) — deliberately EXCLUDED from
    the feature set so ATS accuracy actually measures something against the
    market instead of just re-deriving the market's own line.
    """
    schedule = load_schedule()
    games = schedule[
        (schedule["game_type"] == "REG")
        & schedule["season"].isin(seasons)
        & schedule["home_score"].notna()
        & schedule["away_score"].notna()
    ].copy()

    team_feats = build_team_features(seasons)
    hf = team_feats.rename(columns={c: f"home_{c}" for c in ALL_FEATURE_COLS}).rename(columns={"team": "home_team"})
    af = team_feats.rename(columns={c: f"away_{c}" for c in ALL_FEATURE_COLS}).rename(columns={"team": "away_team"})

    games = games.merge(
        hf[["home_team", "season", "week", "game_id"] + [f"home_{c}" for c in ALL_FEATURE_COLS]],
        on=["home_team", "season", "week", "game_id"],
        how="left",
    )
    games = games.merge(
        af[["away_team", "season", "week", "game_id"] + [f"away_{c}" for c in ALL_FEATURE_COLS]],
        on=["away_team", "season", "week", "game_id"],
        how="left",
    )

    for c in ALL_FEATURE_COLS:
        games[f"diff_{c}"] = games[f"home_{c}"] - games[f"away_{c}"]

    games["is_dome"] = games["roof"].isin(DOME_ROOFS).astype(int)
    games["wind"] = games["wind"].fillna(0)
    games["temp"] = games["temp"].fillna(games["temp"].median())
    games["rest_diff"] = games["home_rest"].fillna(7) - games["away_rest"].fillna(7)
    games["div_game"] = games["div_game"].fillna(0).astype(int)

    home_margin = games["home_score"] - games["away_score"]
    games["home_margin"] = home_margin  # regression target for margin_regression.py
    games["home_win"] = (home_margin > 0).astype(int)
    games["home_covers"] = np.where(
        games["spread_line"].notna(),
        np.sign(home_margin + games["spread_line"].fillna(0)),
        np.nan,
    )
    # push (exact tie against the spread) -> exclude from ATS evaluation, not a 0/1 label
    games.loc[games["home_covers"] == 0, "home_covers"] = np.nan
    games["home_covers"] = games["home_covers"].map({1: 1, -1: 0})

    # Evaluation-only baselines (never fed into the ML feature set): the
    # market's own vig-free moneyline prob and the existing app's Elo model,
    # so the trained model can be judged against both, not in a vacuum.
    elo_idx = build_elo_index(schedule)[["game_id", "elo_p_home"]]
    games = games.merge(elo_idx, on="game_id", how="left")
    games["market_home_fair"] = _fair_home_prob(games["away_moneyline"], games["home_moneyline"])

    return games


def _implied_prob(ml: pd.Series) -> pd.Series:
    ml = pd.to_numeric(ml, errors="coerce")
    return np.where(ml > 0, 100 / (ml + 100), -ml / (-ml + 100))


def _fair_home_prob(away_ml: pd.Series, home_ml: pd.Series) -> pd.Series:
    pa = _implied_prob(away_ml)
    ph = _implied_prob(home_ml)
    total = pa + ph
    with np.errstate(invalid="ignore", divide="ignore"):
        fair_home = np.where(np.isfinite(total) & (total > 0), ph / total, np.nan)
    return fair_home


_CONTEXT_COLS = ["is_dome", "wind", "temp", "rest_diff", "div_game"]
BASELINE_DIFF_FEATURE_COLS = [f"diff_{c}" for c in BASELINE_FEATURE_COLS] + _CONTEXT_COLS
EXTENDED_DIFF_FEATURE_COLS = [f"diff_{c}" for c in EXTENDED_FEATURE_COLS] + _CONTEXT_COLS
NGS_ONLY_DIFF_FEATURE_COLS = [f"diff_{c}" for c in NGS_ONLY_FEATURE_COLS] + _CONTEXT_COLS
FTN_ONLY_DIFF_FEATURE_COLS = [f"diff_{c}" for c in FTN_ONLY_FEATURE_COLS] + _CONTEXT_COLS
ROUND3_DIFF_FEATURE_COLS = [f"diff_{c}" for c in ROUND3_FEATURE_COLS] + _CONTEXT_COLS
ROUND4_DIFF_FEATURE_COLS = [f"diff_{c}" for c in ROUND4_FEATURE_COLS] + _CONTEXT_COLS
ROUND5_DIFF_FEATURE_COLS = [f"diff_{c}" for c in ROUND5_FEATURE_COLS] + _CONTEXT_COLS
DIFF_FEATURE_COLS = BASELINE_DIFF_FEATURE_COLS  # kept for run_spike.py backward-compat
