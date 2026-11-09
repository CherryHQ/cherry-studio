import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { isMac } from '@renderer/utils/platform'

import { createComposerDraftContent, serializeComposerDocument } from '../../composerDraft'
import { createComposerEditorPreset } from '../../composerPreset'
import { handleMarkdownFormatKey } from '../selectionFormatKeys'

const token = { id: 'kb', kind: 'knowledge', label: 'Base', promptText: 'ATTACHED', index: 0, textOffset: 1 } as const
const editors: Editor[] = []
const primary = isMac ? { metaKey: true } : { ctrlKey: true }

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

function createEditor(text: string, tokens: Parameters<typeof createComposerDraftContent>[0]['tokens'] = []) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createComposerEditorPreset({ markdownLivePreview: true }),
    content: createComposerDraftContent({ text, tokens }, { tokenizeVariables: false })
  })
  editors.push(editor)
  return editor
}

const lineStart = (editor: Editor, line: number) => {
  let position = 1
  editor.state.doc.forEach((_block, offset, index) => {
    if (index === line) position = offset + 1
  })
  return position
}
const select = (editor: Editor, from: [number, number], to: [number, number]) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, lineStart(editor, from[0]) + from[1], lineStart(editor, to[0]) + to[1])
    )
  )
const source = (editor: Editor) => serializeComposerDocument(editor.getJSON()).text
const selectedText = (editor: Editor) =>
  editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
const press = (editor: Editor, key: string, init: KeyboardEventInit = primary) =>
  handleMarkdownFormatKey(editor.view, new KeyboardEvent('keydown', { key, ...init }))

function createSelected(text: string, from: number, to: number) {
  const editor = createEditor(text)
  select(editor, [0, from], [0, to])
  return editor
}

describe('selection formatting keys', () => {
  it.each([
    ['b', '**'],
    ['B', '**'],
    ['i', '*']
  ])('wraps the selection for %s and keeps it on the text', (key, marker) => {
    const editor = createSelected('hello world', 6, 11)

    expect(press(editor, key)).toBe(true)

    expect(source(editor)).toBe(`hello ${marker}world${marker}`)
    expect(selectedText(editor)).toBe('world')
  })

  it.each([
    ['b', 'hello **world**', 8, 13],
    ['i', 'hello *world*', 7, 12]
  ])('removes the style on a second %s', (key, text, from, to) => {
    const editor = createSelected(text, from, to)

    expect(press(editor, key)).toBe(true)

    expect(source(editor)).toBe('hello world')
    expect(selectedText(editor)).toBe('world')
  })

  it('combines bold and italic independently', () => {
    const editor = createSelected('**a**', 2, 3)

    press(editor, 'i')
    expect(source(editor)).toBe('***a***')

    press(editor, 'b')
    expect(source(editor)).toBe('*a*')

    press(editor, 'i')
    expect(source(editor)).toBe('a')
    expect(selectedText(editor)).toBe('a')
  })

  it.each([
    ['b', '**abc**', 'abc'],
    ['b', '***abc***', '*abc*'],
    ['i', '*abc*', 'abc']
  ])('treats a selection that includes its markers as styled for %s on %s', (key, text, expected) => {
    const editor = createSelected(text, 0, text.length)

    press(editor, key)

    expect(source(editor)).toBe(expected)
  })

  it('keeps whitespace at the selection edges outside the markers', () => {
    const editor = createSelected('a  word  b', 1, 9)

    press(editor, 'b')

    expect(source(editor)).toBe('a  **word**  b')
    expect(selectedText(editor)).toBe('word')
  })

  it.each([
    ['a heading', '# Title', '# **Title**'],
    ['a bullet', '- item', '- **item**'],
    ['a star bullet', '* item', '* **item**'],
    ['an ordered item', '12. item', '12. **item**'],
    ['a quote', '> line', '> **line**'],
    ['a quoted bullet', '> - item', '> - **item**']
  ])('keeps the prefix of %s outside the markers', (_name, text, expected) => {
    const editor = createSelected(text, 0, text.length)

    press(editor, 'b')

    expect(source(editor)).toBe(expected)
  })

  it('handles each selected line and skips blank ones', () => {
    const editor = createEditor('one\n\ntwo')
    select(editor, [0, 0], [2, 3])

    press(editor, 'b')
    expect(source(editor)).toBe('**one**\n\n**two**')
    expect(selectedText(editor)).toBe('one**\n\n**two')

    press(editor, 'b')
    expect(source(editor)).toBe('one\n\ntwo')
  })

  it('styles only the lines that lack the style when lines are mixed', () => {
    const editor = createEditor('**one**\ntwo')
    select(editor, [0, 2], [1, 3])

    press(editor, 'b')

    expect(source(editor)).toBe('**one**\n**two**')
  })

  it('skips fenced code inside a wider selection', () => {
    const editor = createEditor('plain\n```\ncode\n```\nafter')
    select(editor, [0, 0], [4, 5])

    press(editor, 'b')

    expect(source(editor)).toBe('**plain**\n```\ncode\n```\n**after**')
  })

  it('formats every line after select all', () => {
    const editor = createEditor('one\ntwo')
    editor.commands.selectAll()

    press(editor, 'b')

    expect(source(editor)).toBe('**one**\n**two**')
  })

  it('does not read the markers of two separate runs as one style', () => {
    const editor = createSelected('**a** and **b**', 0, 15)

    press(editor, 'b')

    expect(source(editor)).toContain('**a** and **b**')
  })

  it('keeps token offsets valid when the selection contains a token', () => {
    const editor = createEditor('aATTACHEDb', [token])
    select(editor, [0, 0], [0, 3])

    press(editor, 'b')

    const serialized = serializeComposerDocument(editor.getJSON())
    expect(serialized.text).toBe('**aATTACHEDb**')
    expect(serialized.tokens[0].textOffset).toBe(3)
  })

  it('undoes a toggle in one step', () => {
    const editor = createSelected('word', 0, 4)
    press(editor, 'b')

    editor.commands.undo()

    expect(source(editor)).toBe('word')
  })

  it.each([
    ['an empty selection', () => createSelected('word', 2, 2)],
    [
      'a selection inside fenced code',
      () => {
        const editor = createEditor('```\ncode\n```')
        select(editor, [1, 0], [1, 4])
        return editor
      }
    ],
    ['a whitespace-only selection', () => createSelected('a   b', 1, 4)]
  ])('leaves the key alone for %s', (_name, create) => {
    const editor = create()
    const before = source(editor)

    expect(press(editor, 'b')).toBe(false)
    expect(source(editor)).toBe(before)
  })

  it('leaves the key alone for a selected token', () => {
    const editor = createEditor('aATTACHED', [token])
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)))

    expect(press(editor, 'b')).toBe(false)
  })

  it.each([
    ['no modifier', {}],
    ['shift', { ...primary, shiftKey: true }],
    ['alt', { ...primary, altKey: true }],
    ['composition', { ...primary, isComposing: true }],
    ['the other platform modifier', isMac ? { ctrlKey: true } : { metaKey: true }]
  ])('ignores the key with %s', (_name, init) => {
    const editor = createSelected('word', 0, 4)

    expect(press(editor, 'b', init)).toBe(false)
    expect(source(editor)).toBe('word')
  })
})

