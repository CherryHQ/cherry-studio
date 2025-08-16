import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * A Rehype plugin that makes SVG elements scalable.
 *
 * This plugin traverses the HAST (HTML Abstract Syntax Tree) and performs
 * the following operations on each `<svg>` element:
 *
 * 1. Ensures a `viewBox` attribute exists. If it's missing but `width` and
 *    `height` are present, it generates a `viewBox` from them. This is
 *    crucial for making the SVG scalable.
 *
 * 2. Removes the `width` and `height` attributes. This allows the SVG's size
 *    to be controlled by CSS (e.g., `max-width: 100%`), making it responsive
 *    and preventing it from overflowing its container.
 *
 * @returns A unified transformer function.
 */
function rehypeScalableSvg() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'svg') {
        const properties = node.properties || {}
        const hasViewBox = 'viewBox' in properties
        const width = properties.width as string | number | undefined
        const height = properties.height as string | number | undefined

        if (!hasViewBox && width && height) {
          const numericWidth = parseFloat(String(width))
          const numericHeight = parseFloat(String(height))
          if (!isNaN(numericWidth) && !isNaN(numericHeight)) {
            properties.viewBox = `0 0 ${numericWidth} ${numericHeight}`
          }
        }

        // Remove fixed width and height to allow CSS to control the size
        delete properties.width
        delete properties.height

        node.properties = properties
      }
    })
  }
}

export default rehypeScalableSvg
