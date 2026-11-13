// Touch fallback for `title` tooltips (audit A4). ~280 `title` attributes in
// the app carry real explanations (KPI definitions, model chips, badges), and
// browsers never show `title` on touch. Rather than rewrite each one, this
// app-level listener makes every one of them reachable on touch devices:
//   • tap a NON-interactive element that has a title → show it
//   • long-press (500 ms) ANY element with a title → show it, and swallow the
//     click that follows so the press doesn't also trigger the control
// Mouse users are untouched (native hover tooltips). Elements that already
// have their own tap popover (InfoDot, model dots) opt out with
// `data-no-touch-title`.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCoarsePointer } from "../lib/hooks/useCoarsePointer";

const LONG_PRESS_MS = 500;
const AUTO_HIDE_MS = 5000;
const MOVE_CANCEL_PX = 10;
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role='button'],[role='tab'],[tabindex]:not([tabindex='-1'])";

interface Tip {
  text: string;
  rect: DOMRect;
}

function titledAncestor(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>("[title]") : null;
  if (!el || el.closest("[data-no-touch-title]")) return null;
  const text = el.getAttribute("title")?.trim();
  if (!text) return null;
  // Redundant when the title just repeats what's already visible.
  if (text === el.textContent?.trim()) return null;
  return el;
}

function isInteractive(el: HTMLElement): boolean {
  return !!el.closest(INTERACTIVE) || getComputedStyle(el).cursor === "pointer";
}

export function TouchTitles() {
  const coarse = useCoarsePointer();
  const [tip, setTip] = useState<Tip | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

  useEffect(() => {
    if (!coarse) return;
    const show = (el: HTMLElement) => setTip({ text: el.getAttribute("title")!.trim(), rect: el.getBoundingClientRect() });
    const cancelPress = () => {
      if (press.current) window.clearTimeout(press.current.timer);
    };

    const onTouchStart = (e: TouchEvent) => {
      setTip(null);
      cancelPress();
      const t = e.touches[0];
      const el = titledAncestor(e.target);
      if (!t || !el) {
        press.current = null;
        return;
      }
      press.current = {
        x: t.clientX,
        y: t.clientY,
        fired: false,
        timer: window.setTimeout(() => {
          if (press.current) press.current.fired = true;
          show(el);
        }, LONG_PRESS_MS),
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (press.current && t && Math.hypot(t.clientX - press.current.x, t.clientY - press.current.y) > MOVE_CANCEL_PX) cancelPress();
    };
    const onTouchEnd = () => cancelPress();
    // Capture phase so a long-press can swallow the click before React sees it.
    const onClick = (e: MouseEvent) => {
      if (press.current?.fired) {
        press.current = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const el = titledAncestor(e.target);
      if (el && !isInteractive(el)) show(el);
    };
    const hide = () => setTip(null);

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      cancelPress();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, [coarse]);

  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [tip]);

  if (!tip) return null;
  // Below the element when there's room, else above; clamped horizontally.
  const vw = document.documentElement.clientWidth;
  const width = Math.min(280, vw - 16);
  const left = Math.max(8, Math.min(vw - 8 - width, tip.rect.left + tip.rect.width / 2 - width / 2));
  const below = tip.rect.bottom + 120 < window.innerHeight;
  const style = below ? { left, width, top: tip.rect.bottom + 6 } : { left, width, bottom: window.innerHeight - tip.rect.top + 6 };
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[60] rounded-xl border border-slate-200 bg-white p-2.5 text-xs leading-snug text-slate-700 shadow-lg"
      style={style}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
