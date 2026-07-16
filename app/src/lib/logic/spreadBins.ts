// Spread bucketing — port of the pd.cut(right=False, include_lowest=True)
// binning duplicated across three pages.

export interface SpreadBin {
  label: string;
  lo: number;
  hi: number; // exclusive
}

export function binEdges(values: number[], binSize: number): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [];
  const lo = Math.floor(Math.min(...finite) / binSize) * binSize;
  const hi = Math.ceil(Math.max(...finite) / binSize) * binSize + binSize;
  const edges: number[] = [];
  for (let e = lo; e <= hi + 1e-9; e += binSize) edges.push(Number(e.toFixed(4)));
  return edges;
}

export function assignBin(value: number, edges: number[]): SpreadBin | null {
  if (!Number.isFinite(value) || edges.length < 2) return null;
  for (let i = 0; i < edges.length - 1; i++) {
    // right=false: [lo, hi)
    if (value >= edges[i] && value < edges[i + 1]) {
      return { label: `${edges[i]} to ${edges[i + 1]}`, lo: edges[i], hi: edges[i + 1] };
    }
  }
  return null;
}

export function spreadValue(spreadLine: number, signed: boolean): number {
  return signed ? spreadLine : Math.abs(spreadLine);
}
