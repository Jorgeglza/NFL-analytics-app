// "Edge-hunting in the coin-flip zone" — live recomputation of the factor-
// ranking analysis from the "Model vs. the Pool" artifact, run on this repo's
// own predictive-model exports (predictive_model/games.json +
// game_features.json, 2018–2025) instead of quoting the artifact's frozen
// numbers. See PickemRecommendationsTab's Story view.
//
// Method (mirrors the artifact): for each feature, "hit rate" is the share of
// games where that feature's sign (positive => home side favored on that
// stat) matched the actual winner, with an exact 0 counted as a coin flip
// (half credit). Games missing a feature value (no rolling history yet, e.g.
// week 1) are skipped for that feature only. The 41 raw model features are
// grouped into a handful of human-readable families by averaging member hit
// rates — the artifact's engineered sq/sqrt transforms of elo/start_field_pos/
// start_ep/cum_overall_grade are dropped entirely here (not just collapsed)
// since they duplicate their base factor's signal.
import type { Row } from "../data/loader";

export type Zone = "0-3" | "4-5" | "7+";

export interface FeatureGroup {
  key: string;
  label: string;
  /** Base (non-contrib/home/away) column names in game_features.json this group averages. */
  features: string[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  { key: "elo", label: "Elo rating", features: ["diff_elo"] },
  {
    key: "grade",
    label: "Team grade (season)",
    features: ["diff_cum_overall_grade", "diff_cum_offense_grade", "diff_cum_defense_grade"],
  },
  {
    key: "form",
    label: "Recent form (L3)",
    features: [
      "diff_l3_points_margin",
      "diff_l3_success_rate",
      "diff_l3_turnover_margin",
      "diff_l3_explosive_rate",
      "diff_l3_redzone_td_rate",
      "diff_l3_third_down_rate",
    ],
  },
  {
    key: "efficiency",
    label: "Efficiency & field position (L3)",
    features: [
      "diff_l3_epa_diff",
      "diff_l3_pass_epa_diff",
      "diff_l3_rush_epa_diff",
      "diff_l3_start_field_pos",
      "diff_l3_start_ep",
      "diff_l3_pass_cpoe",
      "diff_l3_time_to_throw",
      "diff_l3_aggressiveness",
      "diff_l3_separation",
      "diff_l3_cushion",
      "diff_l3_yac_above_exp",
      "diff_l3_pressure_rate_faced",
      "diff_l3_rush_yoe",
      "diff_l3_box8_rate",
    ],
  },
  {
    key: "qb_injury",
    label: "QB & injury status",
    features: ["diff_qb_changed", "diff_injury_out_count", "diff_qb_listed_out", "diff_snap_weighted_injury_severity"],
  },
  {
    key: "situational",
    label: "Situational (rest / dome / division / weather)",
    features: ["rest_diff", "is_dome", "div_game", "wind", "temp"],
  },
];

interface JoinedGame {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeWin: boolean | null;
  homeWinProb: number | null;
  absSpread: number | null;
  features: Row;
}

const joinKey = (r: { season?: unknown; week?: unknown; home_team?: unknown; away_team?: unknown }) =>
  `${r.season}|${r.week}|${r.home_team}|${r.away_team}`;

/** Joins games.json + game_features.json by (season, week, home_team, away_team). */
export function joinGamesAndFeatures(games: Row[], features: Row[]): JoinedGame[] {
  const byKey = new Map<string, Row>();
  for (const f of features) byKey.set(joinKey(f), f);
  const out: JoinedGame[] = [];
  for (const g of games) {
    const f = byKey.get(joinKey(g));
    if (!f) continue;
    const homeWin = g.home_win == null ? null : Number(g.home_win) === 1;
    const spread = g.spread_line == null ? null : Number(g.spread_line);
    out.push({
      season: Number(g.season),
      week: Number(g.week),
      homeTeam: String(g.home_team),
      awayTeam: String(g.away_team),
      homeWin,
      homeWinProb: g.home_win_prob == null ? null : Number(g.home_win_prob),
      absSpread: spread == null || Number.isNaN(spread) ? null : Math.abs(spread),
      features: f,
    });
  }
  return out;
}

export function zoneOf(absSpread: number | null): Zone | null {
  if (absSpread == null) return null;
  if (absSpread <= 3) return "0-3";
  if (absSpread <= 5) return "4-5";
  if (absSpread >= 7) return "7+";
  return null; // 5–7 pt gap: deliberately excluded, like the artifact's own three zones
}

/** ±1.96 SE around 50% for sample size n — the range a pure coin flip would
 * land in ~95% of the time (same formula the artifact used). */
export function coinFlipBand(n: number): { lo: number; hi: number; halfWidth: number } {
  const halfWidth = n > 0 ? 1.96 * Math.sqrt(0.25 / n) : 0.5;
  return { lo: 0.5 - halfWidth, hi: 0.5 + halfWidth, halfWidth };
}

/** Hit rate for one raw feature within a set of games: share of games where
 * the feature's sign (positive => home favored on that stat) matched the
 * actual winner, zero treated as a coin flip. Games missing the feature or a
 * final result are excluded, per-feature. */
function featureHitRate(games: JoinedGame[], feature: string): { hit: number; n: number } | null {
  let wins = 0;
  let n = 0;
  for (const g of games) {
    if (g.homeWin == null) continue;
    const v = g.features[feature];
    if (v == null) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    n++;
    const favorsHome = num > 0;
    const favorsAway = num < 0;
    if (favorsHome) wins += g.homeWin ? 1 : 0;
    else if (favorsAway) wins += g.homeWin ? 0 : 1;
    else wins += 0.5;
  }
  return n > 0 ? { hit: wins / n, n } : null;
}

export interface GroupResult {
  key: string;
  label: string;
  hit: number;
  /** Smallest per-feature N among the group's members (a conservative read of sample size). */
  n: number;
  members: { feature: string; hit: number; n: number }[];
}

/** Ranked, grouped factor hit-rates for one zone. */
export function edgeFactorsForZone(joined: JoinedGame[], zone: Zone): GroupResult[] {
  const inZone = joined.filter((g) => zoneOf(g.absSpread) === zone);
  const results: GroupResult[] = [];
  for (const grp of FEATURE_GROUPS) {
    const members = grp.features
      .map((f) => {
        const r = featureHitRate(inZone, f);
        return r ? { feature: f, hit: r.hit, n: r.n } : null;
      })
      .filter((m): m is { feature: string; hit: number; n: number } => m != null);
    if (!members.length) continue;
    const hit = members.reduce((s, m) => s + m.hit, 0) / members.length;
    const n = Math.min(...members.map((m) => m.n));
    results.push({ key: grp.key, label: grp.label, hit, n, members });
  }
  return results.sort((a, b) => b.hit - a.hit);
}

/** Model straight-up accuracy (home_win_prob > 0.5 predicts home win) within a zone. */
export function zoneModelAccuracy(joined: JoinedGame[], zone: Zone): { accuracy: number; hits: number; n: number } | null {
  const inZone = joined.filter((g) => zoneOf(g.absSpread) === zone && g.homeWin != null && g.homeWinProb != null);
  if (!inZone.length) return null;
  const hits = inZone.filter((g) => (g.homeWinProb! > 0.5) === g.homeWin).length;
  return { accuracy: hits / inZone.length, hits, n: inZone.length };
}

export function zoneGameCount(joined: JoinedGame[], zone: Zone): number {
  return joined.filter((g) => zoneOf(g.absSpread) === zone).length;
}

export type { JoinedGame };
