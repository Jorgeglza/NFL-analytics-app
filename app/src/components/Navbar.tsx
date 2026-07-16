import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_GROUPS } from "../nav";

export default function Navbar() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // close menus on navigation
  useEffect(() => {
    setOpen(null);
    setMobileOpen(false);
  }, [location.pathname]);

  // close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-[#002f6c] text-white shadow-lg">
      <div ref={ref} className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-2.5">
        <NavLink to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-sm">🏈</span>
          NFL Analytics
        </NavLink>

        {/* Desktop group dropdowns */}
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV_GROUPS.map((group) => {
            const active = group.pages.some((p) => location.pathname === p.path);
            const isOpen = open === group.label;
            return (
              <div key={group.label} className="relative">
                <button
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-white/15" : "hover:bg-white/10"
                  } ${isOpen ? "bg-white/15" : ""}`}
                  onClick={() => setOpen(isOpen ? null : group.label)}
                >
                  {group.label}
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
                  >
                    <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl">
                    {group.pages.map((page) => (
                      <NavLink
                        key={page.path}
                        to={page.path}
                        className={({ isActive }) =>
                          `block border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50 ${
                            isActive ? "bg-blue-50/70" : ""
                          }`
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#002f6c]">{page.label}</span>
                          {!page.implemented && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              soon
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs leading-snug text-slate-500">{page.description}</div>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="ml-auto rounded-lg p-2 hover:bg-white/10 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            {mobileOpen ? (
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            ) : (
              <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-white/10 bg-[#00275a] px-4 pb-4 md:hidden">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="pt-3">
              <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/50">
                {group.label}
              </div>
              {group.pages.map((page) => (
                <NavLink
                  key={page.path}
                  to={page.path}
                  className={({ isActive }) =>
                    `mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      isActive ? "bg-white/15 font-semibold" : "text-white/85 hover:bg-white/10"
                    }`
                  }
                >
                  {page.label}
                  {!page.implemented && (
                    <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                      soon
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
