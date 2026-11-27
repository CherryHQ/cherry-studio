import type { Root } from 'hast'
import { visit } from 'unist-util-visit'

export function rehypeFootnotes({ prefix, clobberPrefix }: { prefix: string; clobberPrefix: string }) {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const properties = node.properties
      if (node.tagName === 'section' && 'dataFootnotes' in properties) node.tagName = 'footnote-section'
      if (properties.id === `${clobberPrefix}footnote-label`) {
        properties.id = `${clobberPrefix}${prefix}label`
      }
      if (node.tagName !== 'a' || (!('dataFootnoteRef' in properties) && !('dataFootnoteBackref' in properties))) return
      if (typeof properties.href !== 'string' || !properties.href.startsWith(`#${prefix}`)) return
      // Sanitization prefixes IDs but leaves fragment URLs unchanged.
      properties.href = `#${encodeURIComponent(clobberPrefix + properties.href.slice(1))}`
      if ('dataFootnoteRef' in properties) properties.ariaDescribedBy = [`${clobberPrefix}${prefix}label`]
      node.tagName = 'footnote-link'
    })
  }
}
