import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createComposerDraftContent, serializeComposerDocument } from '../../composerDraft'
import { createComposerEditorPreset } from '../../composerPreset'
import { createComposerPlainTextContent } from '../../composerTokenMarkers'
import type { ComposerSerializedToken } from '../../tokens'

const editors: Editor[] = []

function createEditor(text: string, tokens: ComposerSerializedToken[] = [], markdownLivePreview = true) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createComposerEditorPreset({ markdownLivePreview }),
    content: createComposerDraftContent({ text, tokens }, { tokenizeVariables: false })
  })
  editors.push(editor)
  return editor
}

const textsOf = (editor: Editor, selector: string) =>
  [...editor.view.dom.querySelectorAll(selector)].map((element) => element.textContent)
const hiddenMarkers = (editor: Editor) => textsOf(editor, '.composer-md-syntax-hidden')
const lineElement = (editor: Editor, index: number) => editor.view.dom.children[index]

/** Positions the caret inside the given 0-based line, at a 0-based column. */
function caretAt(editor: Editor, line: number, column = 0) {
  let position = 1
  editor.state.doc.forEach((_block, offset, index) => {
    if (index === line) position = offset + 1 + column
  })
  editor.commands.setTextSelection(position)
}

function pluginDecorations(editor: Editor) {
  const plugin = editor.state.plugins.find((candidate) =>
    (candidate as unknown as { key: string }).key.startsWith('composerMarkdownLivePreview')
  )
  const state = plugin?.getState(editor.state) as { decorations: DecorationSet }
  return state.decorations
    .find()
    .map((decoration) => {
      const { attrs } = decoration.spec as { attrs?: unknown }
      const className = (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class
      return `${decoration.from}-${decoration.to}:${className}${attrs ? JSON.stringify(attrs) : ''}`
    })
    .sort()
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.useRealTimers()
})

