import type { Editor } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { decodeBase64Utf8, encodeBase64Utf8 } from '../../helpers/compareBlockCodec'
import { CompareBlockNodeView } from './CompareBlockNodeView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    compareBlock: {
      /** 在“当前光标所在块”后插入对照区（折叠态默认展开） */
      insertCompareBlock: () => ReturnType
    }
  }
}

function insertAfterCurrentBlock(editor: Editor, node: ProseMirrorNode): boolean {
  const { state, view } = editor
  const { selection } = state
  const { $from } = selection

  // 找到最近的块级祖先
  let depth = $from.depth
  while (depth > 0 && !$from.node(depth).isBlock) {
    depth -= 1
  }

  // 插入位置：该块节点之后
  const posAfter = $from.after(depth)
  const tr: Transaction = state.tr.insert(posAfter, node)
  view.dispatch(tr)
  return true
}

export const CompareBlock = Node.create({
  name: 'compareBlock',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      collapsed: {
        default: true,
        parseHTML: (element: HTMLElement) => (element.getAttribute('data-collapsed') || '1') !== '0',
        renderHTML: (attrs: { collapsed: boolean }) => ({ 'data-collapsed': attrs.collapsed ? '1' : '0' })
      },
      content: {
        default: '',
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-content') || ''
          return decodeBase64Utf8(raw) ?? ''
        },
        renderHTML: (attrs: { content: string }) => ({ 'data-content': encodeBase64Utf8(attrs.content || '') })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'cs-compare-block'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['cs-compare-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CompareBlockNodeView)
  },

  addCommands() {
    return {
      insertCompareBlock:
        () =>
        ({ editor }) => {
          const node = editor.schema.nodes.compareBlock.create({
            collapsed: false,
            content: ''
          })
          const ok = insertAfterCurrentBlock(editor, node)
          return ok
        }
    }
  }
})
