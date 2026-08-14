// ported from https://github.com/ueberdosis/tiptap/blob/develop/packages/extension-drag-handle/src/helpers/getOuterNode.ts
import type { Node } from '@tiptap/pm/model'

export const getOuterNodePos = (doc: Node, pos: number): number => {
  const resolvedPos = doc.resolve(pos)
  const { depth } = resolvedPos

  if (depth === 0) {
    return pos
  }

  const a = resolvedPos.pos - resolvedPos.parentOffset

  return a - 1
}

export const getOuterNode = (doc: Node, pos: number): Node | null => {
  const node = doc.nodeAt(pos)
  const resolvedPos = doc.resolve(pos)

  let { depth } = resolvedPos
  let parent = node

  while (depth > 0) {
    const currentNode = resolvedPos.node(depth)

    depth -= 1

    if (depth === 0) {
      parent = currentNode
    }
  }

  return parent
}
