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
