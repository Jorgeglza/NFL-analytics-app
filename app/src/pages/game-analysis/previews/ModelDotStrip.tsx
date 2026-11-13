// Shared dot-strip visualization: each model's home-win probability as a dot
// on a 0–100% track, with a popover for the away/home split + pick +
// correctness. Originally built inline in WeekPreviewTab.tsx; extracted so
// other pages (the Pick'em "This Week" view) can reuse the exact same
// component instead of duplicating it.
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MODEL_KEYS, MODEL_COLORS, type MetricKey, type ProbBundle, pickWinner } from "./engine";
import { useCoarsePointer } from "../../../lib/hooks/useCoarsePointer";

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
        <span className="font-semibold text-slate-800">Pick:</span>
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: color }} title={`Favors ${pick}`}>
          {pick}
        </span>
        {correct != null && (
          <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {correct ? "✓ Correct" : "✗ Incorrect"}
          </span>
        )}
      </div>
    </span>
  );
}

/** Touch version: every model in one list (audit A1 — the 24px dots overlap
 * whenever models agree, so they can't be tapped one by one on a phone). */
function AllModelsPopover({
  bundle,
  away,
  home,
  actual,
  anchor,
  popRef,
}: {
  bundle: ProbBundle;
  away: string;
  home: string;
  actual: "home" | "away" | null;
  anchor: DOMRect;
  popRef: RefObject<HTMLDivElement>;
}) {
  const rows = MODEL_KEYS.map(([k, lbl]) => ({ k, lbl, pH: bundle[k][1] })).filter((r): r is { k: MetricKey; lbl: string; pH: number } => r.pH != null);
  // Portaled + fixed: game cards lift on hover (a transform → their own
  // stacking context), so an in-card absolute popover gets painted over by
  // the NEXT card regardless of z-index.
  const below = anchor.bottom + 230 < window.innerHeight;
  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="All model predictions"
      // React bubbles portal events through the component tree — keep taps
      // here from reaching the game card's own onClick (navigation).
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-normal normal-case leading-snug text-slate-600 shadow-lg"
      style={{ left: anchor.left, width: anchor.width, ...(below ? { top: anchor.bottom + 14 } : { bottom: window.innerHeight - anchor.top + 8 }) }}
    >
      {rows.map(({ k, lbl, pH }) => {
        const side = pickWinner([1 - pH, pH]);
        const pick = side === "home" ? home : away;
        const p = Math.round(100 * (side === "home" ? pH : 1 - pH));
        const correct = actual != null ? side === actual : null;
        return (
          <span key={k} className="flex items-center gap-2 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MODEL_COLORS[k] }} />
            <span className="min-w-0 flex-1 truncate">{lbl}</span>
            <span className="font-semibold tabular-nums text-slate-800">
              {pick} {p}%
            </span>
            {correct != null && <span className={correct ? "text-emerald-700" : "text-rose-700"}>{correct ? "✓" : "✗"}</span>}
          </span>
        );
      })}
    </div>,
    document.body,
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
  const [allOpen, setAllOpen] = useState<DOMRect | null>(null); // touch: the whole-strip list, anchored at this rect
  const coarse = useCoarsePointer();
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allOpen) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setAllOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAllOpen(null);
    };
    const onScroll = () => setAllOpen(null); // fixed-position: don't float away from the strip
    document.addEventListener("click", onOutside);
    document.addEventListener("touchstart", onOutside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("click", onOutside);
      document.removeEventListener("touchstart", onOutside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [allOpen]);

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
    <div
      ref={rootRef}
      data-no-touch-title
      className={`relative mt-2 h-5 rounded-full bg-slate-100 ${coarse ? "[&>button[data-dot]]:pointer-events-none" : ""}`}
      title="Each dot = one model's home-win probability. Hover or tap a dot for details. Spread-out dots = the models disagree."
    >
      {coarse && (
        // Touch: one ≥44px-tall target over the whole strip; dots below become
        // display-only (pointer-events-none via data-dot).
        <button
          type="button"
          aria-label="Show every model's prediction"
          aria-expanded={allOpen != null}
          onClick={(e) => {
            e.stopPropagation();
            setAllOpen((v) => (v ? null : rootRef.current?.getBoundingClientRect() ?? null));
          }}
          className="absolute inset-x-0 -inset-y-3 z-[42] rounded-full"
        />
      )}
      {coarse && allOpen && <AllModelsPopover bundle={bundle} away={away} home={home} actual={actual} anchor={allOpen} popRef={popRef} />}
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] text-slate-500">50%</span>
      {MODEL_KEYS.filter(([k]) => k !== "consensus").map(([k, lbl], i) => {
        const pH = bundle[k][1];
        if (pH == null) return null;
        const visible = openKey === k || hoverKey === k;
        return (
          <button
            key={k}
            type="button"
            data-dot
            tabIndex={coarse ? -1 : undefined}
            aria-label={`${lbl} details`}
            aria-expanded={visible}
            {...dotHandlers(k)}
            className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            // Stacking (which dot sits in front on overlap) follows the same order as the top
            // models list (Average, ML Fair, Market-calibrated, ...) — MODEL_KEYS.length - i so
            // earlier-ranked models get a higher z-index and paint on top; consensus (always
            // rendered last, below) gets the highest of all via MODEL_KEYS.length itself.
            // While its tooltip is open, a dot jumps to z-41 — each dot button is its own
            // stacking context (absolute + explicit zIndex), so the tooltip's own z-20 only
            // wins locally; without this, ThisWeekView's "Compare all N models" footer
            // button (z-40, deliberately high — see its own comment) paints over the
            // tooltip. 41 stays under GameModelsPopover's z-[42] and the Navbar's z-[45].
            style={{ left: `${100 * pH}%`, zIndex: visible ? 41 : MODEL_KEYS.length - 1 - i }}
          >
            <span className="h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ background: MODEL_COLORS[k] }} />
            {visible && <DotPopover pH={pH} label={lbl} color={MODEL_COLORS[k]} away={away} home={home} actual={actual} />}
          </button>
        );
      })}
      {bundle.consensus[1] != null && (
        <button
          type="button"
          data-dot
          tabIndex={coarse ? -1 : undefined}
          aria-label="Average details"
          aria-expanded={openKey === "consensus" || hoverKey === "consensus"}
          {...dotHandlers("consensus")}
          className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${100 * bundle.consensus[1]}%`, zIndex: openKey === "consensus" || hoverKey === "consensus" ? 41 : MODEL_KEYS.length }}
        >
          <span className="h-3.5 w-1 rounded-sm" style={{ background: MODEL_COLORS.consensus }} />
          {(openKey === "consensus" || hoverKey === "consensus") && (
            <DotPopover pH={bundle.consensus[1]} label="Average" color={MODEL_COLORS.consensus} away={away} home={home} actual={actual} />
          )}
        </button>
      )}
      {showEndLabels && (
        <>
          <span className="absolute -bottom-3.5 left-0 text-[10px] text-slate-500">← {away}</span>
          <span className="absolute -bottom-3.5 right-0 text-[10px] text-slate-500">{home} →</span>
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
