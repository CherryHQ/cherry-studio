import '../types.js'

import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface TableCellOptions {
  /**
   * The HTML attributes for a table cell node.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, any>
  /**
   * Whether nodes can be nested inside a cell.
   * @default false
   */
  allowNestedNodes: boolean
}

const cellSelectionPluginKey = new PluginKey('cellSelectionStyling')

function isTableNode(node: ProseMirrorNode): boolean {
  const spec = node.type.spec as { tableRole?: string } | undefined
  return node.type.name === 'table' || spec?.tableRole === 'table'
}

function createCellSelectionDecorationSet(doc: ProseMirrorNode, selection: Selection): DecorationSet {
  if (!(selection instanceof CellSelection)) {
    return DecorationSet.empty
  }

  const $anchor = selection.$anchorCell || selection.$anchor
  let tableNode: ProseMirrorNode | null = null
  let tablePos = -1

  for (let depth = $anchor.depth; depth > 0; depth--) {
    const nodeAtDepth = $anchor.node(depth) as ProseMirrorNode
    if (isTableNode(nodeAtDepth)) {
      tableNode = nodeAtDepth
      tablePos = $anchor.before(depth)
      break
    }
  }

  if (!tableNode) {
    return DecorationSet.empty
  }

  const map = TableMap.get(tableNode)
  const tableStart = tablePos + 1

  type Rect = { top: number; bottom: number; left: number; right: number }
  type Item = { pos: number; node: ProseMirrorNode; rect: Rect }

  const items: Item[] = []
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  selection.forEachCell((cell, pos) => {
    const rect = map.findCell(pos - tableStart)
    items.push({ pos, node: cell, rect })

    minRow = Math.min(minRow, rect.top)
    maxRow = Math.max(maxRow, rect.bottom - 1)
    minCol = Math.min(minCol, rect.left)
    maxCol = Math.max(maxCol, rect.right - 1)
  })

  const decorations: Decoration[] = []
  for (const { pos, node, rect } of items) {
    const classes: string[] = ['selectedCell']
    if (rect.top === minRow) classes.push('selection-top')
    if (rect.bottom - 1 === maxRow) classes.push('selection-bottom')
    if (rect.left === minCol) classes.push('selection-left')
    if (rect.right - 1 === maxCol) classes.push('selection-right')

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: classes.join(' ')
      })
    )
  }

  return DecorationSet.create(doc, decorations)
}
/**
 * This extension allows you to create table cells.
 * @see https://www.tiptap.dev/api/nodes/table-cell
 */
export const TableCell = Node.create<TableCellOptions>({
  name: 'tableCell',

  addOptions() {
    return {
      HTMLAttributes: {},
      allowNestedNodes: false
    }
  },

  content: 'paragraph+',

  addAttributes() {
    return {
      colspan: {
        default: 1
      },
      rowspan: {
        default: 1
      },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth')
          const value = colwidth ? colwidth.split(',').map((width) => parseInt(width, 10)) : null

          return value
        }
      }
    }
  },

  tableRole: 'cell',

  isolating: true,

  parseHTML() {
    return [{ tag: 'td' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['td', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: cellSelectionPluginKey,
        props: {
          decorations: ({ doc, selection }) => createCellSelectionDecorationSet(doc as ProseMirrorNode, selection)
        }
      })
    ]
  }
})
