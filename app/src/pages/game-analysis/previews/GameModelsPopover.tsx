// Full-card "click to expand" popover for a Pick'em "This Week" game row —
// unlike ModelDotStrip's per-dot DotPopover (one model at a time), this shows
// every model's win probability for the game at once, framed by the row's
// situation annotation (agree / toss-up / disagree, per buildAnnotation in
// ThisWeekView.tsx). Subtle (anchored to the card, not a full-screen modal)
// but comprehensive.
import { useEffect, useRef, useState } from "react";
import { MODEL_KEYS, MODEL_COLORS, pickWinner, type MetricKey, type ProbBundle } from "./engine";
import { pairKey, type GameCategory, type AllAgreeStat, type PairwiseResolution, type TossUpAccuracy } from "./modelAgreement";

export interface GameModelsAnnotation {
  tone: "agree" | "tossup" | "disagree" | "unknown";
  title: string;
}

// Minimum sample size before a historical figure is shown at full strength —
// matches ANNOTATION_MIN_N in ThisWeekView.tsx so the two stay consistent.
const HIST_MIN_N = 5;

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
      <span
        className="w-9 shrink-0 truncate rounded-full px-1.5 py-0.5 text-center text-[9px] font-bold text-white"
        style={{ background: color }}
        title={`${label} favors ${side === "home" ? home : away}`}
      >
        {side === "home" ? home : away}
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

/** One historical-accuracy row: a model label plus its win rate in whatever
 * situational bucket is being compared (a specific pair's disagreements, or
 * near-50/50 toss-ups) — the actual number behind the one-line annotation
 * banner, so "who's usually right in spots like this" isn't just asserted. */
function HistRow({ label, color, acc, n }: { label: string; color?: string; acc: number | null; n: number }) {
  const thin = n < HIST_MIN_N;
  return (
    <div className={`flex items-center justify-between gap-2 py-1 text-[11px] ${thin ? "opacity-50" : ""}`}>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-600">
        {color && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-slate-700">
        {acc == null ? "—" : <span className="font-bold">{Math.round(acc * 100)}%</span>} <span className="text-slate-400">(n={n})</span>
      </span>
    </div>
  );
}

/** The "compared to history" section: what actually backs the annotation
 * banner's one-line claim, broken out by the specific situation this game
 * falls into — a two-model comparison for a disagreement, or the full
 * model ranking for a toss-up (models "in the close-to-50 bucket"). */
function HistoricalSection({
  category,
  allAgreeStat,
  pairwiseResolution,
  tossUpAccuracy,
}: {
  category: GameCategory;
  allAgreeStat: AllAgreeStat;
  pairwiseResolution: Map<string, PairwiseResolution>;
  tossUpAccuracy: Map<MetricKey, TossUpAccuracy>;
}) {
  if (category.kind === "disagree") {
    const res = pairwiseResolution.get(pairKey(category.a, category.b));
    if (!res || res.n === 0) return null;
    return (
      <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">When these two have split before</div>
        <HistRow label={SHORT_LABEL[res.a]} color={MODEL_COLORS[res.a]} acc={res.accA} n={res.n} />
        <HistRow label={SHORT_LABEL[res.b]} color={MODEL_COLORS[res.b]} acc={res.accB} n={res.n} />
      </div>
    );
  }
  if (category.kind === "toss-up") {
    const rows = MODEL_KEYS.map(([k, ]) => ({ k, ...(tossUpAccuracy.get(k) ?? { acc: null, n: 0 }) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => (b.acc ?? -1) - (a.acc ?? -1));
    if (!rows.length) return null;
    return (
      <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Accuracy in toss-up games (near 50/50)</div>
        {rows.map((r) => (
          <HistRow key={r.k} label={SHORT_LABEL[r.k]} color={MODEL_COLORS[r.k]} acc={r.acc} n={r.n} />
        ))}
      </div>
    );
  }
  if (category.kind === "all-agree" && allAgreeStat.n > 0) {
    return (
      <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">When every model agrees like this</div>
        <HistRow label="Agreed side wins" acc={allAgreeStat.winRate} n={allAgreeStat.n} />
      </div>
    );
  }
  return null;
}

/** Card-level popover listing every model's home/away win probability for a
 * game, anchored to (and dismissed independently of) the row it belongs to. */
export function GameModelsPopover({
  bundle,
  away,
  home,
  actual,
  annotation,
  category,
  allAgreeStat,
  pairwiseResolution,
  tossUpAccuracy,
  triggerRef,
  onClose,
}: {
  bundle: ProbBundle;
  away: string;
  home: string;
  actual: "home" | "away" | null;
  annotation: GameModelsAnnotation;
  category: GameCategory;
  allAgreeStat: AllAgreeStat;
  pairwiseResolution: Map<string, PairwiseResolution>;
  tossUpAccuracy: Map<MetricKey, TossUpAccuracy>;
  /** The button that opens/closes this popover. On touch, `touchstart` fires
   * (and is treated as "outside") before the trigger's own click-driven toggle
   * runs — without excluding it here, re-tapping the trigger to close would
   * close-via-outside-touch and then immediately reopen via the trigger's own
   * toggle, so a second tap would appear to do nothing. */
  triggerRef?: React.RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    const onOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
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
      <HistoricalSection category={category} allAgreeStat={allAgreeStat} pairwiseResolution={pairwiseResolution} tossUpAccuracy={tossUpAccuracy} />
      <div className="divide-y divide-slate-100">
        {rows.map(([k]) => (
          <ModelRow key={k} label={SHORT_LABEL[k]} color={MODEL_COLORS[k]} away={away} home={home} pH={bundle[k][1]!} actual={actual} emphasize={k === "consensus"} />
        ))}
      </div>
    </div>
  );
}
