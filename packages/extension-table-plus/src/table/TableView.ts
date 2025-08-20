import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { addColumnAfter, addRowAfter, CellSelection, TableMap } from '@tiptap/pm/tables'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'

import { getColStyleDeclaration } from './utilities/colStyle.js'
import { getElementBorderWidth } from './utilities/getBorderWidth.js'
import { isCellSelection } from './utilities/isCellSelection.js'
import { getCellSelectionBounds } from './utilities/selectionBounds.js'

export function updateColumns(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement, // <colgroup> has the same prototype as <col>
  table: HTMLTableElement,
  cellMinWidth: number,
  overrideCol?: number,
  overrideValue?: number
) {
  let totalWidth = 0
  let fixedWidth = true
  let nextDOM = colgroup.firstChild
  const row = node.firstChild

  if (row !== null) {
    for (let i = 0, col = 0; i < row.childCount; i += 1) {
      const { colspan, colwidth } = row.child(i).attrs

      for (let j = 0; j < colspan; j += 1, col += 1) {
        const hasWidth = overrideCol === col ? overrideValue : ((colwidth && colwidth[j]) as number | undefined)
        const cssWidth = hasWidth ? `${hasWidth}px` : ''

        totalWidth += hasWidth || cellMinWidth

        if (!hasWidth) {
          fixedWidth = false
        }

        if (!nextDOM) {
          const colElement = document.createElement('col')

          const [propertyKey, propertyValue] = getColStyleDeclaration(cellMinWidth, hasWidth)

          colElement.style.setProperty(propertyKey, propertyValue)

          colgroup.appendChild(colElement)
        } else {
          if ((nextDOM as HTMLTableColElement).style.width !== cssWidth) {
            const [propertyKey, propertyValue] = getColStyleDeclaration(cellMinWidth, hasWidth)

            ;(nextDOM as HTMLTableColElement).style.setProperty(propertyKey, propertyValue)
          }

          nextDOM = nextDOM.nextSibling
        }
      }
    }
  }

  while (nextDOM) {
    const after = nextDOM.nextSibling

    nextDOM.parentNode?.removeChild(nextDOM)
    nextDOM = after
  }

  if (fixedWidth) {
    table.style.width = `${totalWidth}px`
    table.style.minWidth = ''
  } else {
    table.style.width = ''
    table.style.minWidth = `${totalWidth}px`
  }
}

// Callbacks are now handled by a decorations plugin; keep type removed here

type ButtonPosition = { x: number; y: number }
type RowActionCallback = (args: { rowIndex: number; view: EditorView; position?: ButtonPosition }) => void
type ColumnActionCallback = (args: { colIndex: number; view: EditorView; position?: ButtonPosition }) => void

export class TableView implements NodeView {
  node: ProseMirrorNode

  cellMinWidth: number

  dom: HTMLDivElement

  table: HTMLTableElement

  colgroup: HTMLTableColElement

  contentDOM: HTMLTableSectionElement

  view: EditorView

  addRowButton: HTMLButtonElement

  addColumnButton: HTMLButtonElement

  tableContainer: HTMLDivElement

