// Full-card "click to expand" popover for a Pick'em "This Week" game row —
// unlike ModelDotStrip's per-dot DotPopover (one model at a time), this shows
// every model's win probability for the game at once, framed by the row's
// situation annotation (agree / toss-up / disagree, per buildAnnotation in
// ThisWeekView.tsx). Subtle (anchored to the card, not a full-screen modal)
// but comprehensive.
import { useEffect, useRef, useState } from "react";
import { MODEL_KEYS, MODEL_COLORS, pickWinner, type MetricKey, type ProbBundle } from "./engine";

export interface GameModelsAnnotation {
  tone: "agree" | "tossup" | "disagree" | "unknown";
  title: string;
}

// Short labels so the 92px-wide column never truncates mid-word — the
// dot-strip color + this label is enough to identify the model at a glance.
const SHORT_LABEL: Record<MetricKey, string> = {
  consensus: "Average",
  ml: "ML Fair",
  blend: "Market-cal.",
  predictive: "Predictive",
  elo: "Elo",
  pyth: "Pythagorean",
  trend: "Trend Edge",
};

const TONE_CLS: Record<GameModelsAnnotation["tone"], string> = {
  agree: "border-emerald-200 bg-emerald-50 text-emerald-700",
  tossup: "border-amber-200 bg-amber-50 text-amber-700",
  disagree: "border-sky-200 bg-sky-50 text-sky-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-500",
};

function ModelRow({
  label,
  color,
  away,
  home,
  pH,
  actual,
  emphasize,
}: {
  label: string;
  color: string;
  away: string;
  home: string;
  pH: number;
  actual: "home" | "away" | null;
  emphasize?: boolean;
}) {
  const pctAway = Math.round(100 * (1 - pH));
  const pctHome = Math.round(100 * pH);
  const side = pickWinner([1 - pH, pH]);
  const correct = actual != null ? side === actual : null;

  return (
    <div className={`flex items-center gap-2 py-1.5 ${emphasize ? "" : ""}`}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className={`w-[76px] shrink-0 truncate text-[11px] ${emphasize ? "font-bold text-slate-800" : "font-medium text-slate-600"}`}>{label}</span>
      <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pctHome}%`, background: color, opacity: 0.85 }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
      </div>
      <span className="w-[92px] shrink-0 text-right text-[10px] tabular-nums text-slate-500">
        <span className={side === "away" ? "font-bold text-slate-700" : undefined}>{away} {pctAway}%</span> ·{" "}
        <span className={side === "home" ? "font-bold text-slate-700" : undefined}>{home} {pctHome}%</span>
      </span>
      {correct != null ? (
        <span className={`w-5 shrink-0 text-center text-[11px] font-bold ${correct ? "text-emerald-600" : "text-rose-500"}`} title={correct ? "Correct" : "Incorrect"}>
          {correct ? "✓" : "✗"}
        </span>
      ) : (
        <span className="w-5 shrink-0" />
      )}
    </div>
  );
}

/** Card-level popover listing every model's home/away win probability for a
 * game, anchored to (and dismissed independently of) the row it belongs to. */
export function GameModelsPopover({
  bundle,
  away,
  home,
  actual,
  annotation,
  onClose,
}: {
  bundle: ProbBundle;
  away: string;
  home: string;
  actual: "home" | "away" | null;
  annotation: GameModelsAnnotation;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", onOutside);
    document.addEventListener("touchstart", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onOutside);
      document.removeEventListener("touchstart", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Flip above the card when there isn't room below (near the bottom of the viewport).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFlip(rect.bottom > window.innerHeight);
  }, []);

  const rows = MODEL_KEYS.filter(([k]) => bundle[k][1] != null);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Model probabilities for ${away} at ${home}`}
      onClick={(e) => e.stopPropagation()}
      className={`absolute left-0 right-0 z-30 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-lg sm:left-1/2 sm:right-auto sm:w-[24rem] sm:-translate-x-1/2 ${flip ? "bottom-full mb-2" : "top-full mt-2"}`}
    >
      <div className={`mb-2 rounded-lg border px-2 py-1.5 text-[11px] leading-snug ${TONE_CLS[annotation.tone]}`}>{annotation.title}</div>
      <div className="divide-y divide-slate-100">
        {rows.map(([k]) => (
          <ModelRow key={k} label={SHORT_LABEL[k]} color={MODEL_COLORS[k]} away={away} home={home} pH={bundle[k][1]!} actual={actual} emphasize={k === "consensus"} />
        ))}
      </div>
    </div>
  );
}
