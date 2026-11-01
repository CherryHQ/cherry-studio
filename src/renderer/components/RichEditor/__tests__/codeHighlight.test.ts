import '@vitest/web-worker'
import { waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { codeHighlightService } from '@renderer/services/CodeHighlightService'

import { createRichEditorExtensions } from '../createExtensions'

const editors: Editor[] = []
function create(content: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content,
    contentType: 'markdown'
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
})
afterAll(() => codeHighlightService.dispose())
const keywords = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('code .code-syntax-keyword')].map((node) => node.textContent)

describe('shared code highlighting in RichEditor', () => {
  it('classifies edited and moved blocks without changing untouched source', async () => {
    const editor = create('```typescript\nconst alpha = 1\n```\n\nparagraph\n\n```typescript\nconst beta = 2\n```')
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    editor.view.dispatch(editor.state.tr.insertText('let', 1, 6))
    await waitFor(() => expect(keywords(editor)).toEqual(['let', 'const']))
    editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'prefix' }] })
    expect(editor.view.dom.querySelectorAll('code')[1].textContent).toBe('const beta = 2')
    expect(keywords(editor)).toEqual(['let', 'const'])
    let betaPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock' && node.textContent.includes('beta')) betaPos = pos
    })
    editor.view.dispatch(editor.state.tr.delete(betaPos, betaPos + editor.state.doc.nodeAt(betaPos)!.nodeSize))
    expect(editor.getMarkdown()).not.toContain('beta')
    expect(keywords(editor)).toEqual(['let'])
  })

  it('preserves unknown language, Unicode and whitespace without decorations', async () => {
    const editor = create('```not-a-language\n<source> 🍒  \n\n```')
    await waitFor(() => expect(editor.view.dom.querySelector('code')?.textContent).toBe('<source> 🍒  \n'))
    expect(keywords(editor)).toEqual([])
    expect(editor.getMarkdown()).toContain('```not-a-language\n<source> 🍒  \n\n```')
  })

  it('ignores obsolete parser results after an external document replacement', async () => {
    const editor = create('```typescript\n/*\n' + 'old comment\n'.repeat(2000) + '*/\n```')
    editor.commands.setContent('```typescript\nconst fresh = "中文 🍒"\n```', { contentType: 'markdown' })
    await waitFor(() => expect(keywords(editor)).toEqual(['const']), { timeout: 10000 })
    expect(editor.view.dom.querySelector('code')?.textContent).toBe('const fresh = "中文 🍒"')
    expect(editor.view.dom.querySelector('.code-syntax-comment')).toBeNull()
    expect(editor.getMarkdown()).toContain('const fresh = "中文 🍒"')
  })

  it('keeps asynchronous decorations out of selections and undo history through split and join', async () => {
    const editor = create('```typescript\nconst alpha = 1\nconst beta = 2\n```')
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    editor.commands.setTextSelection(7)
    editor.commands.insertContent('new_')
    const selection = editor.state.selection.toJSON()
    const doc = editor.state.doc.toJSON()
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    expect(editor.state.doc.toJSON()).toEqual(doc)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe('const alpha = 1\nconst beta = 2')
    editor.commands.redo()
    expect(editor.state.doc.toJSON()).toEqual(doc)
    editor.commands.undo()
    editor.view.dispatch(editor.state.tr.split(17))
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    const secondPos = editor.state.doc.firstChild!.nodeSize
    editor.view.dispatch(editor.state.tr.join(secondPos))
    expect(editor.state.doc.textContent).toBe('const alpha = 1\nconst beta = 2')
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
  })

  it('keeps CRLF offsets correct after deleting only the CR', async () => {
    const editor = create('')
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const a=1;\r\nconst b=2;' }]
        }
      ]
    })
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    editor.view.dispatch(editor.state.tr.delete(11, 12))
    editor.view.dispatch(editor.state.tr.insertText('next_', 18))
    await waitFor(() => expect(keywords(editor)).toEqual(['const', 'const']))
    expect(editor.view.dom.querySelector('code')?.textContent).toBe('const a=1;\nconst next_b=2;')
  })
})
