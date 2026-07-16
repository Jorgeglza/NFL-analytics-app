// Win-type classification — port of data_utils.py:calculate_win_flags.
// spread_line is home-perspective (negative => home favored).

export type Side = "home" | "away";
export type WinType =
  | "Favorite home"
  | "Favorite away"
  | "Underdog home"
  | "Underdog away";

export const WIN_TYPE_COLORS: Record<WinType, string> = {
  "Favorite home": "#3C9A5F",
  "Favorite away": "#2459A7",
  "Underdog home": "#E87722",
  "Underdog away": "#C8102E",
};

export const NO_SCORE_COLOR = "#D4AF37";

export function winner(homeScore: number | null, awayScore: number | null): Side | "tie" | null {
  if (homeScore == null || awayScore == null) return null;
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "tie";
}

export function favorite(spreadLine: number | null): Side | "none" | null {
  if (spreadLine == null || Number.isNaN(spreadLine)) return null;
  if (spreadLine < 0) return "home";
  if (spreadLine > 0) return "away";
  return "none";
}

export function winType(
  homeScore: number | null,
  awayScore: number | null,
  spreadLine: number | null,
): WinType | null {
  const w = winner(homeScore, awayScore);
  const f = favorite(spreadLine);
  if (w == null || w === "tie" || f == null || f === "none") return null;
  if (f === w) return w === "home" ? "Favorite home" : "Favorite away";
  return w === "home" ? "Underdog home" : "Underdog away";
}
