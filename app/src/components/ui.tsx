// Shared UI kit (M4) — matches the navbar/home design language:
// navy #002f6c accents, rounded-2xl white cards on slate borders,
// uppercase micro-labels, pill segments. Presentation only.
import { useEffect, useRef, useState, type ReactNode } from "react";

export const NAVY = "#002f6c";

/** Page title row with optional subtitle and a right-aligned controls slot. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-[#002f6c] sm:text-2xl">
          <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
          {title}
        </h1>
        {subtitle && <p className="mt-1 pl-4 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
    </div>
  );
}

/** Standard content card. `accent` draws a thin brand line on top. */
export function Card({
  title,
  subtitle,
  accent,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: ReactNode;
  subtitle?: string;
  accent?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      {(title || subtitle) && (
        <div className="border-b border-slate-100 px-4 pb-2.5 pt-3.5">
          {title && <div className="text-sm font-semibold text-slate-800">{title}</div>}
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
      )}
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

/** Stat tile — value + uppercase micro-label, optional accent color. */
export function Kpi({ label, value, accent = NAVY, sub }: { label: string; value: ReactNode; accent?: string; sub?: string }) {
  return (
    <div
      className="min-w-[calc(50%-0.375rem)] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:min-w-36"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** Labeled pill segment control — replaces ad-hoc button groups. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex max-w-[calc(100vw-2rem)] flex-col gap-1">
      {label && <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>}
      <div className="flex max-w-full overflow-x-auto rounded-full border border-slate-200 bg-slate-100 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors sm:py-1.5 ${
              value === o.value ? "bg-[#002f6c] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small colored pill badge. */
export function Chip({ color = NAVY, children, title }: { color?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/** Labeled cluster of related filters — keeps mixed control bars scannable
 *  (which controls select the data vs the model vs the presentation). */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="relative rounded-xl border border-slate-200 bg-white/60 px-3 pb-2.5 pt-3">
      <legend className="px-1.5 text-[10px] font-bold uppercase tracking-wider text-[#002f6c]/70">{label}</legend>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </fieldset>
  );
}

/** Consistent table classes. `relative` so `ScrollHint` (below) can anchor
 * to it without every consumer needing to add its own positioning. */
export const tableWrapCls = "relative overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm";
export const theadCls = "bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400";
export const trCls = "border-t border-slate-100 transition-colors hover:bg-slate-50/70";

/** Pins a table's first column while the rest scrolls horizontally — apply
 * to both the `<th>` and `<td>` of that column. Requires the table itself
 * to use `border-separate border-spacing-0` (sticky cells lose borders
 * under `border-collapse`); the divider between the pinned column and the
 * scrolling ones is drawn with `box-shadow` (a border on the sticky cell
 * itself would scroll away with nothing to anchor against). */
export const stickyColCls = "sticky left-0 z-10 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";

/** Same as `stickyColCls`, for a `<th>` inside a `bg-slate-50` header row
 * (e.g. `theadCls`) — the sticky cell needs its own opaque background
 * matching the header's, not the body's white. */
export const stickyColHeadCls = "sticky left-0 z-10 bg-slate-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]";

/** Right-edge fade + "swipe" affordance for a horizontally-scrollable table
 * wrapper — pair with `tableWrapCls` on a `relative`-positioned ancestor. */
export const scrollHintCls =
  "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent";

/** Drop as the last child of a `tableWrapCls` wrapper (a scrolling parent)
 * to add a right-edge fade affordance — hides itself once there's nothing
 * left to scroll (content fits, or the user has already scrolled to the
 * end), so it never lingers as a false "there's more" signal. */
export function ScrollHint() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const wrap = ref.current?.parentElement;
    if (!wrap) return;
    const update = () => setVisible(wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 4);
    update();
    wrap.addEventListener("scroll", update);
    // ResizeObserver on `wrap` only fires when *its own* box changes — the
    // wrapper's size is fixed by its container, so a table growing inside it
    // (async data arriving, column count changing) never triggers that.
    // Observe the scrollable content itself instead.
    const ro = new ResizeObserver(update);
    for (const child of wrap.children) if (child !== ref.current) ro.observe(child);
    return () => {
      wrap.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return <div ref={ref} className={scrollHintCls} style={{ opacity: visible ? 1 : 0 }} aria-hidden="true" />;
}

/** Labeled numeric input matching the Select styling. */
export function NumberInput({
  label,
  value,
  onChange,
  placeholder,
  className = "w-full sm:w-28",
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  min?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15`}
      />
    </label>
  );
}

/** Labeled range slider. */
export function RangeInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  className = "w-full sm:w-44",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${className} accent-[#002f6c]`} />
    </label>
  );
}
