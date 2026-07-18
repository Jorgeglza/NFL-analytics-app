interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  value: string;
  options?: Option[];
  /** Optional grouped options (rendered as <optgroup>). Takes precedence over `options`. */
  groups?: { label: string; options: Option[] }[];
  onChange: (value: string) => void;
}

export function Select({ label, value, options = [], groups, onChange }: SelectProps) {
  const renderOptions = (opts: Option[]) =>
    opts.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>}
      <select
        className="min-w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {groups
          ? groups
              .filter((g) => g.options.length)
              .map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {renderOptions(g.options)}
                </optgroup>
              ))
          : renderOptions(options)}
      </select>
    </label>
  );
}
