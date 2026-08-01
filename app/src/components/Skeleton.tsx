/** Pulsing placeholder block — building unit for per-page skeletons (M6 P7.6).
 *  Used instead of a bare spinner for data-loading states so a route change on
 *  a slow connection shows page structure, not spinner → spinner (the route
 *  chunk's Suspense fallback in `App.tsx` is the first spinner; this replaces
 *  the second, in-page one). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

/** Generic filters + KPI cards + content-block skeleton — approximates the
 *  shared shell every player-analysis page renders (filter row, a few
 *  KPI/summary cards, one or two large chart/table blocks) without needing a
 *  bespoke layout per page. */
export function PageSkeleton({ cards = 3, blocks = 2 }: { cards?: number; blocks?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="ml-auto h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-16 min-w-40 flex-1" />
        ))}
      </div>
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} className="h-64 w-full" />
      ))}
    </div>
  );
}
