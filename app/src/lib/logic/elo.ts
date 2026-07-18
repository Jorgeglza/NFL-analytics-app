// Elo power-rating model — new in Session 5 (not a port of the old app).
// Standard NFL Elo (538-style): init 1505, K=20, home-field +48 Elo, MOV
// multiplier ln(|margin|+1) * 2.2/(0.001*|eloDiff|+2.2), between-season
// regression r <- 2/3 r + 1/3 1505. Ratings are strictly pre-game: the index
// stores the ratings as they stood BEFORE each game, so there is no leakage.

export const ELO_INIT = 1505;
export const ELO_K = 20;
export const ELO_HFA = 48;
export const ELO_SEASON_REGRESS = 1 / 3;

// franchise relocations — carry the rating across the code change
const TEAM_ALIAS: Record<string, string> = { SD: "LAC", OAK: "LV", STL: "LA" };
export const eloTeamKey = (team: string): string => TEAM_ALIAS[team] ?? team;

/** p(home wins) from pre-game ratings (home-field advantage included). */
export function eloPHome(eloAway: number, eloHome: number): number {
  return 1 / (1 + Math.pow(10, -(eloHome + ELO_HFA - eloAway) / 400));
}

/** 538-style margin-of-victory multiplier. eloDiffWinner = winner elo (incl HFA) - loser elo. */
export function eloMovMultiplier(margin: number, eloDiffWinner: number): number {
  return Math.log(Math.abs(margin) + 1) * (2.2 / (0.001 * Math.abs(eloDiffWinner) + 2.2));
}

export interface EloGame {
  gameId: string;
  season: number;
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  /** epoch ms used only for ordering */
  order: number;
}

export interface EloEntry {
  eloAway: number;
  eloHome: number;
  pHome: number;
}

/**
 * One chronological pass over the games (any season span). Returns pre-game
 * ratings + p(home) per gameId. Unscored games get an entry (prediction) but
 * do not move ratings. Ties move ratings toward each other (actual = 0.5).
 */
export function buildEloIndex(games: EloGame[]): Map<string, EloEntry> {
  const sorted = [...games].sort((a, b) => a.order - b.order || a.gameId.localeCompare(b.gameId));
  const ratings = new Map<string, number>();
  const lastSeason = new Map<string, number>();
  const get = (team: string): number => ratings.get(eloTeamKey(team)) ?? ELO_INIT;
  const set = (team: string, v: number) => ratings.set(eloTeamKey(team), v);
  const out = new Map<string, EloEntry>();

  for (const g of sorted) {
    // regress each team once per new season
    for (const t of [g.awayTeam, g.homeTeam]) {
      const k = eloTeamKey(t);
      if (lastSeason.get(k) !== g.season) {
        if (lastSeason.has(k)) set(t, get(t) * (1 - ELO_SEASON_REGRESS) + ELO_INIT * ELO_SEASON_REGRESS);
        lastSeason.set(k, g.season);
      }
    }
    const ea = get(g.awayTeam);
    const eh = get(g.homeTeam);
    const pHome = eloPHome(ea, eh);
    out.set(g.gameId, { eloAway: ea, eloHome: eh, pHome });

    if (g.awayScore == null || g.homeScore == null) continue;
    const margin = g.homeScore - g.awayScore;
    const actualHome = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    // winner's effective elo diff for the MOV dampener (HFA on home side)
    const diffWinner = margin >= 0 ? eh + ELO_HFA - ea : ea - (eh + ELO_HFA);
    const mult = margin === 0 ? 1 : eloMovMultiplier(margin, diffWinner);
    const delta = ELO_K * mult * (actualHome - pHome);
    set(g.homeTeam, eh + delta);
    set(g.awayTeam, ea - delta);
  }
  return out;
}
