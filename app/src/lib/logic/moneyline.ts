// Moneyline math — port of the implied/fair probability logic duplicated in
// matchup_previews_tab.py and week_preview_tab.py.

export function impliedProb(ml: number | null): number | null {
  if (ml == null || !Number.isFinite(ml) || ml === 0) return null;
  return ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100);
}

export interface FairProbs {
  awayFair: number | null;
  homeFair: number | null;
  overround: number | null;
}

export function fairProbs(awayMl: number | null, homeMl: number | null): FairProbs {
  const pa = impliedProb(awayMl);
  const ph = impliedProb(homeMl);
  if (pa == null || ph == null) return { awayFair: pa, homeFair: ph, overround: null };
  const total = pa + ph;
  return { awayFair: pa / total, homeFair: ph / total, overround: total - 1 };
}

/** Profit on a flat `stake`-unit moneyline bet at American odds `ml`: `-stake` on a
 * loss, and on a win, standard American-odds payout — positive ml pays `ml/100*stake`,
 * negative ml pays `100/|ml|*stake` (the odds actually taken, vig included; the
 * inverse of `impliedProb`). Returns `null` for missing/invalid odds so callers can
 * tell "no bet" apart from a real $0 result. */
export function payout(ml: number | null, stake: number, won: boolean): number | null {
  if (ml == null || !Number.isFinite(ml) || ml === 0) return null;
  if (!won) return -stake;
  return ml > 0 ? (ml / 100) * stake : (100 / -ml) * stake;
}
