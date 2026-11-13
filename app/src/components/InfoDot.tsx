// Tappable info marker — promoted from the private `InfoDot` in
// PerformanceTab.tsx. A bare `title` attribute never fires on touch (there
// is no hover event), so this also opens an anchored popover on click/tap;
// `title` stays as the desktop hover fallback since it's free and instant.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const EDGE_PAD = 8;

export function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // Horizontal nudge (px) that keeps the centred popover inside the viewport
  // when the dot sits near a screen edge (audit B5: popovers were clipped by
  // the root's overflow-x-clip on phones).
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = popRef.current;
    if (!el) return;
    // Measured before any shift is applied (shift resets to 0 on close).
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.left < EDGE_PAD) setShift(EDGE_PAD - r.left);
    else if (r.right > vw - EDGE_PAD) setShift(vw - EDGE_PAD - r.right);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onOutside);
    document.addEventListener("touchstart", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onOutside);
      document.removeEventListener("touchstart", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-block align-middle">
      <button
        type="button"
        title={text}
        aria-label="More info"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="ml-1.5 inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500"
      >
        i
      </button>
      {open && (
        <span
          ref={popRef}
          role="tooltip"
          style={shift ? { marginLeft: shift } : undefined}
          className="absolute left-1/2 top-full z-20 mt-1.5 w-64 max-w-[calc(100vw-16px)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-normal normal-case leading-snug text-slate-600 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
