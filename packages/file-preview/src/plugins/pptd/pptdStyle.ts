/**
 * Theme reference and fill resolution for PPTD, following the upstream
 * reference's color rules (HEX6, HEX8 with alpha, `$key` theme references).
 */
import type { CSSProperties } from 'react'

import type { PptdFill, PptdTheme } from './pptdFormat'

export interface PptdStyleContext {
  theme?: PptdTheme
}

/** Resolves `$key` theme references; returns undefined for unknown references. */
export function resolvePptdColor(color: string | undefined, context: PptdStyleContext): string | undefined {
  if (!color) return undefined
  if (color.startsWith('$')) {
    const key = color.slice(1)
    return context.theme?.colors?.[key] ?? undefined
  }
  return color
}

/** Converts HEX8 (#RRGGBBAA) to rgba(); passes everything else through. */
export function pptdColorToCss(color: string | undefined, context: PptdStyleContext): string | undefined {
  const resolved = resolvePptdColor(color, context)
  if (!resolved) return undefined
  const hex8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(resolved)
  if (hex8) {
    const alpha = Math.round((parseInt(hex8[2], 16) / 255) * 1000) / 1000
    const r = parseInt(hex8[1].slice(0, 2), 16)
    const g = parseInt(hex8[1].slice(2, 4), 16)
    const b = parseInt(hex8[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return resolved
}

/**
 * CSS for solid and gradient fills. Image fills are handled by the slide
 * canvas, which can resolve local media through the host.
 */
export function pptdFillToCss(fill: PptdFill | undefined, context: PptdStyleContext): CSSProperties | undefined {
  if (!fill) return undefined
  if (fill.type === 'solid') {
    const color = pptdColorToCss(fill.color, context)
    return color ? { background: color } : undefined
  }
  if (fill.type === 'gradient') {
    const stops = fill.stops
      .map((stop) => {
        const color = pptdColorToCss(stop.color, context) ?? '#000000'
        return `${color} ${Math.round(stop.position * 100)}%`
      })
      .join(', ')
    if (fill.gradientType === 'radial') {
      return { background: `radial-gradient(circle, ${stops})` }
    }
    // Upstream: 0 = left to right, increasing clockwise; CSS 90deg = left to right.
    const angle = (fill.angle ?? 0) + 90
    return { background: `linear-gradient(${angle}deg, ${stops})` }
  }
  return undefined
}
