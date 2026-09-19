// Shared dot-strip visualization: each model's home-win probability as a dot
// on a 0–100% track, with a popover for the away/home split + pick +
// correctness. Originally built inline in WeekPreviewTab.tsx; extracted so
// other pages (the Pick'em "This Week" view) can reuse the exact same
// component instead of duplicating it.
import { useEffect, useRef, useState } from "react";
import { MODEL_KEYS, MODEL_COLORS, type MetricKey, type ProbBundle, pickWinner } from "./engine";

/** Anchored detail popover for one model's dot — tap/click target, since a
 * bare `title` attribute never fires on touch. Mirrors InfoDot.tsx's
 * open/outside-click/Escape pattern. */
function DotPopover({ pH, label, color, away, home, actual }: { pH: number; label: string; color: string; away: string; home: string; actual: "home" | "away" | null }) {
  const pctAway = Math.round(100 * (1 - pH));
  const pctHome = Math.round(100 * pH);
  const side = pickWinner([1 - pH, pH]);
  const pick = side === "home" ? home : away;
  const correct = actual != null ? side === actual : null;
  // Keep the popover on-card/on-screen: dots near either end of the track
  // would push a centered popover off the edge, so anchor to that edge instead.
  const align = pH < 0.15 ? "left" : pH > 0.85 ? "right" : "center";
  return (
    <span
      role="tooltip"
      className="absolute bottom-full z-20 mb-1.5 w-40 max-w-[70vw] rounded-xl border border-slate-200 bg-white p-2.5 text-left text-[11px] font-normal normal-case leading-snug text-slate-600 shadow-lg"
      style={
        align === "center"
          ? { left: "50%", transform: "translateX(-50%)" }
          : align === "left"
            ? { left: 0 }
            : { right: 0 }
      }
    >
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="tabular-nums">{away} {pctAway}% | {home} {pctHome}%</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-semibold text-slate-800">Pick: {pick}</span>
        {correct != null && (
          <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {correct ? "✓ Correct" : "✗ Incorrect"}
          </span>
        )}
      </div>
    </span>
  );
}

/** How long a tap-opened dot popover stays up before auto-dismissing, on
 * top of closing early via an outside click/tap or Escape. */
const DOT_TAP_AUTOCLOSE_MS = 2500;

/** Compact disagreement strip: each model's home-win prob as a dot on a 0–100% track.
 * Hover (desktop) reveals the detail popover instantly and hides it on
 * mouse-out. Click/tap (mobile, which has no hover) pins it open briefly —
 * it auto-dismisses after a few seconds, or immediately on an outside click
 * or Escape — without triggering the card's own onClick navigation. */
export function ModelDotStrip({
  bundle,
  away,
  home,
  actual,
  showEndLabels = true,
}: {
  bundle: ProbBundle;
  away: string;
  home: string;
  actual: "home" | "away" | null;
  /** Set false when the caller already shows away/home identity next to the
   * strip (e.g. real team logos flanking it) so the strip's own tiny text
   * labels don't double up. */
  showEndLabels?: boolean;
}) {
  type Key = MetricKey | "consensus";
  const [openKey, setOpenKey] = useState<Key | null>(null); // tap-opened, auto-dismisses
  const [hoverKey, setHoverKey] = useState<Key | null>(null); // shown transiently by hover/focus
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openKey) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    const autoClose = window.setTimeout(() => setOpenKey(null), DOT_TAP_AUTOCLOSE_MS);
    document.addEventListener("click", onOutside);
    document.addEventListener("touchstart", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(autoClose);
      document.removeEventListener("click", onOutside);
      document.removeEventListener("touchstart", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  const dotHandlers = (k: Key) => ({
    onMouseEnter: () => setHoverKey(k),
    onMouseLeave: () => setHoverKey((v) => (v === k ? null : v)),
    onFocus: () => setHoverKey(k),
    onBlur: () => setHoverKey((v) => (v === k ? null : v)),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpenKey((v) => (v === k ? null : k));
    },
  });

  return (
    <div ref={rootRef} className="relative mt-2 h-5 rounded-full bg-slate-100" title="Each dot = one model's home-win probability. Hover or tap a dot for details. Spread-out dots = the models disagree.">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[8px] text-slate-400">50%</span>
      {MODEL_KEYS.filter(([k]) => k !== "consensus").map(([k, lbl], i) => {
        const pH = bundle[k][1];
        if (pH == null) return null;
        const visible = openKey === k || hoverKey === k;
        return (
          <button
            key={k}
            type="button"
            aria-label={`${lbl} details`}
            aria-expanded={visible}
            {...dotHandlers(k)}
            className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            // Stacking (which dot sits in front on overlap) follows the same order as the top
            // models list (Average, ML Fair, Market-calibrated, ...) — MODEL_KEYS.length - i so
            // earlier-ranked models get a higher z-index and paint on top; consensus (always
            // rendered last, below) gets the highest of all via MODEL_KEYS.length itself.
            style={{ left: `${100 * pH}%`, zIndex: MODEL_KEYS.length - 1 - i }}
          >
            <span className="h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ background: MODEL_COLORS[k] }} />
            {visible && <DotPopover pH={pH} label={lbl} color={MODEL_COLORS[k]} away={away} home={home} actual={actual} />}
          </button>
        );
      })}
      {bundle.consensus[1] != null && (
        <button
          type="button"
          aria-label="Average details"
          aria-expanded={openKey === "consensus" || hoverKey === "consensus"}
          {...dotHandlers("consensus")}
          className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${100 * bundle.consensus[1]}%`, zIndex: MODEL_KEYS.length }}
        >
          <span className="h-3.5 w-1 rounded-sm" style={{ background: MODEL_COLORS.consensus }} />
          {(openKey === "consensus" || hoverKey === "consensus") && (
            <DotPopover pH={bundle.consensus[1]} label="Average" color={MODEL_COLORS.consensus} away={away} home={home} actual={actual} />
          )}
        </button>
      )}
      {showEndLabels && (
        <>
          <span className="absolute -bottom-3.5 left-0 text-[8px] text-slate-400">← {away}</span>
          <span className="absolute -bottom-3.5 right-0 text-[8px] text-slate-400">{home} →</span>
        </>
      )}
    </div>
  );
}

/** max − min of model home probs (consensus excluded). */
export function disagreementOf(bundle: ProbBundle): number {
  const ps = MODEL_KEYS.filter(([k]) => k !== "consensus")
    .map(([k]) => bundle[k][1])
    .filter((p): p is number => p != null);
  return ps.length >= 2 ? Math.max(...ps) - Math.min(...ps) : 0;
}
