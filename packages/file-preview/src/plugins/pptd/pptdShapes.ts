/**
 * SVG path generation for the PPTD built-in shapes, in a 100000 x 100000
 * coordinate space matching the OOXML adjustment conventions from the
 * reference (values are thousandths of a percent of the relevant side).
 */

const SIZE = 100000

function pt(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`
}

function polygon(points: readonly (readonly [number, number])[]): string {
  return `M${points.map(([x, y]) => pt(x, y)).join('L')}Z`
}

/** Regular n-gon inscribed in the box, first vertex at top center. */
function regularPolygon(sides: number): string {
  const points: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2
    points.push([SIZE / 2 + (SIZE / 2) * Math.cos(angle), SIZE / 2 + (SIZE / 2) * Math.sin(angle)])
  }
  return polygon(points)
}

/** Full circle as two half arcs; a single 0-360 arc degenerates to a point. */
function fullCircle(cx: number, cy: number, r: number): string {
  return `M${pt(cx - r, cy)}A${r},${r} 0 1 1 ${pt(cx + r, cy)}A${r},${r} 0 1 1 ${pt(cx - r, cy)}Z`
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = ((startDeg - 90) * Math.PI) / 180
  const end = ((endDeg - 90) * Math.PI) / 180
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M${pt(cx + r * Math.cos(start), cy + r * Math.sin(start))}A${r},${r} 0 ${large} 1 ${pt(cx + r * Math.cos(end), cy + r * Math.sin(end))}`
}

/**
 * Returns an SVG path for the shape, or null when the shape is unknown so
 * the caller can fall back to the named placeholder.
 */
export function pptdShapePath(shapeName: string, adjustments: readonly number[] = []): string | null {
  const adj = (index: number, fallback: number) => adjustments[index] ?? fallback
  switch (shapeName) {
    case 'rect':
      return polygon([
        [0, 0],
        [SIZE, 0],
        [SIZE, SIZE],
        [0, SIZE]
      ])
    case 'roundRect': {
      const radius = Math.min((adj(0, 16667) / 100000) * SIZE, SIZE / 2)
      return `M${pt(radius, 0)}H${SIZE - radius}A${radius},${radius} 0 0 1 ${pt(SIZE, radius)}V${SIZE - radius}A${radius},${radius} 0 0 1 ${pt(SIZE - radius, SIZE)}H${radius}A${radius},${radius} 0 0 1 ${pt(0, SIZE - radius)}V${radius}A${radius},${radius} 0 0 1 ${pt(radius, 0)}Z`
    }
    case 'ellipse':
      return fullCircle(SIZE / 2, SIZE / 2, SIZE / 2)
    case 'triangle':
      return polygon([
        [adj(0, 50000), 0],
        [SIZE, SIZE],
        [0, SIZE]
      ])
    case 'rtTriangle':
      return polygon([
        [0, 0],
        [SIZE, SIZE],
        [0, SIZE]
      ])
    case 'parallelogram': {
      const s = adj(0, 25000)
      return polygon([
        [s, 0],
        [SIZE, 0],
        [SIZE - s, SIZE],
        [0, SIZE]
      ])
    }
    case 'trapezoid': {
      const t = adj(0, 25000)
      return polygon([
        [t, 0],
        [SIZE - t, 0],
        [SIZE, SIZE],
        [0, SIZE]
      ])
    }
    case 'nonIsoscelesTrapezoid':
      return polygon([
        [adj(0, 25000), 0],
        [SIZE - adj(1, 25000), 0],
        [SIZE, SIZE],
        [0, SIZE]
      ])
    case 'diamond':
      return polygon([
        [SIZE / 2, 0],
        [SIZE, SIZE / 2],
        [SIZE / 2, SIZE],
        [0, SIZE / 2]
      ])
    case 'pentagon':
      return regularPolygon(5)
    case 'hexagon':
      return regularPolygon(6)
    case 'heptagon':
      return regularPolygon(7)
    case 'octagon': {
      const c = adj(0, 29289)
      return polygon([
        [c, 0],
        [SIZE - c, 0],
        [SIZE, c],
        [SIZE, SIZE - c],
        [SIZE - c, SIZE],
        [c, SIZE],
        [0, SIZE - c],
        [0, c]
      ])
    }
    case 'decagon':
      return regularPolygon(10)
    case 'dodecagon':
      return regularPolygon(12)
    case 'plus': {
      const arm = adj(0, 25000)
      const edge = (SIZE - arm) / 2
      return polygon([
        [edge, 0],
        [edge + arm, 0],
        [edge + arm, edge],
        [SIZE, edge],
        [SIZE, edge + arm],
        [edge + arm, edge + arm],
        [edge + arm, SIZE],
        [edge, SIZE],
        [edge, edge + arm],
        [0, edge + arm],
        [0, edge],
        [edge, edge]
      ])
    }
    case 'homePlate': {
      const tip = adj(0, 50000)
      return polygon([
        [0, 0],
        [SIZE - tip, 0],
        [SIZE, SIZE / 2],
        [SIZE - tip, SIZE],
        [0, SIZE]
      ])
    }
    case 'chevron': {
      const tip = adj(0, 50000)
      return polygon([
        [0, 0],
        [SIZE - tip, 0],
        [SIZE, SIZE / 2],
        [SIZE - tip, SIZE],
        [0, SIZE],
        [tip, SIZE / 2]
      ])
    }
    case 'donut': {
      const inner = SIZE / 2 - (adj(0, 25000) / 100000) * SIZE
      return `${fullCircle(SIZE / 2, SIZE / 2, SIZE / 2)}${fullCircle(SIZE / 2, SIZE / 2, Math.max(inner, 1))}`
    }
    case 'pie': {
      const [start, end] = [adj(0, 0) / 60000, adj(1, 16200000) / 60000]
      return `${arc(SIZE / 2, SIZE / 2, SIZE / 2, start, end)}L${pt(SIZE / 2, SIZE / 2)}Z`
    }
    default:
      return null
  }
}

/** Shapes whose path uses subpaths that need even-odd fill. */
export function pptdShapeFillRule(shapeName: string): 'evenodd' | 'nonzero' {
  return shapeName === 'donut' ? 'evenodd' : 'nonzero'
}