  // Hover add buttons are kept; overlay endpoints absolute on wrapper
  private selectionChangeDisposer?: () => void
  private rowEndpoint?: HTMLButtonElement
  private colEndpoint?: HTMLButtonElement
  private overlayUpdateRafId: number | null = null
  private actionCallbacks?: {
    onRowActionClick?: RowActionCallback
    onColumnActionClick?: ColumnActionCallback
  }

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view: EditorView,
    actionCallbacks?: { onRowActionClick?: RowActionCallback; onColumnActionClick?: ColumnActionCallback }
  ) {
    this.node = node
    this.cellMinWidth = cellMinWidth
    this.view = view
    this.actionCallbacks = actionCallbacks
    // selection triggers handled by decorations plugin

    // Create the wrapper with grid layout
    this.dom = document.createElement('div')
    this.dom.className = 'tableWrapper'

    // Create table container
    this.tableContainer = document.createElement('div')
    this.tableContainer.className = 'table-container'

    this.table = this.tableContainer.appendChild(document.createElement('table'))
    this.colgroup = this.table.appendChild(document.createElement('colgroup'))
    updateColumns(node, this.colgroup, this.table, cellMinWidth)
    this.contentDOM = this.table.appendChild(document.createElement('tbody'))

    this.addRowButton = document.createElement('button')
    this.addColumnButton = document.createElement('button')
    this.createHoverButtons()

    this.dom.appendChild(this.tableContainer)
    this.dom.appendChild(this.addColumnButton)
    this.dom.appendChild(this.addRowButton)

    this.syncEditableState()

    this.setupEventListeners()

    // create overlay endpoints
    this.rowEndpoint = document.createElement('button')
    this.rowEndpoint.className = 'row-action-trigger'
    this.rowEndpoint.type = 'button'
    this.rowEndpoint.setAttribute('contenteditable', 'false')
    this.rowEndpoint.style.position = 'absolute'
    this.rowEndpoint.style.display = 'none'
    this.rowEndpoint.tabIndex = -1

    this.colEndpoint = document.createElement('button')
    this.colEndpoint.className = 'column-action-trigger'
    this.colEndpoint.type = 'button'
    this.colEndpoint.setAttribute('contenteditable', 'false')
    this.colEndpoint.style.position = 'absolute'
    this.colEndpoint.style.display = 'none'
    this.colEndpoint.tabIndex = -1

    this.dom.appendChild(this.rowEndpoint)
    this.dom.appendChild(this.colEndpoint)

    this.bindOverlayHandlers()
    this.startSelectionWatcher()
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false
    }

    this.node = node
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth)

    // Keep buttons' disabled state in sync during updates
    this.syncEditableState()

    // Recalculate overlay positions after node/table mutations so triggers follow the updated layout
    this.scheduleOverlayUpdate()

    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return (
      (mutation.type === 'attributes' && (mutation.target === this.table || this.colgroup.contains(mutation.target))) ||
      // Ignore mutations on our action buttons
      (mutation.target as Element)?.classList?.contains('row-action-trigger') ||
      (mutation.target as Element)?.classList?.contains('column-action-trigger')
    )
  }

  private isEditable(): boolean {
    // Rely on DOM attribute to avoid depending on EditorView internals
    return this.view.dom.getAttribute('contenteditable') !== 'false'
  }

  private syncEditableState() {
    const editable = this.isEditable()
    this.addRowButton.toggleAttribute('disabled', !editable)
    this.addColumnButton.toggleAttribute('disabled', !editable)

    this.addRowButton.style.display = editable ? '' : 'none'
    this.addColumnButton.style.display = editable ? '' : 'none'
    this.dom.classList.toggle('is-readonly', !editable)
  }

  createHoverButtons() {
    this.addRowButton.className = 'add-row-button'
    this.addRowButton.type = 'button'
    this.addRowButton.setAttribute('contenteditable', 'false')

    this.addColumnButton.className = 'add-column-button'
    this.addColumnButton.type = 'button'
    this.addColumnButton.setAttribute('contenteditable', 'false')
  }

  setupEventListeners() {
    // Add row button click handler
    this.addRowButton.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      if (!this.isEditable()) return

      this.view.focus()
      this.setSelectionToTable()

      setTimeout(() => {
        const { state, dispatch } = this.view
        addRowAfter(state, dispatch)
      }, 10)
    })

    this.addColumnButton.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      if (!this.isEditable()) return

      this.view.focus()
      this.setSelectionToTable()

      setTimeout(() => {
        const { state, dispatch } = this.view
        addColumnAfter(state, dispatch)
      }, 10)
    })
  }

  private bindOverlayHandlers() {
    if (!this.rowEndpoint || !this.colEndpoint) return
    this.rowEndpoint.addEventListener('mousedown', (e) => e.preventDefault())
    this.colEndpoint.addEventListener('mousedown', (e) => e.preventDefault())
    this.rowEndpoint.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const bounds = getCellSelectionBounds(this.view, this.node)
      if (!bounds) return
      this.selectRow(bounds.maxRow)
      const rect = this.rowEndpoint!.getBoundingClientRect()
      const position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      this.actionCallbacks?.onRowActionClick?.({ rowIndex: bounds.maxRow, view: this.view, position })
      this.scheduleOverlayUpdate()
    })
    this.colEndpoint.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const bounds = getCellSelectionBounds(this.view, this.node)
      if (!bounds) return
      this.selectColumn(bounds.maxCol)
      const rect = this.colEndpoint!.getBoundingClientRect()
      const position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      this.actionCallbacks?.onColumnActionClick?.({ colIndex: bounds.maxCol, view: this.view, position })
      this.scheduleOverlayUpdate()
    })
  }

  private startSelectionWatcher() {
    const owner = this.view.dom.ownerDocument || document
    const handler = () => this.scheduleOverlayUpdate()
    owner.addEventListener('selectionchange', handler)
    this.selectionChangeDisposer = () => owner.removeEventListener('selectionchange', handler)
    this.scheduleOverlayUpdate()
  }

  private scheduleOverlayUpdate() {
    if (this.overlayUpdateRafId !== null) {
      cancelAnimationFrame(this.overlayUpdateRafId)
    }
    this.overlayUpdateRafId = requestAnimationFrame(() => {
      this.overlayUpdateRafId = null
      this.updateOverlayPositions()
    })
  }

  private updateOverlayPositions() {
    if (!this.rowEndpoint || !this.colEndpoint) return
    const bounds = getCellSelectionBounds(this.view, this.node)
    if (!bounds) {
      this.rowEndpoint.style.display = 'none'
      this.colEndpoint.style.display = 'none'
      return
    }

    const { map, tableStart, maxRow, maxCol } = bounds

    const getCellDomAndRect = (row: number, col: number) => {
      const cellIndex = row * map.width + col
      const cellPos = tableStart + map.map[cellIndex]
      const cellDom = this.view.nodeDOM(cellPos) as HTMLElement | null
      return {
        dom: cellDom,
        rect: cellDom?.getBoundingClientRect()
      }
    }

    // Position row endpoint (left side)
    const bottomLeft = getCellDomAndRect(maxRow, 0)
    const topLeft = getCellDomAndRect(0, 0)

    if (bottomLeft.dom && bottomLeft.rect && topLeft.rect) {
      const midY = (bottomLeft.rect.top + bottomLeft.rect.bottom) / 2
      this.rowEndpoint.style.display = 'flex'
      const borderWidth = getElementBorderWidth(this.rowEndpoint)
      this.rowEndpoint.style.left = `${bottomLeft.rect.left - topLeft.rect.left - this.rowEndpoint.getBoundingClientRect().width / 2 + borderWidth.left / 2}px`
      this.rowEndpoint.style.top = `${midY - topLeft.rect.top - this.rowEndpoint.getBoundingClientRect().height / 2}px`
    } else {
      this.rowEndpoint.style.display = 'none'
    }

    // Position column endpoint (top side)
    const topRight = getCellDomAndRect(0, maxCol)
    const topLeftForCol = getCellDomAndRect(0, 0)

    if (topRight.dom && topRight.rect && topLeftForCol.rect) {
      const midX = topRight.rect.left + topRight.rect.width / 2
      const borderWidth = getElementBorderWidth(this.colEndpoint)
      this.colEndpoint.style.display = 'flex'
      this.colEndpoint.style.left = `${midX - topLeftForCol.rect.left - this.colEndpoint.getBoundingClientRect().width / 2}px`
      this.colEndpoint.style.top = `${topRight.rect.top - topLeftForCol.rect.top - this.colEndpoint.getBoundingClientRect().height / 2 + borderWidth.top / 2}px`
    } else {
      this.colEndpoint.style.display = 'none'
    }
  }

  setSelectionToTable() {
    const { state } = this.view

    let tablePos = -1
    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'table' && node === this.node) {
        tablePos = pos
        return false
      }
      return true
    })

    if (tablePos >= 0) {
      const firstCellPos = tablePos + 3
      const selection = TextSelection.create(state.doc, firstCellPos)
      const tr = state.tr.setSelection(selection)
      this.view.dispatch(tr)
    }
  }

  // selection triggers moved to decorations plugin

  hasTableCellSelection(): boolean {
    const selection = this.view.state.selection
    return isCellSelection(selection)
  }

  selectRow(rowIndex: number) {
    const { state, dispatch } = this.view

    // Find the table position
    let tablePos = -1
    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'table' && node === this.node) {
        tablePos = pos
        return false
      }
      return true
    })

    if (tablePos >= 0) {
      const map = TableMap.get(this.node)
      const firstCellInRow = map.map[rowIndex * map.width]
      const lastCellInRow = map.map[rowIndex * map.width + map.width - 1]

      const firstCellPos = tablePos + 1 + firstCellInRow
      const lastCellPos = tablePos + 1 + lastCellInRow

      const selection = CellSelection.create(state.doc, firstCellPos, lastCellPos)
      const tr = state.tr.setSelection(selection)
      dispatch(tr)
    }
  }

  selectColumn(colIndex: number) {
    const { state, dispatch } = this.view

    // Find the table position
    let tablePos = -1
    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'table' && node === this.node) {
        tablePos = pos
        return false
      }
      return true
    })

    if (tablePos >= 0) {
      const map = TableMap.get(this.node)
      const firstCellInCol = map.map[colIndex]
      const lastCellInCol = map.map[(map.height - 1) * map.width + colIndex]

      const firstCellPos = tablePos + 1 + firstCellInCol
      const lastCellPos = tablePos + 1 + lastCellInCol

      const selection = CellSelection.create(state.doc, firstCellPos, lastCellPos)
      const tr = state.tr.setSelection(selection)
      dispatch(tr)
    }
  }

  destroy() {
    this.addRowButton?.remove()
    this.addColumnButton?.remove()
    if (this.rowEndpoint) this.rowEndpoint.remove()
    if (this.colEndpoint) this.colEndpoint.remove()
    if (this.selectionChangeDisposer) this.selectionChangeDisposer()
    if (this.overlayUpdateRafId !== null) cancelAnimationFrame(this.overlayUpdateRafId)
  }
}
