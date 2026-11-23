/** Bezier path building for PPTD line elements. */

export type PptdLinePoint = readonly [number, number]

/** Parses the "x1,y1 x2,y2 ..." points string, dropping malformed pairs. */
export function parsePptdLinePoints(points: string): PptdLinePoint[] {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return [x, y] as PptdLinePoint
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
}

function deCasteljau(points: readonly PptdLinePoint[], t: number): PptdLinePoint {
  let level = points.map(([x, y]) => [x, y] as [number, number])
  while (level.length > 1) {
    const next: [number, number][] = []
    for (let i = 0; i < level.length - 1; i++) {
      next.push([level[i][0] + (level[i + 1][0] - level[i][0]) * t, level[i][1] + (level[i + 1][1] - level[i][1]) * t])
    }
    level = next
  }
  return level[0]
}

/**
 * Builds an SVG path through the points per the reference: sharp and round
 * join every point (the renderer picks the join style), smooth treats the
 * middle points as bezier control points. Curves with more than two control
 * points are sampled to a polyline, which is indistinguishable at preview
 * scale.
 */
export function pptdLinePath(
  points: readonly PptdLinePoint[],
  curve: 'sharp' | 'round' | 'smooth' = 'round'
): string | null {
  if (points.length < 2) return null
  const fmt = ([x, y]: PptdLinePoint) => `${x},${y}`
  if (curve !== 'smooth' || points.length === 2) {
    return `M${points.map(fmt).join('L')}`
  }
  if (points.length === 3) {
    return `M${fmt(points[0])}Q${fmt(points[1])} ${fmt(points[2])}`
  }
  if (points.length === 4) {
    return `M${fmt(points[0])}C${fmt(points[1])} ${fmt(points[2])} ${fmt(points[3])}`
  }
  const samples: PptdLinePoint[] = []
  const steps = 32
  for (let i = 0; i <= steps; i++) {
    samples.push(deCasteljau(points, i / steps))
  }
  return `M${samples.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join('L')}`
}
