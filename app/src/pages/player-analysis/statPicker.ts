// Shared stat-picker + hit-rate presentation helpers for the player pages
// (UX audit §8/§9: curated sectioned stat list, readable labels, consistent
// hit/miss colors, implied fair odds, lightweight headshots).

export type Side = "offense" | "defense";

// Stats actually offered at sportsbooks, listed first in the picker,
// sectioned by play type.
export const PROP_MARKET_SECTIONS: Record<Side, { label: string; stats: string[] }[]> = {
  offense: [
    { label: "Passing", stats: ["passing_yards", "passing_tds", "completions", "attempts", "interceptions"] },
    { label: "Rushing", stats: ["rushing_yards", "rushing_tds", "carries"] },
    { label: "Receiving", stats: ["receiving_yards", "receptions", "targets", "receiving_tds"] },
    { label: "Fantasy", stats: ["fantasy_points", "fantasy_points_ppr"] },
  ],
  defense: [
    {
      label: "Defense",
      stats: [
        "def_sacks", "def_tackles_solo", "def_tackle_assists", "def_tackles_for_loss",
        "def_interceptions", "def_pass_defended", "def_qb_hits", "def_fumbles_forced",
      ],
    },
  ],
};

const ACRONYMS = new Set(["epa", "pacr", "racr", "wopr", "cpoe", "ppr", "fg", "pat", "qb", "gwfg"]);
const WORD_OVERRIDES: Record<string, string> = { tds: "TDs", td: "TD", "2pt": "2-pt" };

export function statLabel(c: string): string {
  return c
    .split("_")
    .filter(Boolean)
    .map((w) => WORD_OVERRIDES[w] ?? (ACRONYMS.has(w) ? w.toUpperCase() : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Grouped options for <Select groups>: prop-market sections first, the rest alphabetical. */
export function buildStatGroups(sideCols: string[], side: Side) {
  const sections = PROP_MARKET_SECTIONS[side].map((s) => ({
    label: s.label,
    options: s.stats.filter((c) => sideCols.includes(c)).map((c) => ({ value: c, label: statLabel(c) })),
  }));
  const inSection = new Set(sections.flatMap((s) => s.options.map((o) => o.value)));
  const advanced = sideCols.filter((c) => !inSection.has(c)).sort();
  return [
    ...sections,
    { label: "Advanced / other", options: advanced.map((c) => ({ value: c, label: statLabel(c) })) },
  ];
}

/**
 * Same curation, for pages with no offense/defense toggle (Matchup Bets,
 * Value Bets — mismatch stats span both sides of the ball). Offense + defense
 * prop-market sections first, everything else (punting internals, etc.)
 * behind "Advanced / other" (audit §11/§12: the raw ~130-item list was the
 * worst instance of the shared stat-selector problem).
 */
export function buildMismatchStatGroups(cols: string[]) {
  const sections = [...PROP_MARKET_SECTIONS.offense, ...PROP_MARKET_SECTIONS.defense].map((s) => ({
    label: s.label,
    options: s.stats.filter((c) => cols.includes(c)).map((c) => ({ value: c, label: statLabel(c) })),
  }));
  const inSection = new Set(sections.flatMap((s) => s.options.map((o) => o.value)));
  const advanced = cols.filter((c) => !inSection.has(c)).sort();
  return [
    ...sections,
    { label: "Advanced / other", options: advanced.map((c) => ({ value: c, label: statLabel(c) })) },
  ];
}

/** A random element of `arr`, or undefined if empty. */
export function randomItem<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

const PASS_RUSH_REC_STATS = PROP_MARKET_SECTIONS.offense
  .filter((s) => s.label !== "Fantasy")
  .flatMap((s) => s.stats);

/** Random starting stat from Passing/Rushing/Receiving (excludes Fantasy). */
export function randomPassRushRecStat(): string {
  return randomItem(PASS_RUSH_REC_STATS) ?? "passing_yards";
}

export const HIT_COLOR = "#059669";
export const MISS_COLOR = "#dc2626";
export const NEUTRAL_COLOR = "#002f6c";

/** American fair odds for probability p (null at 0/1 where odds are undefined). */
export function americanOdds(p: number): string | null {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? `−${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`;
}

/**
 * NFL CDN face-cropped 160px square (rendered at 56–64px → ≥2.5x pixel
 * density, crisp on retina) instead of downscaling the full-size photo.
 */
export function headshotCrop(url: string): string {
  return url.replace("/f_auto,q_auto/", "/f_auto,q_auto,w_160,h_160,c_fill,g_face/");
}
