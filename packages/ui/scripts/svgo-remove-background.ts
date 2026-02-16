/**
 * Custom svgo v3 plugin: removeBackground
 *
 * Detects and removes background shapes (rects, rounded-rect paths, large traced
 * bitmaps) from the SVG AST.  Captures the removed element's fill color so the
 * caller can use it as `colorPrimary`.
 *
 * Usage:
 *   const bg = createRemoveBackgroundPlugin()
 *   // pass bg.plugin in svgoConfig.plugins
 *   // after transform: bg.getBackgroundFill()
 */

import {
  colorToLuminance,
  isLargeShape,
  isNearWhiteFill,
  isWhiteFill,
  parseSvgPathBounds,
  parseViewBox
} from './svg-utils'

const xast = require('svgo/lib/xast')
const detachNodeFromParent: (node: any, parent: any) => void = xast.detachNodeFromParent

/** Regex patterns for rounded-rect path commands ([\d.]+ to handle decimal coords like 4.99999). */
const ROUNDED_RECT_PATTERNS = [
  /^M[\d.]+[\s,]+0H[\d.]+C/, // M18 0H6C... or M19 0H4.99999C...
  /^M0[\s,]+[\d.]+C/, // M0 6C...
  /^M0[\s,]+0[HVhv]/, // M0 0H...
  /^M[\d.]+[\s,]+[\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+Z?$/i // Simple rect
]

function isRoundedRectPath(d: string): boolean {
  const trimmed = d.trim()
  return ROUNDED_RECT_PATTERNS.some((p) => p.test(trimmed))
}

function pathCommandCount(d: string): number {
  return (d.match(/[a-zA-Z]/g) || []).length
}

interface PathInfo {
  node: any
  parent: any
  d: string
  area: number
  fill: string
  resolvedFill: string // Resolved from gradient url(#id) to actual color
  lum: number
  cmdCount: number
  isWhite: boolean
}

interface RemoveBackgroundOptions {
  /** If true, only detect background fill without removing elements. Used for color.tsx generation. */
  detectOnly?: boolean
}

export function createRemoveBackgroundPlugin(options: RemoveBackgroundOptions = {}) {
  const { detectOnly = false } = options
  let backgroundFill: string | null = null
  let removed = false

  const plugin = {
    name: 'removeBackground',
    fn: (root: any) => {
      // Pre-scan: find <svg> element and extract viewBox
      let svgNode: any = null
      for (const child of root.children) {
        if (child.type === 'element' && child.name === 'svg') {
          svgNode = child
          break
        }
      }
      if (!svgNode) return {}

      const vb = parseViewBox(svgNode.attributes)
      const vbArea = vb.w * vb.h

      // Collect gradient definitions for resolving url(#id) fills
      const gradients = new Map<string, string>()
      function collectGradients(node: any) {
        const children = node.children || []
        for (const child of children) {
          if (child.type !== 'element') continue
          if (child.name === 'linearGradient' || child.name === 'radialGradient') {
            const id = child.attributes?.id
            if (id) {
              const stops = (child.children || []).filter((s: any) => s.type === 'element' && s.name === 'stop')
              if (stops.length > 0) {
                // Use first stop color as representative brand color
                const color = stops[0].attributes?.['stop-color']
                if (color) gradients.set(id, color)
              }
            }
          }
          if (child.children?.length > 0) collectGradients(child)
        }
      }
      collectGradients(svgNode)

      function resolveGradientFill(fill: string): string {
        if (!fill || !fill.startsWith('url(')) return fill
        const m = fill.match(/url\(#([^)]+)\)/)
        return m ? gradients.get(m[1]) || '' : ''
      }

      // Collect all <path> and <rect> info in document order
      const paths: PathInfo[] = []
      const rects: { node: any; parent: any; w: number; h: number; fill: string; resolvedFill: string }[] = []

      function collectElements(node: any) {
        const children = node.children || []
        for (const child of children) {
          if (child.type !== 'element') continue

          // Skip non-visual elements: <defs>, <mask>, <clipPath>
          if (child.name === 'defs' || child.name === 'mask' || child.name === 'clipPath') continue

          if (child.name === 'rect') {
            const w = parseFloat(child.attributes.width || '0')
            const h = parseFloat(child.attributes.height || '0')
            const fill = child.attributes.fill || ''
            const resolved = resolveGradientFill(fill)
            rects.push({ node: child, parent: node, w, h, fill, resolvedFill: resolved })
          }

          if (child.name === 'path') {
            const d = child.attributes.d || ''
            if (!d) continue

            const fill = child.attributes.fill || ''
            const bounds = parseSvgPathBounds(d)
            let area = 0
            if (isFinite(bounds.minX)) {
              // Account for transform="translate(x,y)"
              const transformAttr = child.attributes.transform || ''
              const tx = transformAttr.match(/translate\((-?[\d.]+)[,\s]+(-?[\d.]+)\)/)
              if (tx) {
                const dx = parseFloat(tx[1]) || 0
                const dy = parseFloat(tx[2]) || 0
                bounds.minX += dx
                bounds.maxX += dx
                bounds.minY += dy
                bounds.maxY += dy
              }
              area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
            }

            const resolved = resolveGradientFill(fill)
            const lum = resolved ? colorToLuminance(resolved) : 0 // no fill attr → implicit black
            paths.push({
              node: child,
              parent: node,
              d,
              area,
              fill,
              resolvedFill: resolved,
              lum,
              cmdCount: pathCommandCount(d),
              isWhite: isWhiteFill(resolved)
            })
          }

          // Recurse into child elements (groups, etc.)
          if (child.children && child.children.length > 0) {
            collectElements(child)
          }
        }
      }

      collectElements(svgNode)

      // Helper: mark background detected, optionally remove from AST
      function markBackground(node: any, parent: any, fill: string | null) {
        if (fill) backgroundFill = fill
        if (!detectOnly) detachNodeFromParent(node, parent)
        removed = true
      }

      // --- Rule 1: <rect> covering >= 70% viewBox → remove ---
      for (const rect of rects) {
        if (rect.w >= vb.w * 0.7 && rect.h >= vb.h * 0.7) {
          const color = rect.resolvedFill || rect.fill
          const bg = color && !isWhiteFill(color) && color !== 'none' ? color : null
          markBackground(rect.node, rect.parent, bg)
          break
        }
      }

      if (!removed) {
        // --- Rule 2: First <path> matching rounded-rect pattern AND >= 70% viewBox ---
        for (const p of paths) {
          if (isRoundedRectPath(p.d) && p.area >= vbArea * 0.7) {
            const color = p.resolvedFill || p.fill
            const bg = color && !isWhiteFill(color) && color !== 'none' ? color : null
            markBackground(p.node, p.parent, bg)
            break
          }
        }
      }

      if (!removed) {
        // Check if there are white foreground paths (indicates dark bg + light content pattern)
        const hasWhiteFg = paths.some((p) => p.isWhite)

        if (hasWhiteFg) {
          // Separate large non-white paths (potential backgrounds)
          const largeNonWhitePaths = paths.filter(
            (p) => !p.isWhite && p.fill !== 'none' && isLargeShape(p.d, vb.w, vb.h, 0.3)
          )

          // --- Rule 3: Largest <path> covering >= 90% viewBox AND dark (lum < 0.15) → remove ---
          const sorted = [...largeNonWhitePaths].sort((a, b) => b.area - a.area)
          if (sorted.length >= 1 && sorted[0].area >= vbArea * 0.9 && sorted[0].lum >= 0 && sorted[0].lum < 0.15) {
            markBackground(sorted[0].node, sorted[0].parent, sorted[0].resolvedFill || sorted[0].fill || '#000000')
          }

          // --- Rule 3b: Dominant dark shape covering >= 60% with multiple large shapes ---
          if (
            !removed &&
            sorted.length >= 2 &&
            sorted[0].area >= vbArea * 0.6 &&
            sorted[0].lum >= 0 &&
            sorted[0].lum < 0.15
          ) {
            markBackground(sorted[0].node, sorted[0].parent, sorted[0].resolvedFill || sorted[0].fill || '#000000')
          }
        }
      }

      if (!removed) {
        // --- Rule 3c: First <path> covering >= 85% viewBox with near-white foreground ---
        // Targets vectorized (traced) backgrounds from @neplex/vectorizer output.
        // The vectorizer produces a large filled path as the first element (background),
        // followed by lighter detail paths (e.g. IBM icon with #002D72 bg and #CDDDEC/#EFF4F9 text).
        const hasNearWhiteFg = paths.some(
          (p) => isNearWhiteFill(p.resolvedFill || p.fill) && !isLargeShape(p.d, vb.w, vb.h, 0.85)
        )

        if (hasNearWhiteFg && paths.length >= 2) {
          const first = paths[0]
          if (
            first.area >= vbArea * 0.85 &&
            first.lum >= 0 &&
            first.lum < 0.5 &&
            !isNearWhiteFill(first.resolvedFill || first.fill)
          ) {
            markBackground(first.node, first.parent, first.resolvedFill || first.fill || '#000000')
          }
        }
      }

      if (!removed) {
        // --- Rule 4: First large white <path> covering >= 60% viewBox → remove ---
        for (const p of paths) {
          if (p.isWhite && p.area >= vbArea * 0.6 && p.cmdCount <= 10) {
            // Only remove simple white backgrounds, not complex white shapes (like huggingface body)
            markBackground(p.node, p.parent, null)
            break
          }
        }
      }

      return {}
    }
  }

  return {
    plugin,
    getBackgroundFill: () => backgroundFill,
    wasRemoved: () => removed
  }
}
