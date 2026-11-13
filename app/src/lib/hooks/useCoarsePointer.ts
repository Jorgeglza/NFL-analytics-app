// True on touch-first devices (`(pointer: coarse)`), live-updating if the
// primary pointer changes (e.g. a tablet docking a trackpad). Used where a
// control's touch version needs a different interaction, not just a bigger
// size (audit A1: overlapping model dots can't be tapped individually).
import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse)";

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== "undefined" && window.matchMedia?.(QUERY).matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const onChange = () => setCoarse(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
