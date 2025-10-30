export const Z_MAX = 2.5

export function zToDr(z: number, rDelta: number): number {
  const zc = Math.max(-Z_MAX, Math.min(Z_MAX, z))
  return (zc / Z_MAX) * rDelta
}

export function polar(cx: number, cy: number, r: number, theta: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) }
}

export type SizeScale = (raw: number) => number

export function buildSizeScale(mu: number, sigma: number, minPx: number, maxPx: number): SizeScale {
  const lo = mu - 2 * sigma
  const hi = mu + 2 * sigma
  return (raw: number) => {
    if (!isFinite(raw)) return minPx
    const t = (raw - lo) / Math.max(1e-9, hi - lo)
    return Math.max(minPx, Math.min(maxPx, minPx + t * (maxPx - minPx)))
  }
}
