// Wilson score interval (95%, z = 1.96) — single implementation of the logic
// duplicated across spread_win_percentage_page_6.py and matchup preview tabs.

export function wilson(p: number, n: number, z = 1.96): { center: number; low: number; high: number } {
  if (n <= 0) return { center: 0.5, low: 0, high: 1 };
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    center,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}
