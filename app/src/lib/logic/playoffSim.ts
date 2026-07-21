// Playoff probability Monte Carlo simulation — new analytics (not a port).
// `throughWeek` is the "as of" week: games at or before it use their actual
// result (even if more of the season has since been played in the data —
// this is what makes the page backtestable at any past week), games after it
// are simulated by drawing a winner from each team's Elo rating AS OF
// throughWeek (frozen for the rest of the sim — a team's strength doesn't
// evolve mid-simulation; a true week-by-week Elo update during the Monte
// Carlo loop would be more accurate but is out of scope here).
//
// Tiebreaker is a SIMPLIFIED approximation of the real NFL rulebook, not a
// full implementation: win% -> head-to-head (only when the two teams' games
// against each other are lopsided one way) -> conference record -> point
// differential from games at/before throughWeek (not simulated, since the
// sim only draws winners, not margins). Real playoff seeding also weighs
// strength of victory/schedule, common-games records, and net points within
// the conference/overall — deliberately out of scope here; documented in
// docs/IMPLEMENTATION_LOG.md and the page's own UI copy.
import type { Row } from "../data/loader";
import { eloPHome, scheduleToEloGames, buildEloRatingHistory, ELO_INIT } from "./elo";
import { indexEloHistoryByTeam, eloAsOf } from "./powerRankings";

export interface TeamConfDiv {
  conference: string;
  division: string;
}

export interface PlayoffSimResult {
  team: string;
  conference: string;
  division: string;
  playoffPct: number;
  divisionTitlePct: number;
  avgWins: number;
  /** Average seed (1-7) among simulations where the team made the playoffs; null if it never did. */
  avgSeed: number | null;
}

interface TeamState {
  w: number;
  l: number;
  t: number;
  confW: number;
  confL: number;
  confT: number;
  /** Point differential from played games only — final tiebreaker proxy. */
  pd: number;
}

