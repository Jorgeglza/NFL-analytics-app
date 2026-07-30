// Minimal reusable modal — overlay + scrollable panel matching ui.tsx's card
// language (rounded-2xl, navy accent). No portal (app has no #modal-root);
// fixed positioning + a high z-index is sufficient for a single-level dialog.
// Below `sm` it renders as a bottom sheet (full-width, anchored to the
// bottom, rounded top corners, grab handle) since a centered dialog eats
// most of a phone screen; at `sm+` it's the original centered dialog.
import { useEffect, useRef, type ReactNode } from "react";

// `wide` grows the panel with the viewport (up to a cap) instead of a fixed
// max-width, for content that benefits from using spare horizontal space
// (e.g. side-by-side charts) rather than a narrow single column.
export function Modal({
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  title: ReactNode;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // Body scroll lock — without this the page scrolls behind the overlay,
    // most noticeable on touch where the panel and page fight for the drag.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus trap + restore.
    previouslyFocused.current = document.activeElement;
    closeBtnRef.current?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = closeBtnRef.current?.closest('[role="dialog"]');
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onTab);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`flex max-h-[88vh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:block sm:max-h-none sm:rounded-2xl ${
          wide ? "sm:max-w-2xl lg:max-w-4xl xl:max-w-6xl" : "sm:max-w-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle — mobile bottom-sheet affordance only. */}
        <div className="flex justify-center pb-1 pt-2 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 pb-3 pt-2 sm:pt-4">
          <div className="min-w-0">
            <div className="text-base font-bold text-[#002f6c]">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        {/* Below `sm`: single flex-scroll container sized to the sheet's
            max-h-[88vh] cap — the old version nested this scroll area inside
            the also-scrollable overlay, an iOS scroll-chaining trap. At
            `sm+`: reverts to the original layout exactly (block panel,
            content capped at 75vh, outer overlay scrolls if taller). */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:max-h-[75vh]">{children}</div>
      </div>
    </div>
  );
}
