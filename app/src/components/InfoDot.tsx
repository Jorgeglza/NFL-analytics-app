// Tappable info marker — promoted from the private `InfoDot` in
// PerformanceTab.tsx. A bare `title` attribute never fires on touch (there
// is no hover event), so this also opens an anchored popover on click/tap;
// `title` stays as the desktop hover fallback since it's free and instant.
import { useEffect, useRef, useState } from "react";

export function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1.5 w-64 max-w-[80vw] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-normal normal-case leading-snug text-slate-600 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
