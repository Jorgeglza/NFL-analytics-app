// Pythagorean expectation — new in Session 5 (not a port of the old app).
// Expected win% from points for/against (NFL exponent 2.37), matchup
// probability via the log5 formula. No home-field term (Elo carries that).

export const PYTH_EXP = 2.37;

/** Expected win share from points for/against; null when no scoring data. */
export function pythWinPct(pf: number, pa: number, exp = PYTH_EXP): number | null {
  if (!(pf > 0) && !(pa > 0)) return null;
  const a = Math.pow(pf, exp);
  const b = Math.pow(pa, exp);
  return a + b > 0 ? a / (a + b) : null;
}

/** log5: p(A beats B) given each side's win expectation. */
export function log5(pA: number, pB: number): number | null {
  const denom = pA * (1 - pB) + (1 - pA) * pB;
  return denom > 0 ? (pA * (1 - pB)) / denom : null;
}
