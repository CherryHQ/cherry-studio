// ported from https://github.com/ueberdosis/tiptap/blob/develop/packages/extension-drag-handle/src/helpers/findNextElementFromCursor.ts
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'

export type FindElementNextToCoords = {
  x: number
  y: number
  direction?: 'left' | 'right'
  editor: Editor
}

export const findElementNextToCoords = (options: FindElementNextToCoords) => {
  const { x, y, direction, editor } = options
  let resultElement: HTMLElement | null = null
  let resultNode: Node | null = null
  let pos: number | null = null

  let currentX = x

  while (resultNode === null && currentX < window.innerWidth && currentX > 0) {
    const allElements = document.elementsFromPoint(currentX, y)
    const prosemirrorIndex = allElements.findIndex((element) => element.classList.contains('ProseMirror'))
    const filteredElements = allElements.slice(0, prosemirrorIndex)

    if (filteredElements.length > 0) {
      const target = filteredElements[0]

      resultElement = target as HTMLElement
      pos = editor.view.posAtDOM(target, 0)

      if (pos >= 0) {
        resultNode = editor.state.doc.nodeAt(Math.max(pos - 1, 0))

        if (resultNode?.isText) {
          resultNode = editor.state.doc.nodeAt(Math.max(pos - 1, 0))
        }

        if (!resultNode) {
          resultNode = editor.state.doc.nodeAt(Math.max(pos, 0))
        }

        break
      }
    }

    if (direction === 'left') {
      currentX -= 1
    } else {
      currentX += 1
    }
  }

  return { resultElement, resultNode, pos: pos ?? null }
}
