import type { Editor } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { CompareBlockNodeView } from './CompareBlockNodeView'

export interface CompareBlockData {
  content: string
}

export interface CompareBlockStorage {
  blocks: Record<string, CompareBlockData>
  /** 用于触发“只更新元数据”的持久化回写（正文不变也能保存） */
  onMetaChange?: () => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    compareBlock: {
      /** 在“当前光标所在块”后插入对照区（折叠态默认展开） */
      insertCompareBlock: () => ReturnType
    }
  }
}

function nanoIdLike(length = 8): string {
  // 避免引入额外依赖：优先使用 crypto.randomUUID
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID().replace(/-/g, '').slice(0, length)
  }
  return Math.random()
    .toString(16)
    .slice(2, 2 + length)
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

  addStorage() {
    const storage: CompareBlockStorage = {
      blocks: {}
    }
    return storage
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-id') || '',
        renderHTML: (attrs: { id: string }) => ({ 'data-id': attrs.id })
      },
      collapsed: {
        default: true,
        parseHTML: (element: HTMLElement) => (element.getAttribute('data-collapsed') || '1') !== '0',
        renderHTML: (attrs: { collapsed: boolean }) => ({ 'data-collapsed': attrs.collapsed ? '1' : '0' })
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
          const id = `cb_${nanoIdLike(10)}`
          const node = editor.schema.nodes.compareBlock.create({
            id,
            collapsed: false
          })
          // 初始化空内容，便于立刻粘贴
          const storage = (editor.storage as any).compareBlock as CompareBlockStorage
          storage.blocks[id] = storage.blocks[id] ?? { content: '' }
          const ok = insertAfterCurrentBlock(editor, node)
          return ok
        }
    }
  }
})
