// Shared section-tab control — extracted from the identical hand-rolled card
// grid duplicated in SeasonOutlook.tsx, GradingModel.tsx, PredictiveModel.tsx
// and MatchupPreviews.tsx. Below `sm` the icon+label+description cards
// (~260px of chrome before any content, at 4 stacked full-width cards) are
// replaced by a horizontally-scrollable compact pill strip; the original
// card grid is kept at `sm+`.
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  gridClassName = "sm:grid-cols-3",
}: {
  /** [label, icon, description] tuples, in display order. */
  tabs: readonly (readonly [T, string, string])[];
  active: T;
  onChange: (t: T) => void;
  /** Column classes for the sm+ card grid, e.g. "sm:grid-cols-4". */
  gridClassName?: string;
}) {
  return (
    <>
      <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 sm:hidden">
        {tabs.map(([t, icon]) => (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`flex h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-bold transition-colors ${
              active === t ? "border-[#002f6c] bg-[#002f6c] text-white" : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            <span>{icon}</span>
            {t}
          </button>
        ))}
      </div>
      <div className={`hidden gap-2 sm:grid ${gridClassName}`}>
        {tabs.map(([t, icon, desc]) => (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`rounded-2xl border px-4 py-2.5 text-left shadow-sm transition-all ${
              active === t ? "border-[#002f6c] bg-[#002f6c] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[#002f6c]/40"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <span>{icon}</span>
              {t}
            </div>
            <div className={`mt-0.5 text-[11px] ${active === t ? "text-white/75" : "text-slate-400"}`}>{desc}</div>
          </button>
        ))}
      </div>
    </>
  );
}
