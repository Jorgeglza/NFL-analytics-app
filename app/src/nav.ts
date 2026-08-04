// Navigation structure — mirrors the Dash app's module dropdowns.
export interface NavPage {
  label: string;
  path: string;
  description: string;
  implemented: boolean;
}

export interface NavGroup {
  label: string;
  pages: NavPage[];
}

// Game Analysis order tells a story: make the pick (Game Picks) -> see how
// that kind of result plays out statistically (Spread Analytics — Win Rate
// & Calibration, a per-week Weekly Breakdown, and Win Types, each its own
// tab/sub-URL) -> see what the model itself recommends (Matchup Previews)
// -> drill into a specific hard call (Team Comparison) -> the full detail
// behind one team (Team Scorecard) -> the season-long payoff (Season
// Outlook — power rankings, strength of schedule and playoff probability,
// each its own tab/sub-URL).
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Game Analysis",
    pages: [
      {
        label: "Game Picks",
        path: "/game_analysis/game_picks",
        description: "Weekly results with favorite/underdog win types, spread scatter and pick tracking",
        implemented: true,
      },
      {
        label: "Spread Analytics",
        path: "/game_analysis/spread_win_percentage",
        description: "Favorite win rates by spread bucket, a per-week upset/rank breakdown, and win-type distribution across seasons and weeks",
        implemented: true,
      },
      {
        label: "Matchup Previews",
        path: "/game_analysis/matchup_previews",
        description: "Game previews with spread pick engine, trend edges and model accuracy",
        implemented: true,
      },
      {
        label: "Team Comparison",
        path: "/game_analysis/team_comparison",
        description: "Head-to-head stat comparison with ranks, grades and trend charts",
        implemented: true,
      },
      {
        label: "Team Scorecard",
        path: "/game_analysis/scorecards_teams",
        description: "Team playstyle dashboard — pass/rush splits and stat sparklines",
        implemented: true,
      },
      {
        label: "Season Outlook",
        path: "/game_analysis/season_outlook",
        description: "Power rankings, strength of schedule and playoff probability — the state of the league and the road ahead",
        implemented: true,
      },
    ],
  },
  {
    label: "Player Analysis",
    pages: [
      {
        label: "Prop Bets Players",
        path: "/player_analysis/prop_bets_players",
        description: "Player weekly stats vs a prop line — hit rates and week-by-week detail",
        implemented: true,
      },
      {
        label: "Build Parlay",
        path: "/player_analysis/build_parlay",
        description: "Multi-leg parlay builder with combined probability and expected odds",
        implemented: true,
      },
      {
        label: "Player Team Stats",
        path: "/player_analysis/player_team_stats",
        description: "Top players per team across all divisions for any stat",
        implemented: true,
      },
      {
        label: "Value Bets",
        path: "/player_analysis/value_bets",
        description: "Weekly offense-vs-defense mismatch radar — zoom in on any game for the full single-game breakdown",
        implemented: true,
      },
    ],
  },
  {
    label: "Data",
    pages: [
      {
        label: "Grading Model",
        path: "/data/grading_model",
        description: "Random Forest team grades — season, team, weekly and feature views",
        implemented: true,
      },
      {
        label: "Predictive Model",
        path: "/data/predictive_model",
        description: "Margin-regression model explored against the market — performance, feature importance and calibration",
        implemented: true,
      },
    ],
  },
];
