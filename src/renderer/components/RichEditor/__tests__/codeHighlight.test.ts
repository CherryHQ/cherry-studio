import { waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadCodeHighlightRuntime } from '@cherrystudio/ui/code-highlight'

import { createRichEditorExtensions } from '../createExtensions'
import { codeHighlightPluginKey } from '../extensions/codeBlockHighlight/highlightPlugin'

const editors: Editor[] = []
function create(content: string, codeTheme = 'one-light') {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions({ codeTheme }),
    content,
    contentType: 'markdown'
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
  vi.restoreAllMocks()
})
const colors = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('code span[style]')].map((element) => element.getAttribute('style'))

describe('code highlighting in RichEditor', () => {
  it('keeps editor theme state independent and rehighlights replacements without changing the document', async () => {
    const source = '```typescript\nconst value = "中文 🍒"\n```'
    const light = create(source)
    const dark = create(source, 'nord')
    await waitFor(() => {
      expect(colors(light).length).toBeGreaterThan(0)
      expect(colors(dark).length).toBeGreaterThan(0)
    })
    expect(colors(light)).not.toEqual(colors(dark))
    light.destroy()
    const replacement = '```typescript\n// comment\nlet next = 42\n```'
    dark.commands.setContent(replacement, { contentType: 'markdown' })
    await waitFor(() => expect(dark.view.dom.querySelector('code')?.textContent).toBe('// comment\nlet next = 42'))
    expect(colors(dark).length).toBeGreaterThan(0)
    expect(dark.getMarkdown()).toContain('let next = 42')
  })

  it('round-trips unsupported languages without decoration or loss of source text', async () => {
    const editor = create('```not-a-language\n<source> 🍒\n```')
    await waitFor(() => expect(editor.view.dom.querySelector('code')?.textContent).toBe('<source> 🍒'))
    expect(colors(editor)).toEqual([])
    expect(editor.getMarkdown()).toContain('```not-a-language\n<source> 🍒\n```')
  })
  it('updates only edited blocks, tracks moved blocks, and releases removed or destroyed sessions', async () => {
    const runtime = await loadCodeHighlightRuntime()
    const original = runtime.createDocument
    const sessions: { source: string; update: ReturnType<typeof vi.spyOn>; dispose: ReturnType<typeof vi.spyOn> }[] = []
    vi.spyOn(runtime, 'createDocument').mockImplementation((...args) => {
      const document = original(...args)
      sessions.push({ source: args[0], update: vi.spyOn(document, 'update'), dispose: vi.spyOn(document, 'dispose') })
      return document
    })
    const editor = create('```typescript\nconst alpha = 1\n```\n\nparagraph\n\n```typescript\nconst beta = 2\n```')
    await waitFor(() => expect(colors(editor).length).toBeGreaterThan(2))
    const beta = sessions.find((session) => session.source.includes('beta'))!
    const alpha = sessions.find((session) => session.source.includes('alpha'))!
    const first = editor.state.doc.firstChild!
    editor.view.dispatch(
      editor.state.tr.insertText('42', first.textContent.indexOf('1') + 1, first.textContent.indexOf('1') + 2)
    )
    expect(editor.getMarkdown()).toContain('const alpha = 42')
    expect(alpha.update.mock.calls).toHaveLength(1)
    expect(beta.update.mock.calls).toHaveLength(0)
    editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'prefix' }] })
    expect(editor.view.dom.querySelectorAll('code')[1].textContent).toBe('const beta = 2')
    expect(beta.update.mock.calls).toHaveLength(0)
    expect(sessions).toHaveLength(2)
    let betaPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock' && node.textContent.includes('beta')) betaPos = pos
    })
    editor.view.dispatch(editor.state.tr.delete(betaPos, betaPos + editor.state.doc.nodeAt(betaPos)!.nodeSize))
    expect(beta.dispose.mock.calls).toHaveLength(1)
    expect(editor.getMarkdown()).not.toContain('beta')
    editor.destroy()
    expect(alpha.dispose.mock.calls).toHaveLength(1)
  })

  it('keeps theme updates out of document history and handles split/join and undo/redo', async () => {
    const editor = create('```typescript\nconst alpha = 1\nconst beta = 2\n```')
    await waitFor(() => expect(colors(editor).length).toBeGreaterThan(0))
    editor.commands.setTextSelection(7)
    editor.commands.insertContent('new_')
    const selection = editor.state.selection.toJSON()
    const doc = editor.state.doc.toJSON()
    const before = colors(editor)
    let documentUpdates = 0
    editor.on('update', () => documentUpdates++)
    editor.view.dispatch(editor.state.tr.setMeta(codeHighlightPluginKey, 'nord').setMeta('addToHistory', false))
    await waitFor(() => expect(colors(editor)).not.toEqual(before))
    expect(editor.state.doc.toJSON()).toEqual(doc)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(documentUpdates).toBe(0)
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe('const alpha = 1\nconst beta = 2')
    editor.commands.redo()
    expect(editor.state.doc.toJSON()).toEqual(doc)
    editor.commands.undo()
    editor.view.dispatch(editor.state.tr.split(17))
    expect(editor.view.dom.querySelectorAll('code')).toHaveLength(2)
    const secondPos = editor.state.doc.firstChild!.nodeSize
    editor.view.dispatch(editor.state.tr.join(secondPos))
    expect(editor.view.dom.querySelectorAll('code')).toHaveLength(1)
    expect(editor.state.doc.textContent).toBe('const alpha = 1\nconst beta = 2')
    editor.commands.insertContentAt({ from: 7, to: 12 }, 'name')
    expect(editor.getMarkdown()).toContain('const name = 1')
    editor.commands.undo()
    expect(editor.getMarkdown()).toContain('const alpha = 1')
    editor.commands.redo()
    expect(editor.getMarkdown()).toContain('const name = 1')
    expect(colors(editor).length).toBeGreaterThan(0)
  })

  it('keeps a CRLF code block editable after deleting only its CR', async () => {
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
    await waitFor(() => expect(colors(editor).length).toBeGreaterThan(0))
    editor.view.dispatch(editor.state.tr.delete(11, 12))
    expect(editor.state.doc.textContent).toBe('const a=1;\nconst b=2;')
    editor.view.dispatch(editor.state.tr.insertText('next_', 18))
    expect(editor.state.doc.textContent).toBe('const a=1;\nconst next_b=2;')
    expect(editor.view.dom.querySelector('code')?.textContent).toBe(editor.state.doc.textContent)
  })
})