describe('Markdown live preview', () => {
  describe('rendering', () => {
    it.each([
      ['**bold**', '.composer-md-strong', 'bold', ['**', '**']],
      ['*italic*', '.composer-md-emphasis', 'italic', ['*', '*']],
      ['~~gone~~', '.composer-md-delete', 'gone', ['~~', '~~']],
      ['`code`', '.composer-md-inline-code', 'code', ['`', '`']],
      ['[label](https://a.b)', '.composer-md-link', 'label', ['[', '](https://a.b)']],
      ['# Title', '.composer-md-heading-1', '# Title', ['# ']],
      ['###### Small', '.composer-md-heading-6', '###### Small', ['###### ']],
      ['> quoted', '.composer-md-quote', '> quoted', ['> ']]
    ])('styles %s and hides its markers away from the caret', (source, selector, styled, hidden) => {
      const editor = createEditor(`caret\n${source}`)

      expect(textsOf(editor, selector).join('')).toBe(styled)
      expect(hiddenMarkers(editor)).toEqual(hidden)
    })

    it.each([
      ['- item', '-'],
      ['1. item', '1.']
    ])('keeps the %s list marker visible', (source, marker) => {
      const editor = createEditor(`caret\n${source}`)

      expect(textsOf(editor, '.composer-md-list-marker')).toEqual([marker])
      expect(hiddenMarkers(editor)).toEqual([])
      expect(lineElement(editor, 1).classList.contains('composer-md-list-line')).toBe(true)
    })

    it('marks every line of a block quote', () => {
      const editor = createEditor('caret\n> one\n> two')

      expect(lineElement(editor, 1).classList.contains('composer-md-quote-line')).toBe(true)
      expect(lineElement(editor, 2).classList.contains('composer-md-quote-line')).toBe(true)
      expect(hiddenMarkers(editor)).toEqual(['> ', '> '])
    })

    it('styles an emphasis span across its source lines', () => {
      const editor = createEditor('caret\n*one\ntwo*')

      expect(textsOf(editor, '.composer-md-emphasis')).toEqual(['one', 'two'])
      expect(hiddenMarkers(editor)).toEqual(['*', '*'])
    })

    it.each([
      ['a table', '| a | **b** |\n| - | - |\n| 1 | 2 |'],
      ['an image', '![*alt*](pic.png)'],
      ['inline LaTeX', '$x + y$'],
      ['block LaTeX', '$$\nx + y\n$$'],
      ['a bracketed index', 'array[0] and [note]'],
      ['spaced asterisks', '2 * 3 * 4'],
      ['a generic type', 'Array<string>']
    ])('leaves %s as literal source', (_name, source) => {
      const editor = createEditor(`caret\n${source}`)

      expect(hiddenMarkers(editor)).toEqual([])
      expect(editor.view.dom.querySelector('.composer-md-strong, .composer-md-emphasis, .composer-md-link')).toBeNull()
      expect(serializeComposerDocument(editor).text).toBe(`caret\n${source}`)
    })
  })

  describe('reveal', () => {
    it('shows markers while the selection touches the span and hides them after it leaves', () => {
      const editor = createEditor('x **bold** y\nnext')
      caretAt(editor, 1)
      expect(hiddenMarkers(editor)).toEqual(['**', '**'])

      caretAt(editor, 0, 5)
      expect(hiddenMarkers(editor)).toEqual([])
      expect(textsOf(editor, '.composer-md-syntax')).toEqual(['**', '**'])

      caretAt(editor, 1)
      expect(hiddenMarkers(editor)).toEqual(['**', '**'])
    })

    it('reveals a quote marker only on the line holding the caret', () => {
      const editor = createEditor('> one\n> two\nnext')

      caretAt(editor, 1, 3)

      expect(hiddenMarkers(editor)).toEqual(['> '])
    })

    it('reveals a heading marker while the caret is anywhere on its line', () => {
      const editor = createEditor('# Title\nnext')
      caretAt(editor, 1)
      expect(hiddenMarkers(editor)).toEqual(['# '])

      caretAt(editor, 0, 7)
      expect(hiddenMarkers(editor)).toEqual([])
    })

    it('reveals every span a range selection touches', () => {
      const editor = createEditor('**a** x **b**\nnext')

      editor.commands.setTextSelection({ from: 3, to: 12 })

      expect(hiddenMarkers(editor)).toEqual([])
    })
  })

  describe('source fidelity', () => {
    function applyEdits(editor: Editor) {
      editor.commands.insertComposerLines(createComposerPlainTextContent('**bold** 2 * 3 * 4\nArray<string>'))
      editor.commands.splitComposerLine()
      editor.commands.insertComposerLines(createComposerPlainTextContent('# h\n> q'))
      editor.commands.undo()
      editor.commands.insertComposerLines(createComposerPlainTextContent('- [ ] task `x`'))
      return serializeComposerDocument(editor)
    }

    it('serializes exactly what the same edits produce without live preview', () => {
      expect(applyEdits(createEditor(''))).toEqual(applyEdits(createEditor('', [], false)))
    })

    it('copies hidden markers with the selected source', () => {
      const editor = createEditor('**bold**\n> quote')
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })

      const copied = editor.view.someProp('clipboardTextSerializer', (serialize) =>
        serialize(editor.state.selection.content(), editor.view)
      )

      expect(copied).toBe('**bold**\n> quote')
    })
  })

  describe('tokens', () => {
    const token: ComposerSerializedToken = {
      id: 'quote-1',
      kind: 'quote',
      label: 'Quote',
      promptText: 'chip',
      index: 0,
      textOffset: 9
    }

    it('keeps a token inside a styled span at its original offset', () => {
      const text = 'x\n**a b chip c**\nend'
      const editor = createEditor(text, [{ ...token, textOffset: 8 }])

      let tokenPosition = 0
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'composerToken') tokenPosition = position
      })

      expect(textsOf(editor, '.composer-md-strong')).toEqual(['a b ', 'c'])
      expect((editor.view.nodeDOM(tokenPosition) as HTMLElement).className).not.toContain('composer-md')
      expect(hiddenMarkers(editor)).toEqual(['**', '**'])
      expect(serializeComposerDocument(editor)).toMatchObject({
        text,
        tokens: [{ id: 'quote-1', textOffset: 8 }]
      })
    })

    it('deletes a token inside a heading as one unit', () => {
      const editor = createEditor('# a chip b\nend', [{ ...token, textOffset: 4 }])
      let tokenPosition = 0
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'composerToken') tokenPosition = position
      })

      editor.chain().setNodeSelection(tokenPosition).deleteSelection().run()

      expect(serializeComposerDocument(editor)).toEqual({ text: '# a b\nend', tokens: [] })
      caretAt(editor, 1)
      expect(hiddenMarkers(editor)).toEqual(['# '])
    })
  })

  describe('composition', () => {
    const compose = (editor: Editor, type: 'compositionstart' | 'compositionend') =>
      editor.view.dom.dispatchEvent(new CompositionEvent(type, { bubbles: true }))

    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('holds decorations still until composition settles', () => {
      const editor = createEditor('caret\nplain')

      compose(editor, 'compositionstart')
      editor.view.dispatch(editor.state.tr.insertText('**x**', editor.state.doc.content.size - 1))
      expect(hiddenMarkers(editor)).toEqual([])

      compose(editor, 'compositionend')
      expect(hiddenMarkers(editor)).toEqual([])

      vi.advanceTimersByTime(40)
      expect(textsOf(editor, '.composer-md-strong')).toEqual(['x'])
    })

    it('keeps holding when the next composition starts before the last one settles', () => {
      const editor = createEditor('caret\nplain')

      compose(editor, 'compositionstart')
      compose(editor, 'compositionend')
      vi.advanceTimersByTime(20)
      compose(editor, 'compositionstart')
      vi.advanceTimersByTime(100)
      editor.view.dispatch(editor.state.tr.insertText('**x**', editor.state.doc.content.size - 1))

      expect(editor.view.dom.querySelector('.composer-md-strong')).toBeNull()
    })
  })

  describe('pointer', () => {
    const pressPointer = (editor: Editor) =>
      editor.view.someProp('handleDOMEvents', (handlers) =>
        handlers.mousedown?.(editor.view, new MouseEvent('mousedown'))
      )

    it('defers reveal until the button is released', () => {
      const editor = createEditor('x **bold** y\nnext')
      caretAt(editor, 1)

      pressPointer(editor)
      caretAt(editor, 0, 5)
      expect(hiddenMarkers(editor)).toEqual(['**', '**'])

      window.dispatchEvent(new MouseEvent('mouseup'))
      expect(hiddenMarkers(editor)).toEqual([])
    })
  })

  describe('incremental updates', () => {
    it('leaves untouched lines in place when typing and moving the caret', () => {
      const editor = createEditor('**one**\ntwo\n# three\n> four')
      caretAt(editor, 1, 3)
      const before = [...editor.view.dom.children]

      editor.view.dispatch(editor.state.tr.insertText('!'))
      expect(lineElement(editor, 0)).toBe(before[0])
      expect(lineElement(editor, 2)).toBe(before[2])
      expect(lineElement(editor, 3)).toBe(before[3])

      caretAt(editor, 3, 1)
      expect(lineElement(editor, 0)).toBe(before[0])
      expect(lineElement(editor, 2)).toBe(before[2])
    })

    it('restyles lines outside the edit when the edit changes their meaning', () => {
      const editor = createEditor('*one\ntwo\nnext')
      expect(hiddenMarkers(editor)).toEqual([])

      caretAt(editor, 1, 3)
      editor.view.dispatch(editor.state.tr.insertText('*'))
      caretAt(editor, 2)

      expect(textsOf(editor, '.composer-md-emphasis')).toEqual(['one', 'two'])
    })

    it('keeps decorations when a whole-document replacement repeats the first line', () => {
      const editor = createEditor('**keep**\nold')

      editor.commands.setContent(createComposerDraftContent({ text: '**keep**\nnew', tokens: [] }))

      expect(textsOf(editor, '.composer-md-strong')).toEqual(['keep'])
    })

    it('restores styling on undo', () => {
      const editor = createEditor('caret\n**a**')
      caretAt(editor, 0)
      editor.commands.insertComposerLines(createComposerPlainTextContent('x'))

      editor.commands.undo()

      expect(textsOf(editor, '.composer-md-strong')).toEqual(['a'])
    })

    /** Every incremental result must equal what a fresh parse of the same document renders. */
    it('stays identical to a full rebuild across random edits', () => {
      const fragments = [
        '**b**',
        '*i*',
        '~~s~~',
        '`c`',
        '[l](u)',
        '# h',
        '> q',
        '- x',
        '1. y',
        'plain',
        '*',
        '**',
        '`',
        '>',
        '#'
      ]
      let seed = 20261109
      const random = (limit: number) => {
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed % limit
      }
      const editor = createEditor('start\n**bold** line\n> quote\n- item\n\n# heading')

      for (let step = 0; step < 400; step += 1) {
        const { doc } = editor.state
        const size = doc.content.size
        const randomSelection = () => TextSelection.near(doc.resolve(random(size + 1)))

        switch (random(6)) {
          case 0:
            editor.view.dispatch(editor.state.tr.setSelection(randomSelection()))
            break
          case 1:
            editor.view.dispatch(
              editor.state.tr.setSelection(randomSelection()).insertText(fragments[random(fragments.length)])
            )
            break
          case 2:
            editor.view.dispatch(editor.state.tr.setSelection(randomSelection()))
            editor.commands.splitComposerLine()
            break
          case 3: {
            const first = randomSelection()
            const last = randomSelection()
            const from = Math.min(first.from, last.from)
            const to = Math.max(first.to, last.to)
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)).deleteSelection())
            break
          }
          case 4:
            editor.view.dispatch(editor.state.tr.setSelection(randomSelection()))
            editor.commands.insertComposerLines(
              createComposerPlainTextContent(
                `${fragments[random(fragments.length)]}\n${fragments[random(fragments.length)]}`
              )
            )
            break
          default:
            editor.commands.undo()
        }

        const fresh = new Editor({
          element: document.createElement('div'),
          extensions: createComposerEditorPreset({ markdownLivePreview: true }),
          content: editor.getJSON() as JSONContent
        })
        fresh.view.dispatch(
          fresh.state.tr.setSelection(
            TextSelection.create(fresh.state.doc, editor.state.selection.from, editor.state.selection.to)
          )
        )

        expect(pluginDecorations(editor), `step ${step}: ${serializeComposerDocument(editor).text}`).toEqual(
          pluginDecorations(fresh)
        )
        fresh.destroy()
      }
    })
  })
})
