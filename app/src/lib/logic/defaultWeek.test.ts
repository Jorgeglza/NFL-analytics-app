// isUpcomingStale (audit 2026-11-12, B2): the predictive model's upcoming
// export lags the schedule after each week finishes.
import { describe, expect, it } from "vitest";
import type { Row } from "../data/loader";
import { currentWeek, isUpcomingStale } from "./defaultWeek";

const g = (week: number, played: boolean): Row => ({
  season: 2026,
  week,
  game_type: "REG",
  home_score: played ? 20 : null,
});

describe("isUpcomingStale", () => {
  // Week 9 fully played, week 10 not started.
  const sched = [g(9, true), g(9, true), g(10, false), g(10, false)];

  it("current week is the first unplayed week", () => {
    expect(currentWeek(sched)?.week).toBe(10);
  });
  it("flags an export that still points at the finished week", () => {
    expect(isUpcomingStale({ season: 2026, week: 9, n_games: 2 }, sched)).toBe(true);
  });
  it("flags an export from a previous season", () => {
    expect(isUpcomingStale({ season: 2025, week: 18, n_games: 16 }, sched)).toBe(true);
  });
  it("accepts an export for the current week", () => {
    expect(isUpcomingStale({ season: 2026, week: 10, n_games: 2 }, sched)).toBe(false);
  });
  it("accepts the current week while it is in progress", () => {
    expect(isUpcomingStale({ season: 2026, week: 10, n_games: 2 }, [g(9, true), g(10, true), g(10, false)])).toBe(false);
  });
  it("flags a week whose games are all scored even at season end", () => {
    expect(isUpcomingStale({ season: 2026, week: 18, n_games: 1 }, [g(17, true), g(18, true)])).toBe(true);
  });
  it("ignores missing or empty meta", () => {
    expect(isUpcomingStale(null, sched)).toBe(false);
    expect(isUpcomingStale({ season: null, week: null, n_games: 0 }, sched)).toBe(false);
  });
});
