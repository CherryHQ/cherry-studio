/**
 * Shared SVG utility functions for icon generation scripts.
 *
 * Used by generate-icons.ts, generate-mono-icons.ts, and generate-avatars.ts.
 */

import * as fs from 'fs'
import * as path from 'path'

export type LogoType = 'providers' | 'models'

export const OUTPUT_DIR_MAP: Record<LogoType, string> = {
  providers: path.join(__dirname, '../src/components/icons/providers'),
  models: path.join(__dirname, '../src/components/icons/models')
}

export const SVG_SOURCE_MAP: Record<LogoType, string> = {
  providers: path.join(__dirname, '../icons/providers'),
  models: path.join(__dirname, '../icons/models')
}

export function parseLogoTypeArg(): LogoType {
  const arg = process.argv.find((item) => item.startsWith('--type='))
  if (!arg) return 'providers'
  const value = arg.split('=')[1]
  if (value === 'providers' || value === 'models') return value
  throw new Error(`Invalid --type value: ${value}. Use "providers" or "models".`)
}

export function toCamelCase(filename: string): string {
  const name = filename.replace(/\.svg$/, '')
  const parts = name.split('-')
  if (parts.length === 1) return parts[0]
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  )
}

export function ensureViewBox(svgCode: string): string {
  if (/viewBox\s*=\s*"[^"]*"/.test(svgCode)) return svgCode

  const widthMatch = svgCode.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgCode.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/)

  if (widthMatch && heightMatch) {
    return svgCode.replace(/<svg\b/, `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`)
  }
  return svgCode
}

export function isImageBased(content: string): boolean {
  return content.includes('<image') || content.includes('data:image')
}

export function buildSvgMap(type: LogoType): Map<string, string> {
  const svgDir = SVG_SOURCE_MAP[type]
  const map = new Map<string, string>()
  if (!fs.existsSync(svgDir)) return map

  for (const file of fs.readdirSync(svgDir)) {
    if (!file.endsWith('.svg')) continue
    map.set(toCamelCase(file), path.join(svgDir, file))
  }
  return map
}

export function getComponentName(baseDir: string, dirName: string): string {
  const colorPath = path.join(baseDir, dirName, 'color.tsx')
  try {
    const content = fs.readFileSync(colorPath, 'utf-8')
    const match = content.match(/export \{ (\w+) \}/)
    if (match) return match[1]
  } catch {
    /* fallback */
  }
  return dirName.charAt(0).toUpperCase() + dirName.slice(1)
}

export function collectIconDirs(baseDir: string): string[] {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(baseDir, e.name, 'color.tsx')))
    .map((e) => e.name)
    .sort()
}

export function readColorPrimary(baseDir: string, dirName: string): string {
  const metaPath = path.join(baseDir, dirName, 'meta.ts')
  if (!fs.existsSync(metaPath)) return '#000000'
  const content = fs.readFileSync(metaPath, 'utf-8')
  const match = content.match(/colorPrimary:\s*'([^']+)'/)
  return match ? match[1] : '#000000'
}

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

  // SVG arc flags (0 or 1) can be concatenated without separators (e.g. "004.496" = flag 0, flag 0, x 4.496).
  // Split the leading flag digit from the rest of the token when needed.
  const splitArcFlag = () => {
    if (i < tokens.length && /^[01]/.test(tokens[i]) && tokens[i].length > 1) {
      const token = tokens[i]
      tokens.splice(i, 1, token[0], token.slice(1))
    }
    i++ // consume the flag
  }

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
          num()
          num() // rx, ry (skip — endpoint is sufficient for bounds)
          num() // rotation
          splitArcFlag()
          splitArcFlag()
          cx = num()
          cy = num()
          addPoint(cx, cy)
        }
        break
      case 'a':
        while (hasNum()) {
          num()
          num() // rx, ry
          num() // rotation
          splitArcFlag()
          splitArcFlag()
          cx += num()
          cy += num()
          addPoint(cx, cy)
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
 * Parse a hex color (#RGB or #RRGGBB) to normalized [r, g, b] (0–1).
 * Returns null for unparseable values.
 */
function parseHexRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, '')
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16) / 255, parseInt(h[1] + h[1], 16) / 255, parseInt(h[2] + h[2], 16) / 255]
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
  }
  return null
}

