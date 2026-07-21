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

// Full display category set (Win Types, Spread Win %, the glossary): the 4
// real win types plus ties and the pre-game "no score yet" buckets, which are
// display buckets rather than results of `winType()`. Single source of truth
// for color — every page importing its own copy of these hex values was a
// standing DRY problem (audit cross-page review).
export type Category = WinType | "Tie" | "Favorite Home (No Score)" | "Favorite Away (No Score)" | "No Favorite";

export const CATEGORY_COLORS: Record<Category, string> = {
  ...WIN_TYPE_COLORS,
  Tie: "#9333ea",
  "Favorite Home (No Score)": NO_SCORE_COLOR,
  "Favorite Away (No Score)": "#8B4513",
  "No Favorite": "#e0e0e0",
};

// Short codes for non-color redundancy on chart segments/badges that can't
// fit a full category name (stacked-bar labels, compact corner badges).
export const CATEGORY_CODES: Record<Category, string> = {
  "Favorite home": "FH",
  "Favorite away": "FA",
  "Underdog home": "UH",
  "Underdog away": "UA",
  Tie: "T",
  "Favorite Home (No Score)": "FH*",
  "Favorite Away (No Score)": "FA*",
  "No Favorite": "NF",
};

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
