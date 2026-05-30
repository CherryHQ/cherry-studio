/**
 * Custom svgo v3 plugin: convertToMono
 *
 * Converts all colored fills to `currentColor` with opacity mapping for
 * multi-color icons.  White fills become either `currentColor` (foreground)
 * or `var(--color-background, white)` (cutout/negative space).
 *
 * Usage:
 *   const mono = createConvertToMonoPlugin({ backgroundWasDark: true })
 *   // pass mono.plugin in svgoConfig.plugins
 */

import { colorToLuminance, isWhiteFill, parseSvgPathBounds, parseViewBox } from './svg-utils'
import type { CustomPlugin, XastChild, XastElement, XastParent, XastRoot } from './types'

const { detachNodeFromParent } = require('svgo/lib/xast') as {
  detachNodeFromParent: (node: XastChild, parentNode: XastParent) => void
}

interface ConvertToMonoOptions {
  /** Was a dark background removed upstream? If true, white fills become currentColor. */
  backgroundWasDark?: boolean
}

const MIN_OPACITY = 0.3
const MIN_GAP = 0.08

/**
 * Compute opacity map for multi-color mono conversion.
 * Darker colors get higher opacity (more visible).
 */
function computeOpacityMap(colorLuminances: Map<string, number>, whiteIsFg: boolean): Map<string, number> {
  const map = new Map<string, number>()
  const count = colorLuminances.size

  if (count === 0) return map
  if (count === 1) {
    for (const color of colorLuminances.keys()) {
      map.set(color, 1.0)
    }
    return map
  }

  const MAX_OPACITY = whiteIsFg ? 0.75 : 1.0
  const luminances = [...colorLuminances.values()]
  const minL = Math.min(...luminances)
  const maxL = Math.max(...luminances)
  const range = maxL - minL
  const effectiveRange = Math.max(range, 0.2)

  const effectiveGap = range < 0.2 ? 0.12 : MIN_GAP

  // Sort by opacity (darkest → highest)
  const entries = [...colorLuminances.entries()]
    .map(([color, lum]) => {
      const normalizedL = range > 0.01 ? (lum - minL) / effectiveRange : 0
      const opacity = MAX_OPACITY - Math.min(normalizedL, 1.0) * (MAX_OPACITY - MIN_OPACITY)
      return { color, opacity }
    })
    .sort((a, b) => b.opacity - a.opacity)

  // Enforce minimum gap between adjacent opacity values
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const curr = entries[i]
    if (prev.opacity - curr.opacity < effectiveGap) {
      curr.opacity = Math.max(MIN_OPACITY, prev.opacity - effectiveGap)
    }
  }

  for (const entry of entries) {
    map.set(entry.color, entry.opacity)
  }

  return map
}

