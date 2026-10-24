/** Shared loading / empty placeholders (M4). */
import { useEffect, useState } from "react";

const SLOW_HINT_MS = 8000;

/** JGA icon inside a spinning navy ring — the app-wide "working on it" mark
 *  (same look as the startup splash in index.html). */
export function BrandSpinner({ size = 56 }: { size?: number }) {
  const inset = Math.round(size * 0.16);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-[#002f6c]/15 border-t-[#002f6c] motion-reduce:animate-pulse" />
      <img
        src={`${import.meta.env.BASE_URL}branding/jga-icon-64.png`}
        alt=""
        className="absolute rounded-full"
        style={{ inset, width: size - 2 * inset, height: size - 2 * inset }}
      />
    </div>
  );
}

/** "Still working" line that fades in once a load has run long (slow
 *  connection), so the spinner never looks stuck. */
function SlowHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), SLOW_HINT_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <span className={`text-xs text-slate-400 transition-opacity duration-500 ${show ? "opacity-100" : "opacity-0"}`}>
      Still working — slow connection, hang tight…
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-16 text-sm font-medium text-slate-500">
      <BrandSpinner />
      {label}
      <SlowHint />
    </div>
  );
}

/** Spinner + slow hint centered over a skeleton layout (PageSkeleton). */
export function LoadingOverlay() {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-3 text-sm font-medium text-slate-500">
      <BrandSpinner />
      Loading…
      <SlowHint />
    </div>
  );
}

export function Empty({ label = "No data for the selected filters." }: { label?: string }) {
  return <div className="py-12 text-center text-sm text-slate-400">{label}</div>;
}

/** Shown when a page's initial data load fails outright (e.g. a dropped
 * connection that exhausted fetchJson's retries) instead of leaving the
 * page stuck on a spinner forever. */
export function ErrorRetry({
  message = "Couldn't load this page — check your connection and try again.",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-slate-500">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#002f6c] hover:bg-slate-50"
      >
        Retry
      </button>
    </div>
  );
}
