// Shared "currently selected season/week" context (audit: every page
// independently re-asked season/week; following one game across pages meant
// re-picking it repeatedly). Seeded once from the shared `currentWeek()` rule
// (lib/logic/defaultWeek.ts) so a fresh session opens on the current/last-
// completed week everywhere, then updated as the user picks a different
// season/week on any participating page so the next page they visit already
// shows it.
//
// Deliberately NOT used by: Matchup Previews/Matchup Bets's "closest week to
// today" rule (defaultWeekNearToday — a different question, kept separate),
// Spread Win % / Win Types (multi-select season/week, not a single value),
// or Parlay Builder's per-leg season (legs can span multiple seasons by
// design). Home also keeps its own always-current-week computation for its
// "this week" banner rather than reading this mutable selection.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSchedule } from "../lib/data/loader";
import { currentWeek } from "../lib/logic/defaultWeek";

interface SeasonWeekState {
  season: string;
  week: string;
  setSeason: (s: string) => void;
  setWeek: (w: string) => void;
}

const SeasonWeekContext = createContext<SeasonWeekState | null>(null);

export function SeasonWeekProvider({ children }: { children: ReactNode }) {
  const [season, setSeason] = useState("");
  const [week, setWeek] = useState("");
  const seeded = useRef(false);

  useEffect(() => {
    getSchedule().then((rows) => {
      if (seeded.current) return;
      seeded.current = true;
      const cw = currentWeek(rows);
      if (!cw) return;
      // Functional updates: only fill in if nothing (e.g. a deep-linked page)
      // has already set a value first.
      setSeason((s) => s || String(cw.season));
      setWeek((w) => w || String(cw.week));
    });
  }, []);

  return <SeasonWeekContext.Provider value={{ season, week, setSeason, setWeek }}>{children}</SeasonWeekContext.Provider>;
}

export function useSeasonWeek(): SeasonWeekState {
  const ctx = useContext(SeasonWeekContext);
  if (!ctx) throw new Error("useSeasonWeek must be used within a SeasonWeekProvider");
  return ctx;
}
