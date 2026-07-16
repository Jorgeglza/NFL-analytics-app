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
