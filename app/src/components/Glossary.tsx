// Shared, searchable glossary panel — single source of truth for stat/win-type/
// betting-term definitions, used by both Win Types and the Grading Model
// Features tab (previously two separate implementations, one of which just
// linked out to an external nflverse page).
import { useMemo, useState } from "react";
import type { GlossarySection } from "../lib/glossary";

export function Glossary({ sections, searchPlaceholder = "Search a term…" }: { sections: GlossarySection[]; searchPlaceholder?: string }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return sections;
    return sections
      .map((s) => ({ ...s, entries: s.entries.filter((e) => e.term.toLowerCase().includes(query) || e.desc.toLowerCase().includes(query)) }))
      .filter((s) => s.entries.length > 0);
  }, [sections, q]);

  return (
    <div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className="mb-4 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-[#002f6c] focus:outline-none focus:ring-2 focus:ring-[#002f6c]/15"
      />
      {!filtered.length && <p className="text-sm text-slate-400">No terms match "{q}".</p>}
      <div className="space-y-4">
        {filtered.map((s) => (
          <div key={s.title}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{s.title}</div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {s.entries.map((e) => (
                <div key={e.term} className="flex items-start gap-2 text-sm">
                  {e.color ? (
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-slate-200" style={{ background: e.color }} />
                  ) : (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">{e.term}</span>
                    <span className="text-slate-500"> — {e.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
