/**
 * Rehype plugin: prefix SVG IDs and rewrite intra-SVG references.
 *
 * Moved verbatim from src/renderer/src/components/chat/messages/markdown/Markdown.tsx
 * (lines 227-297). Pairs with the sanitize plugin's `clobberPrefix` so that
 * an SVG's `id="foo"` becomes `id="user-content-foo"` (clobbered to avoid
 * colliding with the host page), and all `url(#foo)` references inside the
 * same SVG follow suit.
 */

import type { Element, Nodes, Properties, Root } from 'hast'
import { visit } from 'unist-util-visit'

const rewriteSvgReference = (value: string, idMap: Map<string, string>) => {
  let rewritten = value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (match, quote, id) => {
    const prefixedId = idMap.get(id)

    return prefixedId ? `url(${quote}#${prefixedId}${quote})` : match
  })

  if (rewritten.startsWith('#')) {
    const id = rewritten.slice(1)
    const prefixedId = idMap.get(id)

    if (prefixedId) {
      rewritten = `#${prefixedId}`
    }
  }

  return rewritten
}

const rewriteSvgProperty = (value: Properties[string], idMap: Map<string, string>): Properties[string] => {
  if (typeof value === 'string') {
    return rewriteSvgReference(value, idMap)
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? rewriteSvgReference(item, idMap) : item))
  }

  return value
}

const walkElement = (node: Nodes, visitor: (node: Element) => void) => {
  if (node.type === 'element') {
    visitor(node)
  }

  if ('children' in node) {
    for (const child of node.children) {
      walkElement(child, visitor)
    }
  }
}

export function rehypePrefixSvgReferences(clobberPrefix = 'user-content-') {
  return (tree: Root) => {
    if (!clobberPrefix) return

    visit(tree, 'element', (svgNode) => {
      if (svgNode.tagName !== 'svg') return

      const idMap = new Map<string, string>()
      walkElement(svgNode, (node) => {
        const id = node.properties?.id

        if (typeof id === 'string' && id.startsWith(clobberPrefix)) {
          idMap.set(id.slice(clobberPrefix.length), id)
        }
      })

      if (idMap.size === 0) return

      walkElement(svgNode, (node) => {
        const properties = node.properties

        if (!properties) return

        for (const key of Object.keys(properties)) {
          properties[key] = rewriteSvgProperty(properties[key], idMap)
        }
      })
    })
  }
}
