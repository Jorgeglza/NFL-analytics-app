// Audit 2026-11-12 M2/M3/M4: seeded playoff sim, neutral-site Elo, transitive
// tiebreak.
import { describe, expect, it } from "vitest";
import type { Row } from "../data/loader";
import { eloPHome, buildEloIndex, scheduleToEloGames, ELO_INIT } from "./elo";
import { mulberry32, simulatePlayoffs, type TeamConfDiv } from "./playoffSim";

const g = (gid: string, week: number, away: string, home: string, as: number | null, hs: number | null, location = "Home"): Row => ({
  game_id: gid,
  season: 2099,
  week,
  game_type: "REG",
  away_team: away,
  home_team: home,
  away_score: as,
  home_score: hs,
  gameday: `2099-09-${String(week).padStart(2, "0")}`,
  location,
});

describe("neutral-site Elo (M3)", () => {
  it("no home bonus at a neutral site", () => {
    expect(eloPHome(1500, 1500, true)).toBeCloseTo(0.5, 12);
    expect(eloPHome(1500, 1500)).toBeGreaterThan(0.5);
  });
  it("schedule location flows into the index", () => {
    const idx = buildEloIndex(scheduleToEloGames([g("n1", 1, "A", "B", null, null, "Neutral"), g("h1", 1, "C", "D", null, null)]));
    expect(idx.get("n1")!.pHome).toBeCloseTo(eloPHome(ELO_INIT, ELO_INIT, true), 12);
    expect(idx.get("h1")!.pHome).toBeCloseTo(eloPHome(ELO_INIT, ELO_INIT), 12);
  });
});

describe("seeded playoff sim (M2)", () => {
  const meta = new Map<string, TeamConfDiv>(["A1", "A2", "B1", "B2"].map((t) => [t, { conference: "C", division: `C ${t[0]}` }]));
  const sched = [g("1", 1, "A2", "A1", null, null), g("2", 1, "B2", "B1", null, null), g("3", 2, "A1", "B1", null, null)];
  it("same inputs give identical results", () => {
    expect(simulatePlayoffs(sched, 2099, meta, 300)).toEqual(simulatePlayoffs(sched, 2099, meta, 300));
  });
  it("prng is deterministic and in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe("transitive tiebreak (M4)", () => {
  // One division of 3 with a head-to-head cycle (X>Y, Y>Z, Z>X) and equal
  // records, all played: the winner must not depend on input order.
  const teams = ["X", "Y", "Z"];
  const sched = [g("1", 1, "Y", "X", 10, 20), g("2", 2, "Z", "Y", 10, 20), g("3", 3, "X", "Z", 10, 20)];
  const metaFor = (order: string[]) => new Map<string, TeamConfDiv>(order.map((t) => [t, { conference: "C", division: "C D" }]));
  it("division winner is the same for every team order", () => {
    const winners = new Set<string>();
    for (const order of [teams, [...teams].reverse(), ["Y", "X", "Z"], ["Z", "X", "Y"]]) {
      const res = simulatePlayoffs(sched, 2099, metaFor(order), 3);
      winners.add(res.find((r) => r.divisionTitlePct === 1)!.team);
    }
    expect(winners.size).toBe(1);
  });
});
