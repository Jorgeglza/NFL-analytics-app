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
        label: "Win Types",
        path: "/game_analysis/win_types",
        description: "Win-type distribution across seasons and weeks with favorite/home KPIs",
        implemented: true,
      },
      {
        label: "Team Comparison",
        path: "/game_analysis/team_comparison",
        description: "Head-to-head stat comparison with ranks, grades and trend charts",
        implemented: true,
      },
      {
        label: "Scorecards Teams",
        path: "/game_analysis/scorecards_teams",
        description: "Team playstyle dashboard — pass/rush splits and stat sparklines",
        implemented: true,
      },
      {
        label: "Spread Win Percentage",
        path: "/game_analysis/spread_win_percentage",
        description: "Favorite win rates by spread bucket, calibration curves and weekly picks",
        implemented: true,
      },
      {
        label: "Matchup Previews",
        path: "/game_analysis/matchup_previews",
        description: "Game previews with spread pick engine, trend edges and model accuracy",
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
    ],
  },
];
