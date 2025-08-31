import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'

export interface SelectionBounds {
  tablePos: number
  tableStart: number
  map: ReturnType<typeof TableMap.get>
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
  topLeftPos: number
  topRightPos: number
}

/**
 * Compute logical bounds for current CellSelection inside the provided table node.
 * Returns null if current selection is not a CellSelection or not within the table node.
 */
export function getCellSelectionBounds(view: EditorView, tableNode: ProseMirrorNode): SelectionBounds | null {
  const selection = view.state.selection
  if (!(selection instanceof CellSelection)) return null

  const $anchor = selection.$anchorCell || selection.$anchor
  let tablePos = -1
  let currentTable: ProseMirrorNode | null = null
  for (let d = $anchor.depth; d > 0; d--) {
    const n = $anchor.node(d)
    const role = (n.type.spec as { tableRole?: string } | undefined)?.tableRole
    if (n.type.name === 'table' || role === 'table') {
      tablePos = $anchor.before(d)
      currentTable = n
      break
    }
  }
  if (tablePos < 0 || currentTable !== tableNode) return null

  const map = TableMap.get(tableNode)
  const tableStart = tablePos + 1

  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY
  let topLeftPos: number | null = null
  let topRightPos: number | null = null

  selection.forEachCell((_cell, pos) => {
    const rect = map.findCell(pos - tableStart)
    if (rect.top < minRow) minRow = rect.top
    if (rect.left < minCol) minCol = rect.left
    if (rect.bottom - 1 > maxRow) maxRow = rect.bottom - 1
    if (rect.right - 1 > maxCol) maxCol = rect.right - 1

    if (rect.top === minRow && rect.left === minCol) {
      if (topLeftPos === null || pos < topLeftPos) topLeftPos = pos
    }
    if (rect.top === minRow && rect.right - 1 === maxCol) {
      if (topRightPos === null || pos < topRightPos) topRightPos = pos
    }
  })

  if (!isFinite(minRow) || !isFinite(minCol) || topLeftPos == null) return null
  if (topRightPos == null) topRightPos = topLeftPos

  return { tablePos, tableStart, map, minRow, maxRow, minCol, maxCol, topLeftPos, topRightPos }
}
