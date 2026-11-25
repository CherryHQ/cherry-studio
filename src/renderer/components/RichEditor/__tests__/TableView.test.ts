import { waitFor } from '@testing-library/react'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { TableView } from '@cherrystudio/extension-table-plus'

import { createRichEditorExtensions } from '../createExtensions'

const editors: Editor[] = []
const elements: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  for (const element of elements.splice(0)) element.remove()
})

async function mountTable(widths: [unknown, unknown]) {
  const views: TableView[] = []
  class CapturedTableView extends TableView {
    constructor(...args: ConstructorParameters<typeof TableView>) {
      super(...args)
      views.push(this)
    }
  }
  const element = document.createElement('div')
  document.body.append(element)
  elements.push(element)
  const content: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: widths.map((width) => ({
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }]
            }))
          }
        ]
      }
    ]
  }
  const editor = new Editor({
    element,
    extensions: createRichEditorExtensions().map((extension) =>
      extension.name === 'table'
        ? extension.configure({ resizable: false, cellMinWidth: 40, View: CapturedTableView })
        : extension
    ),
    content
  })
  editors.push(editor)
  await waitFor(() => expect(views.length).toBeGreaterThan(0))
  const view = views[0]
  if (!view) throw new Error('Expected the real editor to create a table view')
  return view
}

describe('RichEditor table DOM boundaries', () => {
  it('uses minimum widths consistently in live and serialized tables with a malformed imported column', async () => {
    const view = await mountTable([80, 'invalid-width'])
    const columns = view.colgroup.querySelectorAll('col')

    expect(columns[0].style.width).toBe('80px')
    expect(columns[1].style.minWidth).toBe('40px')
    expect(view.table.style.minWidth).toBe('120px')
    expect(view.table.style.width).toBe('')

    const html = editors.at(-1)?.getHTML()
    if (!html) throw new Error('Expected the mounted table document')
    const exported = new DOMParser().parseFromString(html, 'text/html')
    const exportedColumns = exported.querySelectorAll('col')
    expect(exportedColumns[0].style.width).toBe('80px')
    expect(exportedColumns[1].style.minWidth).toBe('40px')
    expect(exported.querySelector('table')?.style.minWidth).toBe('120px')
  })

  it('recognizes adopted action elements while leaving text mutations to the editor', async () => {
    const view = await mountTable([80, 120])
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    elements.push(iframe)
    const foreignDocument = iframe.contentDocument
    if (!foreignDocument) throw new Error('Expected an iframe document')
    const button = document.adoptNode(foreignDocument.createElement('button'))
    button.className = 'row-action-trigger'
    const text = document.createTextNode('before')
    const observer = new MutationObserver(() => {})
    try {
      observer.observe(button, { attributes: true })
      observer.observe(text, { characterData: true })
      button.setAttribute('data-active', 'true')
      text.data = 'after'
      const records = observer.takeRecords()
      expect(records).toHaveLength(2)
      expect(view.ignoreMutation(records[0])).toBe(true)
      expect(view.ignoreMutation(records[1])).toBeFalsy()
    } finally {
      observer.disconnect()
    }
    expect(view.table.style.width).toBe('200px')
  })
})
