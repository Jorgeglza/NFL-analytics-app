// One visual track, two thumbs — replaces two full-width, independently
// confusing native range inputs with a single control that sets a start and
// an end (used by Player Team Stats' week filter).
export function RangeSlider({
  min,
  max,
  lo,
  hi,
  onChange,
  className = "",
}: {
  min: number;
  max: number;
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
  className?: string;
}) {
  const pct = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100);
  return (
    <div className={`relative h-5 ${className}`}>
      <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#002f6c]"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={lo}
        onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
        className="range-thumb absolute inset-0 h-full w-full"
        aria-label="Start week"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={hi}
        onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
        className="range-thumb absolute inset-0 h-full w-full"
        aria-label="End week"
      />
    </div>
  );
}
