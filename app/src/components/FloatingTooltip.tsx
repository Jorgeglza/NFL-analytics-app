// A small hover tooltip rendered via portal to <body> — used by inline SVG
// hover charts (Pick'em Recommendations' spread strip, weekly field chart)
// whose containing Card has `overflow-hidden`, which would otherwise clip an
// absolutely-positioned tooltip that pokes past the card's edge.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** `x`/`y` are viewport (fixed-position) coordinates of the anchor point —
 * the tooltip renders centered above it with a small gap. */
export function FloatingTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-50 min-w-max -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>,
    document.body,
  );
}
