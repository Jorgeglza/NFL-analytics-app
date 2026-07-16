// game_id parsing (validated — deviation #2 in docs/page-mapping.md).
// Format: YYYY_WW_AWAY_HOME, e.g. "2024_01_KC_MIA".

const GAME_ID_RE = /^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/;

export interface ParsedGameId {
  season: number;
  week: number;
  away: string;
  home: string;
}

export function parseGameId(gameId: string | null | undefined): ParsedGameId | null {
  if (!gameId) return null;
  const m = GAME_ID_RE.exec(gameId);
  if (!m) return null;
  return { season: Number(m[1]), week: Number(m[2]), away: m[3], home: m[4] };
}

/** "@OPP" when team plays away, "OPP" when home, "—" if unknown. */
export function opponentLabel(gameId: string | null | undefined, team: string): string {
  const p = parseGameId(gameId);
  if (!p) return "—";
  if (p.away === team) return `@${p.home}`;
  if (p.home === team) return p.away;
  return "—";
}
