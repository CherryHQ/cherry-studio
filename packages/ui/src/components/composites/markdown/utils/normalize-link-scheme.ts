import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/

export function rehypeNormalizeLinkScheme() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      const properties = node.properties
      if (node.tagName !== 'a' && properties.xlinkHref === undefined && properties.xLinkHref === undefined) return

      for (const property of ['href', 'xlinkHref', 'xLinkHref']) {
        const value = properties[property]
        if (typeof value === 'string') {
          properties[property] = value.replace(URI_SCHEME_PATTERN, (scheme) => scheme.toLowerCase())
        }
      }
    })
  }
}
