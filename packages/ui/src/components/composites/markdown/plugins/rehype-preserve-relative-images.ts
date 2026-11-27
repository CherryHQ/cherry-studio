import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

function isRelativeImageSrc(src: unknown): src is string {
  return (
    typeof src === 'string' &&
    src.length > 0 &&
    src.trim() === src &&
    !/^[/?#]|^[a-z][a-z0-9+.-]*:|[\\\p{Cc}]|%2f|%5c/iu.test(src)
  )
}

export function createRelativeImagePreservation() {
  const sources = new WeakMap<Element, string>()
  return {
    prepare:
      () =>
      (tree: Root): void => {
        visit(tree, 'element', (node) => {
          if (node.tagName !== 'img' || !isRelativeImageSrc(node.properties.src)) return
          sources.set(node, node.properties.src)
          node.tagName = 'span'
          delete node.properties.src
        })
      },
    restore:
      () =>
      (tree: Root): void => {
        visit(tree, 'element', (node) => {
          const src = sources.get(node)
          if (src === undefined) return
          node.tagName = 'img'
          node.properties.src = src
          sources.delete(node)
        })
      }
  }
}
