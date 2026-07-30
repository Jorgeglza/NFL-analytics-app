// Below `sm`, collapses a dense filter bar (the app's densest, SpreadWinPct's
// ~10 controls, chews ~200px of vertical space before any content) into a
// sticky "Filters" button that opens a bottom sheet. At `sm+`, renders
// exactly like the old inline `FilterBar` strip — same children, no
// behavior change for desktop.
import { useEffect, useState, type ReactNode } from "react";

export function FilterSheet({ activeCount, children }: { activeCount?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="sm:hidden">
        <button
          onClick={() => setOpen(true)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm"
        >
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end bg-slate-900/50" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pb-2">
                <div className="h-1 w-10 rounded-full bg-slate-300" />
              </div>
              <div className="flex items-center justify-between pb-3">
                <span className="text-sm font-bold text-[#002f6c]">Filters</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-3">{children}</div>
            </div>
          </div>
        )}
      </div>
      <div className="hidden flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex">{children}</div>
    </>
  );
}
