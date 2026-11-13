// easternToEpochMs (audit B9): nflverse gametime is US Eastern wall-clock.
import { describe, expect, it } from "vitest";
import { easternToEpochMs } from "./kickoff";

describe("easternToEpochMs", () => {
  it("EDT kickoff (UTC-4)", () => {
    expect(new Date(easternToEpochMs("2026-09-13", "13:00")!).toISOString()).toBe("2026-09-13T17:00:00.000Z");
  });
  it("EST kickoff (UTC-5)", () => {
    expect(new Date(easternToEpochMs("2026-11-15", "13:00")!).toISOString()).toBe("2026-11-15T18:00:00.000Z");
  });
  it("late game rolls over to the next UTC day", () => {
    expect(new Date(easternToEpochMs("2026-11-16", "20:15")!).toISOString()).toBe("2026-11-17T01:15:00.000Z");
  });
  it("day after the fall-back DST change", () => {
    expect(new Date(easternToEpochMs("2026-11-01", "13:00")!).toISOString()).toBe("2026-11-01T18:00:00.000Z");
  });
  it("missing time defaults to noon ET; bad date is null", () => {
    expect(new Date(easternToEpochMs("2026-11-15", null)!).toISOString()).toBe("2026-11-15T17:00:00.000Z");
    expect(easternToEpochMs(null, "13:00")).toBeNull();
  });
});
