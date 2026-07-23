// Self-consistency tests for the new (non-ported) analytics added for Power
// Rankings / Season Outlook — no Python replica exists for these (see
// docs/IMPLEMENTATION_LOG.md), so these check structural invariants and
// directionally-obvious outcomes on small synthetic schedules instead of
// golden fixtures.
import { describe, expect, it } from "vitest";
import type { Row } from "../data/loader";
import { computePowerRankings } from "./powerRankings";
import { simulatePlayoffs, type TeamConfDiv } from "./playoffSim";
import { computeStrengthOfSchedule } from "../../pages/game-analysis/season-outlook/shared";

function game(
  gid: string,
  season: number,
  week: number,
  away: string,
  home: string,
  awayScore: number | null,
  homeScore: number | null,
): Row {
  return {
    game_id: gid,
    season,
    week,
    game_type: "REG",
    away_team: away,
    home_team: home,
    away_score: awayScore,
    home_score: homeScore,
    gameday: `2099-09-${String(week).padStart(2, "0")}`,
    spread_line: null,
  };
}

describe("computePowerRankings", () => {
  const schedule: Row[] = [
    game("g1", 2099, 1, "BB", "AA", 3, 30), // AA blows out BB
    game("g2", 2099, 2, "AA", "BB", 27, 10), // AA wins again
  ];
  const grades: Row[] = [
    { Team: "AA", Season: 2099, Week: 1, "Overall Grade": 90 },
    { Team: "AA", Season: 2099, Week: 2, "Overall Grade": 92 },
    { Team: "BB", Season: 2099, Week: 1, "Overall Grade": 40 },
    { Team: "BB", Season: 2099, Week: 2, "Overall Grade": 38 },
  ];

  it("ranks the dominant team #1 and assigns a complete 1..N permutation", () => {
    const rows = computePowerRankings(schedule, grades, 2099, 2);
    expect(rows.map((r) => r.rank).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(rows.find((r) => r.rank === 1)!.team).toBe("AA");
    expect(rows.find((r) => r.rank === 1)!.composite).toBeGreaterThan(rows.find((r) => r.rank === 2)!.composite);
  });

  it("has no movement at week 1 and tracks movement vs. the prior week after", () => {
    const wk1 = computePowerRankings(schedule, grades, 2099, 1);
    expect(wk1.every((r) => r.prevRank === null && r.movement === null)).toBe(true);

    const wk2 = computePowerRankings(schedule, grades, 2099, 2);
    for (const r of wk2) {
      expect(r.prevRank).toBe(wk1.find((w) => w.team === r.team)!.rank);
      expect(r.movement).toBe(r.prevRank! - r.rank);
    }
  });
});

describe("simulatePlayoffs", () => {
  // 4 divisions x 2 teams, one conference, every game already played (no
  // remaining games) — the sim is then fully deterministic regardless of
  // iteration count, since there's nothing left to draw randomly.
  const teamMeta = new Map<string, TeamConfDiv>(
    ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"].map((t) => [t, { conference: "CONF", division: `CONF ${t[0]}` }]),
  );
  const schedule: Row[] = [
    game("d1", 2099, 1, "A2", "A1", 10, 20), // A1 wins by 10
    game("d2", 2099, 1, "B2", "B1", 10, 15), // B1 wins by 5
    game("d3", 2099, 1, "C2", "C1", 10, 11), // C1 wins by 1
    game("d4", 2099, 1, "D2", "D1", 0, 30), // D1 wins by 30
  ];

  it("puts every division winner in the playoffs with a division title", () => {
    const results = simulatePlayoffs(schedule, 2099, teamMeta, 5);
    for (const t of ["A1", "B1", "C1", "D1"]) {
      const r = results.find((x) => x.team === t)!;
      expect(r.playoffPct).toBe(1);
      expect(r.divisionTitlePct).toBe(1);
      expect(r.avgWins).toBe(1);
    }
  });

  it("seeds the 3 closest losers as wildcards by point differential and excludes the blowout loser", () => {
    const results = simulatePlayoffs(schedule, 2099, teamMeta, 5);
    const byTeam = new Map(results.map((r) => [r.team, r]));
    // Losing margins: C2 -1, B2 -5, A2 -10, D2 -30 — the 3 closest make it.
    expect(byTeam.get("C2")!.playoffPct).toBe(1);
    expect(byTeam.get("B2")!.playoffPct).toBe(1);
    expect(byTeam.get("A2")!.playoffPct).toBe(1);
    expect(byTeam.get("D2")!.playoffPct).toBe(0);
    expect(byTeam.get("D2")!.avgSeed).toBeNull();
  });

  it("keeps every seed within 1..7 for teams that made the playoffs", () => {
    const results = simulatePlayoffs(schedule, 2099, teamMeta, 5);
    for (const r of results) {
      if (r.playoffPct > 0) {
        expect(r.avgSeed).not.toBeNull();
        expect(r.avgSeed!).toBeGreaterThanOrEqual(1);
        expect(r.avgSeed!).toBeLessThanOrEqual(7);
      }
    }
  });

  it("handles a remaining (unplayed) game without crashing, producing a probability strictly between 0 and 1 for an even matchup", () => {
    const withRemaining = [...schedule, game("d5", 2099, 2, "A2", "D2", null, null)];
    const results = simulatePlayoffs(withRemaining, 2099, teamMeta, 500);
    const a2 = results.find((r) => r.team === "A2")!;
    const d2 = results.find((r) => r.team === "D2")!;
    // Both were previously locked out/in — the coin-flip decider should soften both away from 0/1.
    expect(a2.playoffPct).toBeGreaterThan(0);
    expect(a2.playoffPct).toBeLessThan(1);
    expect(d2.playoffPct).toBeGreaterThan(0);
    expect(d2.playoffPct).toBeLessThan(1);
  });

  describe("throughWeek backtesting", () => {
    // Week 2 is ACTUALLY completed in the data (A2 beats D2 outright), but a
    // backtest "as of week 1" should ignore that known result and simulate
    // it instead — otherwise picking a past week wouldn't be a real backtest.
    const withWeek2: Row[] = [...schedule, game("d5", 2099, 2, "A2", "D2", 20, 0)];

    it("ignores actually-played games after throughWeek and simulates them instead", () => {
      const results = simulatePlayoffs(withWeek2, 2099, teamMeta, 500, 1);
      const a2 = results.find((r) => r.team === "A2")!;
      const d2 = results.find((r) => r.team === "D2")!;
      // If week 2's real result were used, A2 would be 1-0 (guaranteed in) and
      // D2 would be 0-2 (guaranteed out). Backtesting at week 1 must instead
      // draw a random winner, softening both away from 0/1.
      expect(a2.playoffPct).toBeGreaterThan(0);
      expect(a2.playoffPct).toBeLessThan(1);
      expect(d2.playoffPct).toBeGreaterThan(0);
      expect(d2.playoffPct).toBeLessThan(1);
    });

    it("uses the actual result once throughWeek reaches it", () => {
      const results = simulatePlayoffs(withWeek2, 2099, teamMeta, 5, 2);
      const a2 = results.find((r) => r.team === "A2")!;
      const d2 = results.find((r) => r.team === "D2")!;
      expect(a2.avgWins).toBe(1); // A1 win + A2 win over D2
      expect(d2.avgWins).toBe(0); // D1 loss (wk1) + D2 loss (wk2)
    });
  });
});

describe("computeStrengthOfSchedule throughWeek", () => {
  const schedule: Row[] = [
    game("s1", 2099, 1, "AA", "BB", 10, 20),
    game("s2", 2099, 2, "AA", "CC", 10, 20),
  ];

  it("moves a game from remaining to played once throughWeek passes its week (selected week itself counts as remaining, matching the heatmap)", () => {
    const atWeek1 = computeStrengthOfSchedule(schedule, 2099, 1);
    const aa1 = atWeek1.find((r) => r.team === "AA")!;
    expect(aa1.playedN).toBe(0);
    expect(aa1.remainingN).toBe(2);

    const atWeek2 = computeStrengthOfSchedule(schedule, 2099, 2);
    const aa2 = atWeek2.find((r) => r.team === "AA")!;
    expect(aa2.playedN).toBe(1);
    expect(aa2.remainingN).toBe(1);
  });
});
