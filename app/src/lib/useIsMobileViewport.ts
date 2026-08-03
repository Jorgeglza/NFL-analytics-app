import { useEffect, useState } from "react";

// Mirrors the app's `sm` (640px) breakpoint — the same mobile/desktop line
// already used everywhere else (App.tsx gutters, TabBar's pill-strip swap,
// components/charts/responsive.ts's chart-level MOBILE_MAX, etc.).
const QUERY = "(max-width: 639px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}
