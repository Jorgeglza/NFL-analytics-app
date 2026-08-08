// Shared "season fallback" loader (previously duplicated verbatim in
// TeamComparison.tsx and Scorecards.tsx, and missing from PropBets/ValueBets/
// PlayerTeamStats/MatchupBets, which just dead-ended on ErrorRetry).
//
// The shared season/week (SeasonWeekContext) defaults to the closest
// upcoming week from schedule.json — e.g. next season's Week 1, once the
// schedule is out — even before the pipeline has produced that season's
// team_week/player_week/ranks. Pages that need real stats should fall back a
// season at a time (current season - 1, i.e. "last season there's data for")
// instead of dead-ending on an error page. Bounded so a genuine outage still
// surfaces the error instead of looping.
import { useEffect, useRef } from "react";

export function useSeasonFallback(
  season: string,
  setSeason: (s: string) => void,
  retryTick: number,
  load: (season: number) => Promise<void>,
  opts?: { onExhausted?: (err: unknown) => void; setWeek?: (w: string) => void; maxTries?: number },
): void {
  const maxTries = opts?.maxTries ?? 3;
  const tries = useRef(0);

  useEffect(() => {
    tries.current = 0;
  }, [retryTick]);

  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    load(Number(season)).catch((err) => {
      if (cancelled) return;
      if (tries.current < maxTries) {
        tries.current += 1;
        setSeason(String(Number(season) - 1));
        // Forcing week to "0" (guaranteed absent from any season's weeks)
        // makes a page's weeks-fixing effect jump to the fallback season's
        // latest available week rather than keeping whatever week number
        // was selected.
        opts?.setWeek?.("0");
        return;
      }
      opts?.onExhausted?.(err);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, retryTick]);
}
