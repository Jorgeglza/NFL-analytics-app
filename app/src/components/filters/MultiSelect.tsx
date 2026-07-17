import { useEffect, useRef, useState } from "react";

interface MultiSelectProps {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}

/** Dropdown with checkboxes — React equivalent of dcc.Dropdown(multi=True). */
export function MultiSelect({ label, values, options, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  const summary =
    values.length === 0
      ? "None"
      : values.length === options.length
        ? "All"
        : values.length <= 3
          ? values.join(", ")
          : `${values.length} selected`;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
      >
        {summary} <span className="float-right text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full z-20 mt-1 max-h-64 w-full min-w-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <div className="flex gap-1 border-b border-slate-100 p-1">
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs text-[#002f6c] hover:bg-slate-100"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              All
            </button>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs text-[#002f6c] hover:bg-slate-100"
              onClick={() => onChange([])}
            >
              None
            </button>
          </div>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm font-normal text-slate-800 hover:bg-slate-50"
            >
              <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