describe('selection inline code', () => {
  const pressBacktick = (editor: Editor, init: KeyboardEventInit = {}) => press(editor, '`', init)

  it('wraps the selection and keeps it on the text', () => {
    const editor = createSelected('hello world', 6, 11)

    expect(pressBacktick(editor)).toBe(true)

    expect(source(editor)).toBe('hello `world`')
    expect(selectedText(editor)).toBe('world')
  })

  it('removes the style on a second backtick', () => {
    const editor = createSelected('hello world', 6, 11)
    pressBacktick(editor)

    expect(pressBacktick(editor)).toBe(true)

    expect(source(editor)).toBe('hello world')
    expect(selectedText(editor)).toBe('world')
  })

  it('treats a selection that includes its backticks as styled', () => {
    const editor = createSelected('`abc`', 0, 5)

    pressBacktick(editor)

    expect(source(editor)).toBe('abc')
  })

  it('does not read the backticks of two separate runs as one style', () => {
    const editor = createSelected('`a` and `b`', 0, 11)

    pressBacktick(editor)

    expect(source(editor)).toContain('`a` and `b`')
  })

  it('combines with bold around the same text', () => {
    const editor = createSelected('**a**', 2, 3)

    pressBacktick(editor)

    expect(source(editor)).toBe('**`a`**')
  })

  it('keeps asterisks a selection includes inside the code', () => {
    const editor = createSelected('**a**', 0, 5)

    pressBacktick(editor)

    expect(source(editor)).toBe('`**a**`')
  })

  it('keeps block prefixes and edge whitespace outside the backticks', () => {
    const editor = createEditor('# Title\n- a  ')
    select(editor, [0, 0], [1, 5])

    pressBacktick(editor)

    expect(source(editor)).toBe('# `Title`\n- `a`  ')
  })

  it('handles each selected line and removes them together', () => {
    const editor = createEditor('one\n\ntwo')
    select(editor, [0, 0], [2, 3])

    pressBacktick(editor)
    expect(source(editor)).toBe('`one`\n\n`two`')

    pressBacktick(editor)
    expect(source(editor)).toBe('one\n\ntwo')
  })

  it('skips fenced code inside a wider selection', () => {
    const editor = createEditor('plain\n```\ncode\n```\nafter')
    select(editor, [0, 0], [4, 5])

    pressBacktick(editor)

    expect(source(editor)).toBe('`plain`\n```\ncode\n```\n`after`')
  })

  it('accepts a layout that types the backtick with Shift', () => {
    const editor = createSelected('word', 0, 4)

    expect(pressBacktick(editor, { shiftKey: true })).toBe(true)
  })

  it.each([
    ['an empty selection', () => createSelected('word', 2, 2)],
    [
      'a selection inside fenced code',
      () => {
        const editor = createEditor('```\ncode\n```')
        select(editor, [1, 0], [1, 4])
        return editor
      }
    ]
  ])('leaves the backtick as ordinary input for %s', (_name, create) => {
    const editor = create()
    const before = source(editor)

    expect(pressBacktick(editor)).toBe(false)
    expect(source(editor)).toBe(before)
  })

  it('leaves the backtick to the default input for a selected token', () => {
    const editor = createEditor('aATTACHED', [token])
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)))

    expect(pressBacktick(editor)).toBe(false)
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['composition', { isComposing: true }]
  ])('ignores the backtick with %s', (_name, init) => {
    const editor = createSelected('word', 0, 4)

    expect(pressBacktick(editor, init)).toBe(false)
    expect(source(editor)).toBe('word')
  })
})