/**
 * Parse a hex color (#RGB or #RRGGBB) and return perceived luminance (0–1).
 * Returns -1 for unparseable values (e.g. url(#gradient), named colors other than white/black).
 */
export function colorToLuminance(hex: string): number {
  const rgb = parseHexRgb(hex)
  if (rgb) return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
  if (/^black$/i.test(hex)) return 0
  if (/^white$/i.test(hex)) return 1
  return -1
}

/**
 * Check if a fill value is near-white (all RGB channels >= threshold).
 * Default threshold 220 detects light foreground content in vectorized icons.
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
 * Check if a fill value is white or near-white (all RGB channels >= 240).
 */
export function isWhiteFill(fillValue: string): boolean {
  return isNearWhiteFill(fillValue, 240)
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
 * Parse a hex color to HSV saturation (0–1).
 * Returns -1 for unparseable values.
 */
function colorToSaturation(hex: string): number {
  const rgb = parseHexRgb(hex)
  if (!rgb) {
    if (/^(?:black|white)$/i.test(hex)) return 0
    return -1
  }
  const max = Math.max(...rgb)
  const min = Math.min(...rgb)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * Classify an SVG as monochrome (single-color or achromatic) and whether
 * it was designed for dark backgrounds (white/light content on transparent bg).
 *
 * Strips `<defs>...</defs>` blocks from analysis so clip-path and gradient
 * fills are not counted as content fills.
 */
export function isMonochromeSvg(svgContent: string): { monochrome: boolean; darkDesigned: boolean } {
  // Strip <defs>...</defs> blocks from analysis
  const stripped = svgContent.replace(/<defs[\s\S]*?<\/defs>/gi, '')

  // Extract all fill="..." / fill='...' and stroke="..." / stroke='...' values from content elements
  const fillMatches = [...stripped.matchAll(/fill=["']([^"']+)["']/g)]
  const strokeMatches = [...stripped.matchAll(/stroke=["']([^"']+)["']/g)]
  const fills = fillMatches.map(([, value]) => value)
  const strokes = strokeMatches.map(([, value]) => value)
  const allColors = [...fills, ...strokes]

  // If any content element uses gradient fills/strokes, the icon is colorful (not monochrome)
  const hasGradientFill = allColors.some((f) => f.startsWith('url('))
  if (hasGradientFill) {
    return { monochrome: false, darkDesigned: false }
  }

  // Filter out non-content colors
  const contentFills = allColors.filter((f) => f !== 'none' && f !== 'currentColor' && !isWhiteFill(f))

  if (contentFills.length === 0) {
    // No colored fills/strokes remain — all-white/transparent content
    const hasWhite = allColors.some((f) => isWhiteFill(f))
    return { monochrome: true, darkDesigned: hasWhite }
  }

  // Check if all remaining fills are perceptually achromatic.
  // A color is achromatic if:
  //   - HSV saturation < 0.1 (true gray), OR
  //   - luminance < 0.15 (perceptually black regardless of hue, e.g. #231F20, #1F0909)
  const allAchromatic = contentFills.every((f) => {
    const sat = colorToSaturation(f)
    if (sat >= 0 && sat < 0.1) return true
    const lum = colorToLuminance(f)
    return lum >= 0 && lum < 0.15
  })

  if (!allAchromatic) {
    return { monochrome: false, darkDesigned: false }
  }

  // All achromatic — check luminance to determine darkDesigned
  let totalLum = 0
  let lumCount = 0
  for (const f of contentFills) {
    const lum = colorToLuminance(f)
    if (lum >= 0) {
      totalLum += lum
      lumCount++
    }
  }

  const avgLum = lumCount > 0 ? totalLum / lumCount : 0
  return { monochrome: true, darkDesigned: avgLum > 0.6 }
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
