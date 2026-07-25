// Human-readable explanations for the predictive model's features, shown on
// hover in ExplanationTab. Descriptions summarize pipeline/predictive_model/
// features.py's docstrings — keep in sync if a feature's definition changes.
// Keyed by the *underlying* (non-diff, non-sign-prefixed) feature name, e.g.
// "diff_l3_epa_diff" and "sq_elo" both look up under "elo"/"l3_epa_diff".

const DESCRIPTIONS: Record<string, string> = {
  elo: "Elo rating entering the game — an overall team-strength rating updated after every game (like chess ratings), independent of this season's grades or box scores.",
  l3_points_margin: "Average scoring margin (points for minus against) over the team's last 3 games, before this one.",
  l3_epa_diff: "Average EPA (expected points added) differential — offense minus defense — over the last 3 games. A broader efficiency measure than raw score margin.",
  l3_turnover_margin: "Average turnover margin (takeaways minus giveaways) over the last 3 games.",
  cum_overall_grade: "Season-to-date average overall grade, through the prior week (expanding average, not just recent form).",
  cum_offense_grade: "Season-to-date average offensive grade, through the prior week.",
  cum_defense_grade: "Season-to-date average defensive grade, through the prior week.",
  l3_success_rate: "Average play-success rate (per-play EPA benchmark) over the last 3 games, from play-by-play data.",
  l3_explosive_rate: "Average rate of explosive plays (runs of 12+ yards, passes of 20+ yards) over the last 3 games.",
  qb_changed: "1 if the team's announced starting QB for this game differs from who started their previous game, else 0.",
  injury_out_count: "Number of players listed Out or Doubtful on the injury report for this game.",
  qb_listed_out: "1 if the team's QB is listed Out or Doubtful for this game, else 0.",
  l3_time_to_throw: "Lead passer's average time-to-throw (seconds from snap to release), last 3 games — a proxy for pocket time / o-line protection.",
  l3_pass_cpoe: "Lead passer's completion percentage above expectation (NGS), last 3 games — accuracy adjusted for throw difficulty.",
  l3_aggressiveness: "Lead passer's aggressiveness rate (NGS) — share of attempts into tight coverage windows, last 3 games.",
  l3_rush_yoe: "Rush yards over expected per attempt (NGS), attempt-weighted, last 3 games — how much a team's run game outperforms blocking expectations.",
  l3_box8_rate: "Share of rush attempts run into an 8+ defender box (NGS), last 3 games.",
  l3_separation: "Target-weighted average receiver separation at catch point (NGS), last 3 games.",
  l3_cushion: "Target-weighted average cornerback cushion faced (NGS), last 3 games.",
  l3_yac_above_exp: "Target-weighted yards-after-catch above expectation (NGS), last 3 games.",
  snap_weighted_injury_severity: "Injury severity weighted by how many snaps the injured player typically plays — an Out starter counts far more than an Out backup.",
  l3_pass_epa_diff: "Passing EPA differential (own passing EPA minus opponents' passing EPA allowed), last 3 games.",
  l3_rush_epa_diff: "Rushing EPA differential (own rushing EPA minus opponents' rushing EPA allowed), last 3 games.",
  l3_start_field_pos: "Average starting field position (distance to opponent's goal line at drive start), last 3 games — reflects special teams and turnover-margin hidden yardage.",
  l3_start_ep: "Average expected points value of starting field position/down, last 3 games — a situation-aware version of field position.",
  l3_redzone_td_rate: "Share of red-zone trips that ended in a touchdown, last 3 games — finishing drives, not just moving the ball.",
  l3_third_down_rate: "Third-down conversion rate, last 3 games.",
  l3_pressure_rate_faced: "Share of dropbacks where the QB was sacked or hit, last 3 games — offensive line / protection quality.",
  is_dome: "1 if the game was played in a dome or with the roof closed, else 0. Game-level context, not a per-team stat.",
  wind: "Wind speed (mph) at kickoff. Game-level context, not a per-team stat.",
  temp: "Temperature (°F) at kickoff. Game-level context, not a per-team stat.",
  rest_diff: "Days of rest before this game: home team's rest minus away team's rest.",
  div_game: "1 if this is a divisional matchup, else 0. Game-level context, not a per-team stat.",
  surprise_points_margin: "How much of an outlier last week's scoring margin was versus the team's established baseline before that game — tests whether the market overreacts to recent results.",
  surprise_epa_diff: "How much of an outlier last week's EPA differential was versus the team's established baseline before that game.",
};

const SIGNED_TRANSFORM_PREFIX: Record<string, string> = {
  sq_: "Signed square (sign-preserving x²) of ",
  sqrt_: "Signed square root (sign-preserving √|x|) of ",
};

/** Strips the diff_/sq_/sqrt_ wrapper down to the underlying feature name
 * used as the description-lookup key. */
function underlyingKey(feature: string): { key: string; prefix: string | null } {
  const stripped = feature.replace(/^diff_/, "");
  for (const [prefix, label] of Object.entries(SIGNED_TRANSFORM_PREFIX)) {
    if (stripped.startsWith(prefix)) return { key: stripped.slice(prefix.length), prefix: label };
  }
  return { key: stripped, prefix: null };
}

/** Hover description for a feature column name (any of its raw/diff/sign-
 * transformed forms). Falls back to a generic note if not found. */
export function describeFeature(feature: string): string {
  const { key, prefix } = underlyingKey(feature);
  const base = DESCRIPTIONS[key];
  if (!base) return "No description available for this feature.";
  if (!prefix) return base;
  // Lowercase the base description's first letter so it reads naturally
  // after the transform prefix ("Signed square of elo rating entering...").
  return `${prefix}${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}