export function simulatePlayoffs(
  schedule: Row[],
  season: number,
  teamMeta: Map<string, TeamConfDiv>,
  iterations = 2000,
  throughWeek: number = Infinity,
): PlayoffSimResult[] {
  const games = schedule.filter(
    (g) => Number(g.season) === season && g.game_type === "REG" && teamMeta.has(String(g.home_team)) && teamMeta.has(String(g.away_team)),
  );
  const played = games.filter((g) => Number(g.week) <= throughWeek && g.home_score != null && g.away_score != null);
  const remaining = games.filter((g) => Number(g.week) > throughWeek || g.home_score == null || g.away_score == null);
  const teams = [...teamMeta.keys()].filter((t) => games.some((g) => String(g.home_team) === t || String(g.away_team) === t));
  if (!teams.length) return [];

  // Frozen "as of throughWeek" Elo rating per team, used for every remaining
  // game's win probability (see header comment on why this is frozen, not
  // re-derived from the schedule's actual later results).
  const eloByTeam = indexEloHistoryByTeam(buildEloRatingHistory(scheduleToEloGames(schedule)));
  const frozenElo = new Map<string, number>(teams.map((t) => [t, eloAsOf(eloByTeam, t, season, throughWeek)]));

  const base = new Map<string, TeamState>(teams.map((t) => [t, { w: 0, l: 0, t: 0, confW: 0, confL: 0, confT: 0, pd: 0 }]));
  const h2hBase = new Map<string, number>(); // `${winner}|${loser}` -> wins, played games only

  for (const g of played) {
    const ht = String(g.home_team);
    const at = String(g.away_team);
    const hs = Number(g.home_score);
    const as_ = Number(g.away_score);
    const sameConf = teamMeta.get(ht)!.conference === teamMeta.get(at)!.conference;
    const hb = base.get(ht)!;
    const ab = base.get(at)!;
    hb.pd += hs - as_;
    ab.pd += as_ - hs;
    if (hs > as_) {
      hb.w++;
      ab.l++;
      if (sameConf) {
        hb.confW++;
        ab.confL++;
      }
      h2hBase.set(`${ht}|${at}`, (h2hBase.get(`${ht}|${at}`) ?? 0) + 1);
    } else if (as_ > hs) {
      ab.w++;
      hb.l++;
      if (sameConf) {
        ab.confW++;
        hb.confL++;
      }
      h2hBase.set(`${at}|${ht}`, (h2hBase.get(`${at}|${ht}`) ?? 0) + 1);
    } else {
      hb.t++;
      ab.t++;
      if (sameConf) {
        hb.confT++;
        ab.confT++;
      }
    }
  }

  const winsTotal = new Map<string, number>(teams.map((t) => [t, 0]));
  const playoffCount = new Map<string, number>(teams.map((t) => [t, 0]));
  const divTitleCount = new Map<string, number>(teams.map((t) => [t, 0]));
  const seedSum = new Map<string, number>(teams.map((t) => [t, 0]));

  const byConfDiv = new Map<string, string[]>();
  for (const t of teams) {
    const m = teamMeta.get(t)!;
    const k = `${m.conference}|${m.division}`;
    if (!byConfDiv.has(k)) byConfDiv.set(k, []);
    byConfDiv.get(k)!.push(t);
  }
  const conferences = [...new Set(teams.map((t) => teamMeta.get(t)!.conference))];

  for (let iter = 0; iter < iterations; iter++) {
    const state = new Map<string, TeamState>(teams.map((t) => [t, { ...base.get(t)! }]));
    const h2h = new Map(h2hBase);

    for (const g of remaining) {
      const ht = String(g.home_team);
      const at = String(g.away_team);
      const pHome = eloPHome(frozenElo.get(at) ?? ELO_INIT, frozenElo.get(ht) ?? ELO_INIT);
      const homeWins = Math.random() < pHome;
      const sameConf = teamMeta.get(ht)!.conference === teamMeta.get(at)!.conference;
      const hs = state.get(ht)!;
      const as_ = state.get(at)!;
      if (homeWins) {
        hs.w++;
        as_.l++;
        if (sameConf) {
          hs.confW++;
          as_.confL++;
        }
        h2h.set(`${ht}|${at}`, (h2h.get(`${ht}|${at}`) ?? 0) + 1);
      } else {
        as_.w++;
        hs.l++;
        if (sameConf) {
          as_.confW++;
          hs.confL++;
        }
        h2h.set(`${at}|${ht}`, (h2h.get(`${at}|${ht}`) ?? 0) + 1);
      }
    }

    for (const t of teams) winsTotal.set(t, winsTotal.get(t)! + state.get(t)!.w);

    const winPct = (b: TeamState) => (b.w + 0.5 * b.t) / Math.max(1, b.w + b.l + b.t);
    const confPct = (b: TeamState) => (b.confW + 0.5 * b.confT) / Math.max(1, b.confW + b.confL + b.confT);
    const compare = (a: string, b: string): number => {
      const sa = state.get(a)!;
      const sb = state.get(b)!;
      const pctDiff = winPct(sb) - winPct(sa);
      if (pctDiff !== 0) return pctDiff;
      const aOverB = h2h.get(`${a}|${b}`) ?? 0;
      const bOverA = h2h.get(`${b}|${a}`) ?? 0;
      if (aOverB !== bOverA) return bOverA - aOverB;
      const confDiff = confPct(sb) - confPct(sa);
      if (confDiff !== 0) return confDiff;
      return sb.pd - sa.pd;
    };

    for (const conf of conferences) {
      const divisions = [...byConfDiv.keys()].filter((k) => k.startsWith(`${conf}|`));
      const divWinners: string[] = [];
      const remainder: string[] = [];
      for (const dk of divisions) {
        const ordered = [...byConfDiv.get(dk)!].sort(compare);
        divWinners.push(ordered[0]);
        remainder.push(...ordered.slice(1));
      }
      divWinners.sort(compare);
      remainder.sort(compare);
      const wildcards = remainder.slice(0, 3);
      [...divWinners, ...wildcards].forEach((t, i) => {
        playoffCount.set(t, playoffCount.get(t)! + 1);
        seedSum.set(t, seedSum.get(t)! + (i + 1));
      });
      divWinners.forEach((t) => divTitleCount.set(t, divTitleCount.get(t)! + 1));
    }
  }

  return teams
    .map((t) => {
      const m = teamMeta.get(t)!;
      const made = playoffCount.get(t)!;
      return {
        team: t,
        conference: m.conference,
        division: m.division,
        playoffPct: made / iterations,
        divisionTitlePct: divTitleCount.get(t)! / iterations,
        avgWins: winsTotal.get(t)! / iterations,
        avgSeed: made ? seedSum.get(t)! / made : null,
      };
    })
    .sort((a, b) => b.playoffPct - a.playoffPct);
}