export function createConvertToMonoPlugin(options: ConvertToMonoOptions = {}) {
  const plugin = {
    name: 'convertToMono',
    fn: (root: XastRoot) => {
      // Find <svg> element
      let svgNode: XastElement | null = null
      for (const child of root.children) {
        if (child.type === 'element' && child.name === 'svg') {
          svgNode = child
          break
        }
      }
      if (!svgNode) return {}
      const maskElements = new Map<string, XastElement>()
      const preservedMaskIds = new Set<string>()

      function collectMaskDefs(node: XastElement) {
        for (const child of node.children) {
          if (child.type !== 'element') continue
          if (child.name === 'mask' && child.attributes.id) {
            maskElements.set(child.attributes.id, child)
          }
          if (child.children.length > 0) collectMaskDefs(child)
        }
      }

      /**
       * Check if a mask is a luminance cutout mask (white background + dark cutout shapes).
       * These masks create a "punch-through" effect and must be preserved as-is.
       */
      function isCutoutMask(shapePaths: XastElement[]): boolean {
        const hasDarkFill = shapePaths.some((sp) => {
          const fill = sp.attributes.fill || ''
          if (/^black$/i.test(fill)) return true
          const lum = colorToLuminance(fill)
          return lum >= 0 && lum < 0.3
        })
        const hasLightFill = shapePaths.some((sp) => {
          const fill = sp.attributes.fill || ''
          if (/^white$/i.test(fill)) return true
          return isWhiteFill(fill)
        })
        return hasDarkFill && hasLightFill
      }

      function replaceMaskedGroups(node: XastElement, viewBoxArea: number) {
        for (const child of node.children) {
          if (child.type !== 'element') continue

          if (child.attributes.mask) {
            const maskMatch = child.attributes.mask.match(/url\(#([^)]+)\)/)
            if (maskMatch) {
              const maskEl = maskElements.get(maskMatch[1])
              if (maskEl) {
                const shapePaths = maskEl.children.filter(
                  (c): c is XastElement =>
                    c.type === 'element' && ['path', 'rect', 'circle', 'ellipse'].includes(c.name)
                )

                // Cutout masks (white bg + dark shapes) create visual gaps — preserve them.
                if (isCutoutMask(shapePaths)) {
                  preservedMaskIds.add(maskMatch[1])
                  if (child.children.length > 0) replaceMaskedGroups(child, viewBoxArea)
                  continue
                }

                // Check if mask is a no-op (full viewBox rect) — if so, skip replacement.
                // A no-op mask doesn't define a shape, it just clips to the viewBox.
                const isNoopMask = shapePaths.every((sp) => {
                  if (sp.name === 'rect') {
                    const w = parseFloat(sp.attributes.width || '0')
                    const h = parseFloat(sp.attributes.height || '0')
                    return w * h >= viewBoxArea * 0.9
                  }
                  if (sp.name === 'path') {
                    const d = sp.attributes.d || ''
                    const bounds = parseSvgPathBounds(d)
                    if (!isFinite(bounds.minX)) return false
                    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
                    return area >= viewBoxArea * 0.9
                  }
                  return false
                })

                if (!isNoopMask && shapePaths.length > 0) {
                  // Replace group content with cloned mask shape paths
                  child.children = shapePaths.map((sp): XastElement => {
                    const attrs = { ...sp.attributes }
                    delete attrs.style // Remove mask-type:luminance etc.
                    return { type: 'element', name: sp.name, attributes: attrs, children: [] }
                  })
                }
              }
            }
            delete child.attributes.mask
          }

          if (child.children.length > 0) replaceMaskedGroups(child, viewBoxArea)
        }
      }

      function removeMaskElements(node: XastElement) {
        const children = node.children
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i]
          if (child.type !== 'element') continue
          if (child.name === 'mask') {
            // Preserve cutout masks that are still referenced
            if (child.attributes.id && preservedMaskIds.has(child.attributes.id)) continue
            detachNodeFromParent(child, node)
            continue
          }
          if (child.children.length > 0) removeMaskElements(child)
        }
      }

      collectMaskDefs(svgNode)
      if (maskElements.size > 0) {
        const vb = parseViewBox(svgNode.attributes)
        const vbArea = vb.w * vb.h
        replaceMaskedGroups(svgNode, vbArea)
        removeMaskElements(svgNode)
      }

      // Phase 1: Pre-scan — collect unique fill/stroke colors and luminances
      const colorLuminances = new Map<string, number>()
      const whiteColors = new Set<string>()

      function addColorEntry(color: string) {
        if (!color || color === 'none' || color === 'currentColor' || color.startsWith('url(')) return
        if (isWhiteFill(color)) {
          whiteColors.add(color)
        } else {
          const lum = colorToLuminance(color)
          if (lum >= 0 && !colorLuminances.has(color)) {
            colorLuminances.set(color, lum)
          }
        }
      }

      function collectColors(node: XastElement) {
        const children = node.children
        for (const child of children) {
          if (child.type !== 'element') continue

          // Skip elements inside <defs>
          if (child.name === 'defs') continue

          addColorEntry(child.attributes.fill)
          addColorEntry(child.attributes.stroke)

          if (child.children.length > 0) {
            collectColors(child)
          }
        }
      }

      collectColors(svgNode)
      // Also collect colors from the SVG root element itself (inherited by children)
      addColorEntry(svgNode.attributes.fill)
      addColorEntry(svgNode.attributes.stroke)

      // Phase 1.5: Container detection — when a large first shape covers most of
      // the viewBox, lighter overlapping shapes should use white to create contrast.
      // Without this, all paths become currentColor and details are invisible.
      // (e.g. Hunyuan: blue circle with lighter blue/gray details inside)
      let containerLum = -1

      if (colorLuminances.size >= 2) {
        const vb = parseViewBox(svgNode.attributes)
        const vbArea = vb.w * vb.h

        // Find first visible path element (skip defs)
        function findFirstPath(node: XastElement): XastElement | null {
          for (const child of node.children) {
            if (child.type !== 'element') continue
            if (child.name === 'defs') continue
            if (child.name === 'path' && child.attributes.d && child.attributes.fill) {
              return child
            }
            const found = findFirstPath(child)
            if (found) return found
          }
          return null
        }

        const firstPath = findFirstPath(svgNode)
        if (firstPath) {
          const fill = firstPath.attributes.fill
          if (fill && !isWhiteFill(fill) && fill !== 'none' && !fill.startsWith('url(')) {
            const d = firstPath.attributes.d
            const bounds = parseSvgPathBounds(d)
            if (isFinite(bounds.minX)) {
              const tx = (firstPath.attributes.transform || '').match(/translate\((-?[\d.]+)[,\s]+(-?[\d.]+)\)/)
              if (tx) {
                bounds.minX += parseFloat(tx[1]) || 0
                bounds.maxX += parseFloat(tx[1]) || 0
                bounds.minY += parseFloat(tx[2]) || 0
                bounds.maxY += parseFloat(tx[2]) || 0
              }
              const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
              if (area >= vbArea * 0.6) {
                containerLum = colorToLuminance(fill)
              }
            }
          }
        }
      }

      // Determine if white fills are foreground or cutouts
      const whiteIsFg = options.backgroundWasDark === true || (colorLuminances.size === 0 && whiteColors.size > 0)

      // Build opacity map
      const opacityMap = computeOpacityMap(colorLuminances, whiteIsFg)

      // Phase 2: Walk tree and transform fill attributes
      function transformNode(node: XastElement) {
        const children = node.children
        // Iterate backwards for safe detachment
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i]
          if (child.type !== 'element') continue

          // Remove <clipPath> elements
          if (child.name === 'clipPath') {
            detachNodeFromParent(child, node)
            continue
          }

          // Preserve <defs> containing cutout masks; remove others
          if (child.name === 'defs') {
            const hasPreservedMask = child.children.some(
              (c) =>
                c.type === 'element' && c.name === 'mask' && c.attributes.id && preservedMaskIds.has(c.attributes.id)
            )
            if (hasPreservedMask) continue // keep defs and skip color transform inside
            detachNodeFromParent(child, node)
            continue
          }

          // Remove clipPath/filter attributes; preserve mask if it references a preserved mask
          delete child.attributes['clip-path']
          delete child.attributes.filter
          if (child.attributes.mask) {
            const ref = child.attributes.mask.match(/url\(#([^)]+)\)/)
            if (!ref || !preservedMaskIds.has(ref[1])) {
              delete child.attributes.mask
            }
          }

          // Remove existing fill-opacity (we'll set our own)
          delete child.attributes['fill-opacity']

          // Replace fill values
          const fill = child.attributes.fill
          if (fill && fill !== 'none' && fill !== 'currentColor') {
            if (fill.startsWith('url(')) {
              child.attributes.fill = 'currentColor'
            } else if (isWhiteFill(fill)) {
              child.attributes.fill = whiteIsFg ? 'currentColor' : 'var(--color-background, white)'
            } else {
              const fillLum = colorToLuminance(fill)
              // When a container shape exists, lighter overlapping paths become
              // white overlays to create contrast (e.g. Hunyuan detail shapes).
              if (containerLum >= 0 && fillLum >= 0 && fillLum - containerLum >= 0.15) {
                child.attributes.fill = 'var(--color-background, white)'
                const whiteOpacity = Math.min(0.9, (fillLum - containerLum) / (1 - containerLum + 0.01))
                if (whiteOpacity < 0.99) {
                  child.attributes['fill-opacity'] = Math.max(MIN_OPACITY, whiteOpacity).toFixed(2)
                }
              } else {
                const opacity = opacityMap.get(fill)
                child.attributes.fill = 'currentColor'
                if (opacity !== undefined && opacity < 0.99) {
                  child.attributes['fill-opacity'] = opacity.toFixed(2)
                }
              }
            }
          }

          // Replace stroke values
          const stroke = child.attributes.stroke
          if (stroke && stroke !== 'none' && stroke !== 'currentColor') {
            if (stroke.startsWith('url(')) {
              child.attributes.stroke = 'currentColor'
            } else if (isWhiteFill(stroke)) {
              child.attributes.stroke = whiteIsFg ? 'currentColor' : 'var(--color-background, white)'
            } else {
              const opacity = opacityMap.get(stroke)
              child.attributes.stroke = 'currentColor'
              if (opacity !== undefined && opacity < 0.99) {
                child.attributes['stroke-opacity'] = opacity.toFixed(2)
              }
            }
          }

          // Recurse into children
          if (child.children.length > 0) {
            transformNode(child)
          }
        }
      }

      if (svgNode) {
        transformNode(svgNode)

        // Handle SVG root element's own fill/stroke (inherited by children)
        const rootFill = svgNode.attributes.fill
        if (rootFill && rootFill !== 'none' && rootFill !== 'currentColor' && !rootFill.startsWith('url(')) {
          svgNode.attributes.fill = isWhiteFill(rootFill)
            ? whiteIsFg
              ? 'currentColor'
              : 'var(--color-background, white)'
            : 'currentColor'
        }
        const rootStroke = svgNode.attributes.stroke
        if (rootStroke && rootStroke !== 'none' && rootStroke !== 'currentColor' && !rootStroke.startsWith('url(')) {
          svgNode.attributes.stroke = 'currentColor'
        }
      }

      return {}
    }
  } satisfies CustomPlugin

  return { plugin }
}
