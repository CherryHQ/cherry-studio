import type { Element, Root, RootContent } from 'hast'

/** Only annotate text that still exactly matches the untransformed source. */
export function rehypeSideChatSource(options: { source: string }) {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      if (
        parent.type === 'element' &&
        ['a', 'button', 'code', 'pre', 'math', 'svg', 'script', 'style'].includes(parent.tagName)
      )
        return
      parent.children = parent.children.map((node): RootContent => {
        if (node.type === 'element') {
          walk(node)
          return node
        }
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (
          node.type !== 'text' ||
          start === undefined ||
          end === undefined ||
          options.source.slice(start, end) !== node.value
        )
          return node
        return {
          type: 'element',
          tagName: 'span',
          properties: { 'data-side-chat-source': node.value },
          children: [node]
        }
      })
    }
    walk(tree)
  }
}
