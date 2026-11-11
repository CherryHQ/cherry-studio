import { Editor, type JSONContent } from '@tiptap/core'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { createComposerDraftContent, serializeComposerDocument } from '../composerDraft'
import { createComposerEditorPreset } from '../composerPreset'
import { createComposerPlainTextContent, createComposerTokenContent } from '../composerTokenMarkers'
import { getComposerCursorTextOffset, getComposerPositionAtTextOffset, getComposerTextOffset } from '../quickPanel'
import type { ComposerDraftToken } from '../tokens'

const fileToken: ComposerDraftToken = { id: 'file-1', kind: 'file', label: 'attached.txt' }

describe('composer line model', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function createEditor(text = '', placeholder?: Parameters<typeof createComposerEditorPreset>[0]) {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset(placeholder),
      content: createComposerDraftContent({ text, tokens: [] }, { tokenizeVariables: false })
    })
    return editor
  }

  const textOf = (target: Editor) => serializeComposerDocument(target).text
  const linesOf = (target: Editor) =>
    ((target.getJSON() as JSONContent).content ?? []).map((paragraph) =>
      (paragraph.content ?? []).map((node) => node.text ?? `<${node.type}>`).join('')
    )
  const setCaret = (target: Editor, position: number) => target.commands.setTextSelection(position)

  describe('document builders', () => {
    it.each(['', 'a', 'a\nb', 'a\n', '\na', '\n', 'a\n\nb', '2 * 3 * 4\nArray<string>', '  indented\n\ttabbed'])(
      'keeps %j byte-identical with one paragraph per source line',
      (text) => {
        const current = createEditor(text)

        expect(textOf(current)).toBe(text)
        expect(linesOf(current)).toEqual(text.split('\n'))
      }
    )

    it('normalizes CRLF and CR line endings the way the hard-break document did', () => {
      expect(textOf(createEditor('a\r\nb\rc'))).toBe('a\nb\nc')
    })

    it('keeps token offsets stable across lines', () => {
      const quote: ComposerDraftToken = { id: 'quote-1', kind: 'quote', label: 'Quote', promptText: 'quoted' }
      const text = 'first\nquoted second\nthird'
      const current = new Editor({
        element: document.createElement('div'),
        extensions: createComposerEditorPreset(),
        content: createComposerDraftContent({ text, tokens: [{ ...quote, index: 0, textOffset: 6 }] })
      })
      editor = current

      const draft = serializeComposerDocument(current)
      expect(draft.text).toBe(text)
      expect(draft.tokens).toMatchObject([{ id: 'quote-1', textOffset: 6 }])
    })

    it('serializes the same text as the hard-break document it replaces', () => {
      const hardBreakDocument: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'hardBreak' },
              { type: 'hardBreak' },
              { type: 'text', text: 'b' }
            ]
          }
        ]
      }

      expect(textOf(createEditor('a\n\nb'))).toBe(serializeComposerDocument(hardBreakDocument).text)
    })
  })

  describe('newline shortcut', () => {
    it('splits the line at the caret and moves the caret to the new line', () => {
      const current = createEditor('abcd')
      setCaret(current, 3)

      current.commands.splitComposerLine()

      expect(linesOf(current)).toEqual(['ab', 'cd'])
      expect(textOf(current)).toBe('ab\ncd')
      expect(getComposerCursorTextOffset(current)).toBe(3)
    })

    it('scrolls the new line into view', () => {
      const current = createEditor('first line')
      setCaret(current, 11)
      const scrolledIntoView: boolean[] = []
      current.on('transaction', ({ transaction }) => scrolledIntoView.push(transaction.scrolledIntoView))

      current.commands.splitComposerLine()

      expect(textOf(current)).toBe('first line\n')
      expect(scrolledIntoView).toContain(true)
    })

    it('replaces a selection that spans lines', () => {
      const current = createEditor('ab\ncd')
      current.commands.setTextSelection({ from: 2, to: 6 })

      current.commands.splitComposerLine()

      expect(textOf(current)).toBe('a\nd')
    })

    it('replaces a whole-document selection', () => {
      const current = createEditor('ab\ncd')
      current.view.dispatch(current.state.tr.setSelection(new AllSelection(current.state.doc)))

      current.commands.splitComposerLine()

      expect(textOf(current)).toBe('\n')
    })

    it('replaces a selected token', () => {
      const current = createEditor('ab')
      setCaret(current, 3)
      current.commands.insertComposerLines([createComposerTokenContent(fileToken)])
      current.view.dispatch(current.state.tr.setSelection(NodeSelection.create(current.state.doc, 3)))

      current.commands.splitComposerLine()

      expect(serializeComposerDocument(current)).toEqual({ text: 'ab\n', tokens: [] })
    })

    it('undoes and redoes as one step', () => {
      const current = createEditor('abcd')
      setCaret(current, 3)

      current.commands.splitComposerLine()
      current.commands.undo()
      expect(textOf(current)).toBe('abcd')

      current.commands.redo()
      expect(textOf(current)).toBe('ab\ncd')
    })
  })

  describe('line joins', () => {
    it('joins the previous line on Backspace at a line start', () => {
      const current = createEditor('ab\ncd')
      setCaret(current, 5)

      current.commands.keyboardShortcut('Backspace')

      expect(textOf(current)).toBe('abcd')
      expect(getComposerCursorTextOffset(current)).toBe(2)
    })

    it('joins the next line on Delete at a line end', () => {
      const current = createEditor('ab\ncd')
      setCaret(current, 3)

      current.commands.keyboardShortcut('Delete')

      expect(textOf(current)).toBe('abcd')
      expect(getComposerCursorTextOffset(current)).toBe(2)
    })

    it('removes an empty line on Backspace', () => {
      const current = createEditor('a\n\nb')
      setCaret(current, 4)

      current.commands.keyboardShortcut('Backspace')

      expect(textOf(current)).toBe('a\nb')
    })
  })

  describe('multi-line insertion', () => {
    it.each([
      ['x\ny', 'abx\nycd'],
      ['x\n', 'abx\ncd'],
      ['\ny', 'ab\nycd'],
      ['\n', 'ab\ncd'],
      ['x\n\ny', 'abx\n\nycd']
    ])('merges %j into the surrounding line', (inserted, expected) => {
      const current = createEditor('abcd')
      setCaret(current, 3)

      current.commands.insertComposerLines(createComposerPlainTextContent(inserted))

      expect(textOf(current)).toBe(expected)
      expect(linesOf(current)).toEqual(expected.split('\n'))
      expect(getComposerCursorTextOffset(current)).toBe(2 + inserted.length)
    })

    it('fills an empty document', () => {
      const current = createEditor('')

      current.commands.insertComposerLines(createComposerPlainTextContent('x\ny'))

      expect(linesOf(current)).toEqual(['x', 'y'])
    })

    it('replaces a whole-document selection', () => {
      const current = createEditor('ab\ncd')
      current.view.dispatch(current.state.tr.setSelection(new AllSelection(current.state.doc)))

      current.commands.insertComposerLines(createComposerPlainTextContent('x\ny'))

      expect(textOf(current)).toBe('x\ny')
    })

    it('keeps tokens on the line they were spliced into', () => {
      const current = createEditor('')

      current.commands.insertComposerLines([
        ...createComposerPlainTextContent('a\n'),
        createComposerTokenContent({ ...fileToken, promptText: 'chip' }),
        ...createComposerPlainTextContent('\nb')
      ])

      const draft = serializeComposerDocument(current)
      expect(draft.text).toBe('a\nchip\nb')
      expect(draft.tokens).toMatchObject([{ id: 'file-1', textOffset: 2 }])
      expect(linesOf(current)).toEqual(['a', '<composerToken>', 'b'])
    })
  })

  describe('foreign line breaks', () => {
    it('folds a <br> into a paragraph boundary', () => {
      const current = createEditor('')

      current.commands.setContent('<p>ab<br>cd<br></p>')

      expect(linesOf(current)).toEqual(['ab', 'cd', ''])
    })

    it('keeps a caret after the break on the new line', () => {
      const current = createEditor('abcd')
      setCaret(current, 3)

      current.view.dispatch(current.state.tr.insert(3, current.schema.nodes.hardBreak.create()))

      expect(linesOf(current)).toEqual(['ab', 'cd'])
      expect(getComposerCursorTextOffset(current)).toBe(3)
    })

    it('keeps a caret before the break on the old line', () => {
      const current = createEditor('abcd')
      const transaction = current.state.tr.insert(3, current.schema.nodes.hardBreak.create())

      current.view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, 3)))

      expect(linesOf(current)).toEqual(['ab', 'cd'])
      expect(getComposerCursorTextOffset(current)).toBe(2)
    })

    it('leaves a break alone during composition and folds it on the next change', () => {
      const current = createEditor('abcd')
      let composing = true
      Object.defineProperty(current.view, 'composing', { configurable: true, get: () => composing })

      current.view.dispatch(current.state.tr.insert(3, current.schema.nodes.hardBreak.create()))
      expect(linesOf(current)).toEqual(['ab<hardBreak>cd'])
      expect(textOf(current)).toBe('ab\ncd')

      composing = false
      current.view.dispatch(current.state.tr.insertText('!', 1))
      expect(linesOf(current)).toEqual(['!ab', 'cd'])
    })
  })

  describe('placeholder', () => {
    const visiblePlaceholders = (target: Editor) =>
      [...target.view.dom.querySelectorAll('[data-placeholder]')].filter((element) =>
        element.getAttribute('data-placeholder')
      )

    it('shows on the first line of an empty composer', () => {
      const current = createEditor('', { placeholder: 'Message' })

      const [placeholder, ...others] = visiblePlaceholders(current)
      expect(others).toHaveLength(0)
      expect(placeholder).toBe(current.view.dom.firstElementChild)
      expect(placeholder.getAttribute('data-placeholder')).toBe('Message')
    })

    it('resolves a function placeholder', () => {
      const current = createEditor('', { placeholder: () => 'Computed' })

      expect(visiblePlaceholders(current)[0]?.getAttribute('data-placeholder')).toBe('Computed')
    })

    it('stays hidden on an empty line when the composer has other lines', () => {
      const current = createEditor('', { placeholder: 'Message' })
      setCaret(current, 1)

      current.commands.splitComposerLine()
      expect(visiblePlaceholders(current)).toHaveLength(0)

      current.commands.insertComposerLines(createComposerPlainTextContent('text'))
      current.commands.splitComposerLine()
      expect(visiblePlaceholders(current)).toHaveLength(0)
    })

    it('comes back after the composer is cleared', () => {
      const current = createEditor('ab\ncd', { placeholder: 'Message' })
      expect(visiblePlaceholders(current)).toHaveLength(0)

      current.commands.setContent(createComposerDraftContent({ text: '', tokens: [] }))

      expect(visiblePlaceholders(current)).toHaveLength(1)
    })
  })

  it('copies selected lines with a single newline between them', () => {
    const current = createEditor('ab\ncd')
    current.commands.setTextSelection({ from: 1, to: 7 })

    const text = current.view.someProp('clipboardTextSerializer', (serialize) =>
      serialize(current.state.selection.content(), current.view)
    )

    expect(text).toBe('ab\ncd')
  })

  it('maps text offsets and positions consistently across empty lines', () => {
    const current = createEditor('a\n\nbc\n')
    const { text } = serializeComposerDocument(current)

    for (let offset = 0; offset <= text.length; offset += 1) {
      expect(getComposerTextOffset(current, getComposerPositionAtTextOffset(current, offset))).toBe(offset)
    }
  })
})
