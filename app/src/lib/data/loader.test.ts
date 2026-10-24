// toRecords parity — the object-literal factory must produce exactly what the
// original key-by-key loop did (same keys, same order, same values), on real
// exported frames, so switching to it can't change any page's numbers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toRecords, type CompactFrame, type Row } from "./loader";

function legacyToRecords(frame: CompactFrame, cols?: string[]): Row[] {
  const useCols = cols ? cols.filter((c) => frame.cols.includes(c)) : frame.cols;
  const idx = useCols.map((c) => frame.cols.indexOf(c));
  return frame.rows.map((row) => {
    const rec: Row = {};
    useCols.forEach((c, i) => (rec[c] = row[idx[i]]));
    return rec;
  });
}

const load = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../../public/data/${path}`, import.meta.url), "utf8")) as CompactFrame;

const sameRecords = (a: Row[], b: Row[]) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Object.keys(a[i])).toEqual(Object.keys(b[i]));
    expect(Object.getPrototypeOf(a[i])).toBe(Object.getPrototypeOf(b[i]));
  }
  expect(a).toEqual(b);
};

describe("toRecords", () => {
  for (const path of ["team_week/2025.json", "team_week_ranks/2025.json", "schedule.json", "player_week/2025.json"]) {
    it(`matches the legacy expansion on ${path}`, () => {
      const frame = load(path);
      sameRecords(toRecords(frame), legacyToRecords(frame));
    });
  }

  it("matches the legacy expansion with a column projection (incl. unknown cols)", () => {
    const frame = load("team_week/2025.json");
    const cols = ["week", "team", "points_margin", "not_a_column", "season"];
    sameRecords(toRecords(frame, cols), legacyToRecords(frame, cols));
  });

  it("falls back safely for awkward column names", () => {
    const frame: CompactFrame = {
      cols: ["__proto__", "a\"b", "x y", "1"],
      rows: [[1, 2, null, "z"], [null, "q", 3, 4]],
    };
    sameRecords(toRecords(frame), legacyToRecords(frame));
    const quoted: CompactFrame = { cols: ["a\"b", "x\ny", "</script>"], rows: [[1, 2, 3]] };
    sameRecords(toRecords(quoted), legacyToRecords(quoted));
  });
});
