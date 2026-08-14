import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

const isNumeric = (value: unknown): boolean => {
  if (typeof value === 'string' && value.trim() !== '') {
    return /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  }
  return false
}

const isNegativeNumeric = (value: string): boolean => /^-\d/.test(value.trim())
const isSafeCssLength = (value: string): boolean =>
  /^(?:\d+\.?\d*|\.\d+)(?:px|pt|em|rem|%|vw|vh|cm|mm|in)?$/i.test(value.trim())
const isSafeSvgDimension = (value: string): boolean => isNumeric(value) || isSafeCssLength(value)

const toCssMaxWidth = (width: string): string | null => {
  if (isNegativeNumeric(width)) return null
  if (isNumeric(width)) return `${width}px`
  return isSafeCssLength(width) ? width : null
}

/**
 * A Rehype plugin that prepares SVG elements for scalable rendering.
 *
 * This plugin classifies SVGs into two categories:
 *
 * 1.  **Simple SVGs**: Those that already have a `viewBox` or have unitless
 *     numeric `width` and `height` attributes. These are processed directly
 *     in the HAST tree for maximum performance. A `viewBox` is added if
 *     missing, and fixed dimensions are removed.
 *
 * 2.  **Complex SVGs**: Those without a `viewBox` and with dimensions that
 *     have units (e.g., "100pt", "10em"). These cannot be safely processed
 *     at the data layer. The plugin adds a `data-needs-measurement="true"`
 *     attribute to them, flagging them for runtime processing by a
 *     specialized React component.
 *
 * @returns A unified transformer function.
 */
function rehypeScalableSvg() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'svg') {
        const properties = node.properties
        const hasViewBox = 'viewBox' in properties
        const width = (properties.width as string)?.trim()
        const height = (properties.height as string)?.trim()

        if (width && !isSafeSvgDimension(width)) delete properties.width
        if (height && !isSafeSvgDimension(height)) delete properties.height

        // 1. Universally set max-width from the width attribute if it exists.
        // This is safe for both simple and complex cases.
        if (width) {
          const cssMaxWidth = toCssMaxWidth(width)
          if (cssMaxWidth) {
            const existingStyle = properties.style ? String(properties.style).trim().replace(/;$/, '') : ''
            const maxWidth = `max-width: ${cssMaxWidth}`
            properties.style = existingStyle ? `${existingStyle}; ${maxWidth}` : maxWidth
          }
        }

        // 2. Handle viewBox creation for simple, numeric cases.
        if (!hasViewBox && isNumeric(width) && isNumeric(height)) {
          properties.viewBox = `0 0 ${width} ${height}`
          // Reset or clean up attributes.
          properties.width = '100%'
          delete properties.height
        }
        // 3. Flag complex cases for runtime measurement.
        else if (!hasViewBox && width && height) {
          properties['data-needs-measurement'] = 'true'
        }

        node.properties = properties
      }
    })
  }
}

export default rehypeScalableSvg
