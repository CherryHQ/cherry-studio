import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { addColumnAfter, addRowAfter } from '@tiptap/pm/tables'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'

import { getColStyleDeclaration } from './utilities/colStyle.js'

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

  constructor(node: ProseMirrorNode, cellMinWidth: number, view: EditorView) {
    this.node = node
    this.cellMinWidth = cellMinWidth
    this.view = view

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
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false
    }

    this.node = node
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth)

    // Keep buttons' disabled state in sync during updates
    this.syncEditableState()

    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type === 'attributes' && (mutation.target === this.table || this.colgroup.contains(mutation.target))
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

  destroy() {
    this.addRowButton?.remove()
    this.addColumnButton?.remove()
  }
}
