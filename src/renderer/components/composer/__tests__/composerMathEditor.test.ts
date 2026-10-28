import { Editor, type JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { serializeComposerDocument } from '../composerDraft'
import { configureComposerInlineMath, synchronizeComposerMath } from '../composerMathExtension'
import { createComposerEditorPreset } from '../composerPreset'
import { tokenizePromptVariablesInEditor } from '../promptVariables'

const math = (latex: string) => ({ type: 'inlineMath', attrs: { latex } })
const text = (value: string) => ({ type: 'text', text: value })

describe('composer math editor', () => {
  let editor: Editor
  let enabled = true

  function createEditor(content: string | JSONContent = '') {
    enabled = true
    editor = new Editor({
      extensions: [...createComposerEditorPreset({}), configureComposerInlineMath(() => enabled)],
      content,
      onUpdate: ({ editor, transaction }) => tokenizePromptVariablesInEditor(editor, transaction)
    })
    return editor
  }

  function children() {
    return editor.getJSON().content?.[0].content ?? []
  }

  function key(key: string) {
    return editor.view.someProp('handleKeyDown', (handler) =>
      handler(editor.view, new KeyboardEvent('keydown', { key }))
    )
  }

  afterEach(() => editor?.destroy())

  it('converts completed formulas without changing their serialized source', () => {
    createEditor().commands.insertContent('see $x$')
    expect(children()).toEqual([text('see '), math('x')])
    expect(serializeComposerDocument(editor).text).toBe('see $x$')
  })

  it('expands math after a trailing digit and restores it when the digit is removed', () => {
    createEditor().commands.insertContent('$x$')
    expect(children()).toEqual([math('x')])
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('2')
    expect(children()).toEqual([text('$x$2')])
    expect(serializeComposerDocument(editor).text).toBe('$x$2')
    editor.commands.deleteRange({ from: 4, to: 5 })
    expect(children()).toEqual([math('x')])
    expect(serializeComposerDocument(editor).text).toBe('$x$')

    editor.commands.setContent('$a$ and $b$')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent(' continuing')
    expect(children()).toEqual([math('a'), text(' and '), math('b'), text(' continuing')])
  })

  it('expands math after an escaping backslash and restores it when the backslash is removed', () => {
    createEditor().commands.insertContent('$x$')
    expect(children()).toEqual([math('x')])
    editor.commands.setTextSelection(1)
    editor.commands.insertContent('\\')
    expect(children()).toEqual([text(String.raw`\$x$`)])
    expect(serializeComposerDocument(editor).text).toBe(String.raw`\$x$`)
    editor.commands.deleteRange({ from: 1, to: 2 })
    expect(children()).toEqual([math('x')])
    expect(serializeComposerDocument(editor).text).toBe('$x$')

    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [text(String.raw`\\`), math('x'), text(' distant')] }]
    })
    expect(children()).toEqual([text(String.raw`\\`), math('x'), text(' distant')])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('!')
    expect(children()).toEqual([text(String.raw`\\`), math('x'), text(' distant!')])
  })

  it.each(['A$x$B', '计算$x$的值'])('preserves text on both sides of %s', (source) => {
    createEditor().commands.insertContent(source)
    const [before, after] = source.split('$x$')
    expect(children()).toEqual([text(before), math('x'), text(after)])
    expect(serializeComposerDocument(editor).text).toBe(source)
  })

  it('converts silent setContent and JSON paste transactions', () => {
    createEditor().commands.setContent('<p>see $x$</p>', { emitUpdate: false })
    expect(children()).toEqual([text('see '), math('x')])
    editor.commands.insertContent({ type: 'text', text: '$y$' })
    expect(children().filter((node) => node.type === 'inlineMath')).toEqual([math('x'), math('y')])
  })

  it('preserves prompt variables and refuses candidates across token boundaries', () => {
    createEditor().commands.insertContent('${name} $x$')
    expect(children()[0]).toMatchObject({ type: 'composerToken', attrs: { kind: 'promptVariable', label: 'name' } })
    expect(children().at(-1)).toEqual(math('x'))
    expect(serializeComposerDocument(editor).text).toBe('${name} $x$')
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('$x'), { type: 'hardBreak' }, text('y$')] }]
    })
    expect(children().some((node) => node.type === 'inlineMath')).toBe(false)
  })

  it('groups typing and conversion in history and deletes an atom with one Backspace', () => {
    createEditor().commands.setContent('$x', { emitUpdate: false })
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('$')
    expect(children()).toEqual([math('x')])
    editor.commands.undo()
    expect(children()).toEqual([text('$x')])
    editor.commands.redo()
    expect(children()).toEqual([math('x')])
    editor.commands.setTextSelection(2)
    expect(key('Backspace')).toBe(true)
    expect(children()).toEqual([])
    editor.commands.undo()
    expect(children()).toEqual([math('x')])
    editor.commands.redo()
    expect(children()).toEqual([])
  })

  it('handles Delete and math NodeSelection', () => {
    createEditor().commands.insertContent('$x$')
    editor.commands.setTextSelection(1)
    expect(key('Delete')).toBe(true)
    expect(children()).toEqual([])
    editor.commands.insertContent('$y$')
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
    expect(key('Backspace')).toBe(true)
    expect(children()).toEqual([])
  })

  it('keeps disabled source literal and expands math restored by undo and redo', () => {
    createEditor()
    enabled = false
    editor.commands.insertContent('$x$')
    expect(children()).toEqual([text('$x$')])
    enabled = true
    editor.commands.insertContent(' ')
    expect(children()).toEqual([math('x'), text(' ')])
    enabled = false
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands.insertContent(' ')
    expect(children()).toEqual([text('$x$  ')])
    editor.commands.undo()
    expect(children()).toEqual([text('$x$ ')])
    editor.commands.redo()
    expect(children()).toEqual([text('$x$  ')])
  })

  it('defers conversion during composition until the next document transaction', () => {
    createEditor()
    Object.defineProperty(editor.view, 'composing', { configurable: true, value: true })
    editor.commands.insertContent('$x$')
    expect(children()).toEqual([text('$x$')])
    Object.defineProperty(editor.view, 'composing', { configurable: true, value: false })
    editor.commands.insertContent(' ')
    expect(children()).toEqual([math('x'), text(' ')])
  })

  it.each(['$$x$$', '$x', '$ x $', '$5 and $10'])('keeps unsupported source %s editable', (source) => {
    createEditor().commands.insertContent(source)
    expect(children()).toEqual([text(source)])
  })

  it('initializes preview outside user history', async () => {
    createEditor('$x$')
    await new Promise<void>((resolve) => editor.on('create', () => resolve()))
    expect(children()).toEqual([math('x')])
    expect(editor.commands.undo()).toBe(false)
  })

  it('expands invalid imported atoms and places an expanded node selection at the source end', () => {
    createEditor().commands.insertContent([math('x^{'), math('')])
    expect(children()).toEqual([text('$x^{$$$')])
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [math('x')] }] })
    editor.commands.setNodeSelection(1)
    enabled = false
    synchronizeComposerMath(editor, enabled)
    expect(children()).toEqual([text('$x$')])
    expect(editor.state.selection.from).toBe(4)
  })

  it('gates HTML parsing with the current preference and exports source as leaf text', () => {
    createEditor()
    enabled = false
    editor.commands.setContent('<p><span data-type="inline-math" data-latex="x">$x$</span></p>')
    expect(children()).toEqual([text('$x$')])
    enabled = true
    editor.commands.setContent('<p><span data-type="inline-math" data-latex="x">$x$</span></p>')
    expect(children()).toEqual([math('x')])
    expect(editor.getText()).toBe('$x$')
    expect(editor.getHTML()).toContain('data-latex="x"')
    expect('insertInlineMath' in editor.commands).toBe(false)
  })
})
