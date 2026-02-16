/**
 * Shared SVG utility functions for icon generation scripts.
 *
 * Used by both generate-icons.ts and generate-mono-icons.ts.
 */

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Parse an SVG path `d` attribute and return a conservative bounding box.
 * For curves the control points are included, which may slightly overestimate
 * the bounds — this is acceptable for icon viewBox calculation.
 */
export function parseSvgPathBounds(d: string): BBox {
  const bounds: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  let cx = 0,
    cy = 0,
    startX = 0,
    startY = 0

  const addPoint = (x: number, y: number) => {
    if (isFinite(x) && isFinite(y)) {
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
    }
  }

  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []
  let i = 0
  const num = () => parseFloat(tokens[i++])
  const hasNum = () => i < tokens.length && /^[-+.\d]/.test(tokens[i])

  while (i < tokens.length) {
    const cmd = tokens[i++]
    switch (cmd) {
      case 'M':
        cx = num()
        cy = num()
        startX = cx
        startY = cy
        addPoint(cx, cy)
        while (hasNum()) {
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'm':
        cx += num()
        cy += num()
        startX = cx
        startY = cy
        addPoint(cx, cy)
        while (hasNum()) {
          cx += num()
          cy += num()
          addPoint(cx, cy)
        }
        break
      case 'L':
        while (hasNum()) {
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'l':
        while (hasNum()) {
          cx += num()
          cy += num()
          addPoint(cx, cy)
        }
        break
      case 'H':
        while (hasNum()) {
          cx = num()
          addPoint(cx, cy)
        }
        break
      case 'h':
        while (hasNum()) {
          cx += num()
          addPoint(cx, cy)
        }
        break
      case 'V':
        while (hasNum()) {
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'v':
        while (hasNum()) {
          cy += num()
          addPoint(cx, cy)
        }
        break
      case 'C':
        while (hasNum()) {
          addPoint(num(), num())
          addPoint(num(), num())
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'c':
        while (hasNum()) {
          const ox = cx,
            oy = cy
          addPoint(ox + num(), oy + num())
          addPoint(ox + num(), oy + num())
          cx = ox + num()
          cy = oy + num()
          addPoint(cx, cy)
        }
        break
      case 'S':
        while (hasNum()) {
          addPoint(num(), num())
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 's':
        while (hasNum()) {
          const ox = cx,
            oy = cy
          addPoint(ox + num(), oy + num())
          cx = ox + num()
          cy = oy + num()
          addPoint(cx, cy)
        }
        break
      case 'Q':
        while (hasNum()) {
          addPoint(num(), num())
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'q':
        while (hasNum()) {
          const ox = cx,
            oy = cy
          addPoint(ox + num(), oy + num())
          cx = ox + num()
          cy = oy + num()
          addPoint(cx, cy)
        }
        break
      case 'T':
        while (hasNum()) {
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 't':
        while (hasNum()) {
          cx += num()
          cy += num()
          addPoint(cx, cy)
        }
        break
      case 'A':
        while (hasNum()) {
          const rx = num(),
            ry = num()
          num()
          num()
          num()
          cx = num()
          cy = num()
          addPoint(cx - rx, cy - ry)
          addPoint(cx + rx, cy + ry)
        }
        break
      case 'a':
        while (hasNum()) {
          const rx = num(),
            ry = num()
          num()
          num()
          num()
          cx += num()
          cy += num()
          addPoint(cx - rx, cy - ry)
          addPoint(cx + rx, cy + ry)
        }
        break
      case 'Z':
      case 'z':
        cx = startX
        cy = startY
        break
    }
  }

  return bounds
}

/**
 * Parse a hex color (#RGB or #RRGGBB) and return perceived luminance (0–1).
 * Returns -1 for unparseable values (e.g. url(#gradient), named colors other than white/black).
 */
export function colorToLuminance(hex: string): number {
  const h = hex.replace(/^#/, '')
  let r: number, g: number, b: number
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16) / 255
    g = parseInt(h[1] + h[1], 16) / 255
    b = parseInt(h[2] + h[2], 16) / 255
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16) / 255
    g = parseInt(h.slice(2, 4), 16) / 255
    b = parseInt(h.slice(4, 6), 16) / 255
  } else {
    if (/^black$/i.test(hex)) return 0
    if (/^white$/i.test(hex)) return 1
    return -1
  }
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Check if a fill value is white or near-white (all RGB channels >= 240).
 */
export function isWhiteFill(fillValue: string): boolean {
  if (/^(?:white|#fff(?:fff)?)$/i.test(fillValue)) return true
  const hex = fillValue.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const r = parseInt(hex[1].slice(0, 2), 16)
    const g = parseInt(hex[1].slice(2, 4), 16)
    const b = parseInt(hex[1].slice(4, 6), 16)
    return r >= 240 && g >= 240 && b >= 240
  }
  return false
}

/**
 * Check if a fill value is near-white (all RGB channels >= threshold).
 * Uses a looser threshold (default 220) than isWhiteFill (240).
 * Used for detecting light foreground content in vectorized icons.
 */
export function isNearWhiteFill(fillValue: string, threshold = 220): boolean {
  if (/^(?:white|#fff(?:fff)?)$/i.test(fillValue)) return true
  const hex = fillValue.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const r = parseInt(hex[1].slice(0, 2), 16)
    const g = parseInt(hex[1].slice(2, 4), 16)
    const b = parseInt(hex[1].slice(4, 6), 16)
    return r >= threshold && g >= threshold && b >= threshold
  }
  return false
}

/**
 * Check if a path's bounding box covers a large portion of the viewBox.
 */
export function isLargeShape(pathD: string, vbW: number, vbH: number, threshold = 0.3): boolean {
  const bounds = parseSvgPathBounds(pathD)
  if (!isFinite(bounds.minX)) return false
  const pathArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
  return pathArea > vbW * vbH * threshold
}

/**
 * Parse the viewBox from an SVG element's attributes record.
 * Returns { x, y, w, h } or defaults to { 0, 0, 24, 24 }.
 */
export function parseViewBox(attrs: Record<string, string>): { x: number; y: number; w: number; h: number } {
  const vb = attrs.viewBox || attrs.viewbox
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(isFinite)) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
    }
  }
  // Fall back to width/height if present
  const w = parseFloat(attrs.width)
  const h = parseFloat(attrs.height)
  if (isFinite(w) && isFinite(h)) {
    return { x: 0, y: 0, w, h }
  }
  return { x: 0, y: 0, w: 24, h: 24 }
}

/**
 * Normalize a fill/color string to a canonical hex form for comparison.
 * Returns the original string if it can't be normalized.
 */
export function normalizeColor(color: string): string {
  if (!color || color === 'none' || color === 'currentColor' || color.startsWith('url(')) {
    return color
  }
  // Expand 3-char hex to 6-char
  const m3 = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (m3) {
    return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase()
  }
  const m6 = color.match(/^#[0-9a-f]{6}$/i)
  if (m6) {
    return color.toUpperCase()
  }
  return color
}
