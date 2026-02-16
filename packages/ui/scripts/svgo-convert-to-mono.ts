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

const monoXast = require('svgo/lib/xast')
const detachNode: (node: any, parent: any) => void = monoXast.detachNodeFromParent

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

  // Use a larger gap for narrow luminance ranges to keep layers distinguishable
  // (e.g. Hunyuan with 5 blue shades spanning a narrow luminance band)
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
    fn: (root: any) => {
      // Find <svg> element
      let svgNode: any = null
      for (const child of root.children) {
        if (child.type === 'element' && child.name === 'svg') {
          svgNode = child
          break
        }
      }
      if (!svgNode) return {}

      // Phase 0: Replace mask-based groups with mask shape paths.
      // Icons like Jimeng use <mask> to clip oversized geometry into a star shape.
      // Without the mask, the geometry fills the entire viewBox as a solid square.
      // We extract the mask's shape paths and use them as the mono content instead.
      const maskElements = new Map<string, any>()

      function collectMaskDefs(node: any) {
        for (const child of node.children || []) {
          if (child.type !== 'element') continue
          if (child.name === 'mask' && child.attributes?.id) {
            maskElements.set(child.attributes.id, child)
          }
          if (child.children?.length > 0) collectMaskDefs(child)
        }
      }

      function replaceMaskedGroups(node: any, viewBoxArea: number) {
        for (const child of node.children || []) {
          if (child.type !== 'element') continue

          if (child.attributes?.mask) {
            const maskMatch = child.attributes.mask.match(/url\(#([^)]+)\)/)
            if (maskMatch) {
              const maskEl = maskElements.get(maskMatch[1])
              if (maskEl) {
                const shapePaths = (maskEl.children || []).filter(
                  (c: any) => c.type === 'element' && ['path', 'rect', 'circle', 'ellipse'].includes(c.name)
                )

                // Check if mask is a no-op (full viewBox rect) — if so, skip replacement.
                // A no-op mask doesn't define a shape, it just clips to the viewBox.
                const isNoopMask = shapePaths.every((sp: any) => {
                  if (sp.name === 'rect') {
                    const w = parseFloat(sp.attributes?.width || '0')
                    const h = parseFloat(sp.attributes?.height || '0')
                    return w * h >= viewBoxArea * 0.9
                  }
                  if (sp.name === 'path') {
                    const d = sp.attributes?.d || ''
                    const bounds = parseSvgPathBounds(d)
                    if (!isFinite(bounds.minX)) return false
                    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
                    return area >= viewBoxArea * 0.9
                  }
                  return false
                })

                if (!isNoopMask && shapePaths.length > 0) {
                  // Replace group content with cloned mask shape paths
                  child.children = shapePaths.map((sp: any) => {
                    const attrs = { ...sp.attributes }
                    delete attrs.style // Remove mask-type:luminance etc.
                    return { type: 'element', name: sp.name, attributes: attrs, children: [] }
                  })
                }
              }
            }
            delete child.attributes.mask
          }

          if (child.children?.length > 0) replaceMaskedGroups(child, viewBoxArea)
        }
      }

      function removeMaskElements(node: any) {
        const children = node.children || []
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i]
          if (child.type !== 'element') continue
          if (child.name === 'mask') {
            detachNode(child, node)
            continue
          }
          if (child.children?.length > 0) removeMaskElements(child)
        }
      }

      collectMaskDefs(svgNode)
      if (maskElements.size > 0) {
        const vb = parseViewBox(svgNode.attributes)
        const vbArea = vb.w * vb.h
        replaceMaskedGroups(svgNode, vbArea)
        removeMaskElements(svgNode)
      }

      // Phase 1: Pre-scan — collect unique fill colors and luminances
      const colorLuminances = new Map<string, number>()
      const whiteColors = new Set<string>()

      function collectColors(node: any) {
        const children = node.children || []
        for (const child of children) {
          if (child.type !== 'element') continue

          // Skip elements inside <defs>
          if (child.name === 'defs') continue

          const fill = child.attributes?.fill
          if (fill && fill !== 'none' && fill !== 'currentColor' && !fill.startsWith('url(')) {
            if (isWhiteFill(fill)) {
              whiteColors.add(fill)
            } else {
              const lum = colorToLuminance(fill)
              if (lum >= 0 && !colorLuminances.has(fill)) {
                colorLuminances.set(fill, lum)
              }
            }
          }

          if (child.children && child.children.length > 0) {
            collectColors(child)
          }
        }
      }

      collectColors(svgNode)

      // Determine if white fills are foreground or cutouts
      const whiteIsFg = options.backgroundWasDark === true || (colorLuminances.size === 0 && whiteColors.size > 0)

      // Build opacity map
      const opacityMap = computeOpacityMap(colorLuminances, whiteIsFg)

      // Phase 2: Walk tree and transform fill attributes
      function transformNode(node: any) {
        const children = node.children || []
        // Iterate backwards for safe detachment
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i]
          if (child.type !== 'element') continue

          // Remove <defs>, <clipPath> elements
          if (child.name === 'defs' || child.name === 'clipPath') {
            detachNode(child, node)
            continue
          }

          // Remove clipPath/filter/mask attributes
          if (child.attributes) {
            delete child.attributes['clip-path']
            delete child.attributes.filter
            delete child.attributes.mask

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
                const opacity = opacityMap.get(fill)
                child.attributes.fill = 'currentColor'
                if (opacity !== undefined && opacity < 0.99) {
                  child.attributes['fill-opacity'] = opacity.toFixed(2)
                }
              }
            }
          }

          // Recurse into children
          if (child.children && child.children.length > 0) {
            transformNode(child)
          }
        }
      }

      if (svgNode) transformNode(svgNode)

      return {}
    }
  }

  return { plugin }
}
