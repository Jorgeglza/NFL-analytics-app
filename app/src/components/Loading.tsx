/** Shared loading / empty placeholders (M4). */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#002f6c]" />
      {label}
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
