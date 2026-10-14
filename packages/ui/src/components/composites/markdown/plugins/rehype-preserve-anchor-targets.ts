import type { Root } from 'hast'
import { visit } from 'unist-util-visit'

export default function rehypePreserveAnchorTargets(): (tree: Root) => void {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a' && !node.properties?.href && typeof node.properties?.id === 'string') {
        node.tagName = 'span'
      }
    })
  }
}
