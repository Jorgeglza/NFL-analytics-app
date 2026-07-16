// Spread Pick Engine constants + blending — port of matchup_previews_tab.py
// (identical constants in model_overview_tab.py).

export const BIN_SIZE_DEFAULT = 1.0;
export const SIGNED_SPREAD = true;
export const MIN_N_BUCKET = 25;
export const BLEND_MARKET_W = 0.6;
export const BLEND_MODEL_W = 0.4;
export const MODEL_SCALE = 0.085;

/** p(away wins) from grade differential (logistic). */
export function gradeModelProb(gradeAway: number | null, gradeHome: number | null): number | null {
  if (gradeAway == null || gradeHome == null) return null;
  return 1 / (1 + Math.exp(-MODEL_SCALE * (gradeAway - gradeHome)));
}

/** Blend market-calibrated and model probabilities; falls back to whichever exists. */
export function blendProbs(pMarket: number | null, pModel: number | null): number | null {
  if (pMarket != null && pModel != null) return BLEND_MARKET_W * pMarket + BLEND_MODEL_W * pModel;
  return pMarket ?? pModel;
}

/** Confidence % — |p-0.5|*2 scaled by bucket sample size. */
export function confidence(p: number, nBucket: number): number {
  const edge = Math.abs(p - 0.5) * 2;
  const nFactor = Math.min(1, nBucket / MIN_N_BUCKET);
  return 100 * edge * (0.7 + 0.3 * nFactor);
}
