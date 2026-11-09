import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { codeHighlightService } from '@renderer/services/CodeHighlightService'

import { createComposerDraftContent, serializeComposerDocument } from '../../composerDraft'
import { createComposerEditorPreset } from '../../composerPreset'
import { handleMarkdownCodeKey } from '../codeBlockKeys'
import { isMarkdownFencedCodePosition } from '../livePreviewPlugin'

const editors: Editor[] = []

function createEditor(text: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createComposerEditorPreset({ markdownLivePreview: true }),
    content: createComposerDraftContent({ text, tokens: [] }, { tokenizeVariables: false })
  })
  editors.push(editor)
  return editor
}

const source = (editor: Editor) => serializeComposerDocument(editor.getJSON()).text
const lineStart = (editor: Editor, line: number) => {
  let position = 1
  editor.state.doc.forEach((_block, offset, index) => {
    if (index === line) position = offset + 1
  })
  return position
}
const caretAt = (editor: Editor, line: number, column = 0) =>
  editor.commands.setTextSelection(lineStart(editor, line) + column)
const selectLines = (editor: Editor, from: [number, number], to: [number, number]) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, lineStart(editor, from[0]) + from[1], lineStart(editor, to[0]) + to[1])
    )
  )
/** Line and column of the caret, so the assertions read like the source text. */
const caret = (editor: Editor) => {
  const { $from } = editor.state.selection
  return [$from.index(0), $from.parentOffset]
}

const lineClasses = (editor: Editor) =>
  [...editor.view.dom.children].map((element) =>
    element.classList.contains('composer-md-line-hidden')
      ? 'hidden'
      : element.classList.contains('composer-md-cb-line')
        ? 'code'
        : 'plain'
  )
const lineElement = (editor: Editor, index: number) => editor.view.dom.children[index]
const coloredText = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.code-syntax-keyword')].map((element) => element.textContent)

const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  handleMarkdownCodeKey(editor.view, new KeyboardEvent('keydown', { key, ...init }))

/** Colors the first word of every line, the way the worker reports tokens. */
function highlightFirstWords(code: string) {
  return {
    lines: code.split('\n').map((line) => {
      const word = /^\s*(\S+)/.exec(line)
      return word
        ? [{ content: word[1], className: 'code-syntax-keyword', offset: word[0].length - word[1].length }]
        : []
    })
  }
}

const flushHighlight = () => vi.waitFor(() => expect(highlightRange.mock.results.length).toBeGreaterThan(0))
const settle = async () => {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

const highlightRange = vi.spyOn(codeHighlightService, 'highlightRange')
const cleanupTokenizers = vi.spyOn(codeHighlightService, 'cleanupTokenizers')

beforeEach(() => {
  highlightRange.mockReset()
  highlightRange.mockImplementation(async (code) => highlightFirstWords(code) as never)
  cleanupTokenizers.mockReset()
})

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('fenced code regions', () => {
  it('renders one region across blank lines and hides the fences while the caret is outside', () => {
    const editor = createEditor('before\n```ts\nconst a\n\nlet b\n```\nafter')
    caretAt(editor, 0)

    expect(lineClasses(editor)).toEqual(['plain', 'hidden', 'code', 'code', 'code', 'hidden', 'plain'])
    expect(lineElement(editor, 2).className).toContain('composer-md-cb-first')
    expect(lineElement(editor, 2).getAttribute('data-language')).toBe('ts')
    expect(lineElement(editor, 4).className).toContain('composer-md-cb-last')
  })

  it('reveals the fences while the caret is anywhere in the block', () => {
    const editor = createEditor('before\n```ts\nconst a\n```\nafter')
    caretAt(editor, 2, 3)

    expect(lineClasses(editor)).toEqual(['plain', 'code', 'code', 'code', 'plain'])
    expect(lineElement(editor, 1).getAttribute('data-language')).toBe('ts')
    expect(lineElement(editor, 3).className).toContain('composer-md-cb-last')

    caretAt(editor, 4)
    expect(lineClasses(editor)).toEqual(['plain', 'hidden', 'code', 'hidden', 'plain'])
  })

  it('reveals the fences when a selection reaches into the block', () => {
    const editor = createEditor('before\n```\ncode\n```\nafter')
    selectLines(editor, [0, 1], [2, 2])

    expect(lineClasses(editor)).toEqual(['plain', 'code', 'code', 'code', 'plain'])
  })

  it('runs an unterminated block to the end of the draft', () => {
    const editor = createEditor('before\n```\ncode\nmore')
    caretAt(editor, 0)

    expect(lineClasses(editor)).toEqual(['plain', 'hidden', 'code', 'code'])
    expect(lineElement(editor, 3).className).toContain('composer-md-cb-last')
  })

  it.each([
    ['a tilde line inside a backtick block', '```\ncode\n~~~'],
    ['a shorter backtick line inside a longer fence', '````\ncode\n```']
  ])('keeps %s as code instead of closing the block', (_name, text) => {
    const editor = createEditor(`before\n${text}`)
    caretAt(editor, 0)

    expect(lineClasses(editor)).toEqual(['plain', 'hidden', 'code', 'code'])
  })

  it('keeps a block with no code visible even with the caret outside', () => {
    const editor = createEditor('before\n```\n```\nafter')
    caretAt(editor, 0)

    expect(lineClasses(editor)).toEqual(['plain', 'code', 'code', 'plain'])
  })

  it('leaves Markdown inside the block as literal source', () => {
    const editor = createEditor('```\n**bold** [l](u)\n```\nafter')
    caretAt(editor, 3)

    expect(editor.view.dom.querySelector('.composer-md-strong')).toBeNull()
    expect(editor.view.dom.querySelector('.composer-md-link')).toBeNull()
  })

  it('treats four-space indentation as ordinary text', () => {
    const editor = createEditor('intro\n\n    indented code\n    more')
    caretAt(editor, 2, 6)

    expect(lineClasses(editor)).toEqual(['plain', 'plain', 'plain', 'plain'])
    expect(isMarkdownFencedCodePosition(editor.state, editor.state.selection.from)).toBe(false)
    expect(press(editor, 'Enter')).toBe(false)
    expect(press(editor, 'Tab')).toBe(false)
  })

  it('answers from the current document while composition defers the parse', () => {
    const editor = createEditor('plain\ncode')
    const codePosition = () => lineStart(editor, 1) + 1
    expect(isMarkdownFencedCodePosition(editor.state, codePosition())).toBe(false)

    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    editor.view.dispatch(editor.state.tr.insertText('```', 1, 6))

    expect(isMarkdownFencedCodePosition(editor.state, codePosition())).toBe(true)
  })
})

describe('code highlighting', () => {
  it('colors each block through the highlight service with its own language', async () => {
    const editor = createEditor('```ts\nconst a\n\n  let b\n```\ntext\n```\nplain code\n```')
    await flushHighlight()

    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['const', 'let', 'plain']))
    expect(highlightRange.mock.calls.map(([code, language]) => [code, language])).toEqual([
      ['const a\n\n  let b', 'ts'],
      ['plain code', 'text']
    ])
  })

  it('removes colors when the text stops being code', async () => {
    const editor = createEditor('```js\nconst a')
    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['const']))

    editor.view.dispatch(editor.state.tr.delete(1, 2))

    await vi.waitFor(() => expect(coloredText(editor)).toEqual([]))
  })

  it('restores colors after a whole-document replace with identical code', async () => {
    const text = '```js\nconst a\n```'
    const editor = createEditor(text)
    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['const']))

    editor.commands.setContent(createComposerDraftContent({ text, tokens: [] }, { tokenizeVariables: false }))

    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['const']))
  })

  it('never paints a superseded result over newer code', async () => {
    const resolvers: Array<() => void> = []
    highlightRange.mockImplementation(
      (code) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(highlightFirstWords(code) as never))
        })
    )
    const editor = createEditor('```js\nconst a\n```')
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))

    editor.view.dispatch(editor.state.tr.insertText('let ', lineStart(editor, 1)))
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))

    resolvers[0]()
    await settle()
    expect(coloredText(editor)).toEqual([])

    resolvers[1]()
    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['let']))
  })

  it('keeps editing usable when the highlight service fails', async () => {
    highlightRange.mockRejectedValueOnce(new Error('worker crashed'))
    const editor = createEditor('```js\nconst a\n```')
    await flushHighlight()
    await settle()
    expect(coloredText(editor)).toEqual([])

    editor.view.dispatch(editor.state.tr.insertText('x', lineStart(editor, 1)))

    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['xconst']))
  })

  it('does not color code nested in a quote, whose columns include the quote prefix', async () => {
    const editor = createEditor('> ```js\n> const a\n> ```\n\n```js\nlet b\n```')

    await vi.waitFor(() => expect(coloredText(editor)).toEqual(['let']))
    expect(highlightRange).toHaveBeenCalledTimes(1)
  })

  it('releases its tokenizers and ignores late results once the editor is gone', async () => {
    let resolveLate: () => void = () => {}
    highlightRange.mockImplementation(
      (code) =>
        new Promise((resolve) => {
          resolveLate = () => resolve(highlightFirstWords(code) as never)
        })
    )
    const editor = createEditor('```js\nconst a\n```')
    await flushHighlight()
    const dispatch = vi.spyOn(editor.view, 'dispatch')

    editor.destroy()
    editors.pop()
    resolveLate()
    await settle()

    expect(cleanupTokenizers).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('code block keys', () => {
  it.each([
    ['Enter', {}],
    ['Enter', { shiftKey: true }],
    ['Enter', { ctrlKey: true }],
    ['Enter', { metaKey: true }],
    ['Enter', { altKey: true }],
    ['NumpadEnter', {}]
  ])('inserts a newline for %s %j', (key, init) => {
    const editor = createEditor('```\nab\n```')
    caretAt(editor, 1, 1)

    expect(press(editor, key, init)).toBe(true)
    expect(source(editor)).toBe('```\na\nb\n```')
    expect(caret(editor)).toEqual([2, 0])
  })

  it('replaces a selection with the newline', () => {
    const editor = createEditor('```\nabcd\n```')
    selectLines(editor, [1, 1], [1, 3])

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\na\nd\n```')
  })

  it('keeps the line indentation', () => {
    const editor = createEditor('```\n    foo\n```')
    caretAt(editor, 1, 7)

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\n    foo\n    \n```')
    expect(caret(editor)).toEqual([2, 4])
  })

  it.each(['{', '[', '('])('adds one level after an opening %s', (bracket) => {
    const editor = createEditor(`\`\`\`\n  a ${bracket}\n\`\`\``)
    caretAt(editor, 1, 5)

    press(editor, 'Enter')

    expect(source(editor)).toBe(`\`\`\`\n  a ${bracket}\n    \n\`\`\``)
    expect(caret(editor)).toEqual([2, 4])
  })

  it('closes an unterminated opening fence and leaves the caret between the fences', () => {
    const editor = createEditor('intro\n```js')
    caretAt(editor, 1, 5)

    press(editor, 'Enter')

    expect(source(editor)).toBe('intro\n```js\n\n```')
    expect(caret(editor)).toEqual([2, 0])
  })

  it.each([
    ['code', '```js\ncode\n```', '```js\n\ncode\n```'],
    ['no code', '```js\n```', '```js\n\n```']
  ])('does not add a second closing fence to a closed block with %s', (_name, text, expected) => {
    const editor = createEditor(text)
    caretAt(editor, 0, 5)

    press(editor, 'Enter')

    expect(source(editor)).toBe(expected)
    expect(caret(editor)).toEqual([1, 0])
  })

  it.each([0, 1, 3])('moves below the block from column %i of the closing fence', (column) => {
    const editor = createEditor('```\na\n```\nafter')
    caretAt(editor, 2, column)

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\na\n```\n\nafter')
    expect(caret(editor)).toEqual([3, 0])
  })

  it('leaves Enter to the composer outside a block', () => {
    const editor = createEditor('plain\n```\na\n```\nafter')
    caretAt(editor, 4, 2)

    expect(press(editor, 'Enter')).toBe(false)
    expect(source(editor)).toBe('plain\n```\na\n```\nafter')
  })

  it('leaves keys to the input method during composition', () => {
    const editor = createEditor('```\nab\n```')
    caretAt(editor, 1, 1)

    expect(press(editor, 'Enter', { isComposing: true })).toBe(false)
    expect(source(editor)).toBe('```\nab\n```')
  })

  it('indents at the caret with Tab', () => {
    const editor = createEditor('```\nfoo\n```')
    caretAt(editor, 1, 1)

    expect(press(editor, 'Tab')).toBe(true)
    expect(source(editor)).toBe('```\nf  oo\n```')
    expect(caret(editor)).toEqual([1, 3])
  })

  it('outdents the caret line by up to one level with Shift+Tab', () => {
    const editor = createEditor('```\n   foo\n bar\nbaz\n```')

    caretAt(editor, 1, 4)
    expect(press(editor, 'Tab', { shiftKey: true })).toBe(true)
    caretAt(editor, 2, 2)
    press(editor, 'Tab', { shiftKey: true })
    caretAt(editor, 3, 1)
    expect(press(editor, 'Tab', { shiftKey: true })).toBe(true)

    expect(source(editor)).toBe('```\n foo\nbar\nbaz\n```')
  })

  it('indents and outdents every selected line', () => {
    const editor = createEditor('```\na\n  b\n\nc\n```')
    selectLines(editor, [1, 0], [4, 1])

    press(editor, 'Tab')
    expect(source(editor)).toBe('```\n  a\n    b\n  \n  c\n```')

    press(editor, 'Tab', { shiftKey: true })
    expect(source(editor)).toBe('```\na\n  b\n\nc\n```')
  })

  it('stops indenting at the end of the block', () => {
    const editor = createEditor('```\na\n```\nplain')
    selectLines(editor, [1, 0], [3, 2])

    press(editor, 'Tab')

    expect(source(editor)).toBe('```\n  a\n  ```\nplain')
  })

  it('leaves Tab to the composer outside a block', () => {
    const editor = createEditor('plain')
    caretAt(editor, 0, 2)

    expect(press(editor, 'Tab')).toBe(false)
    expect(source(editor)).toBe('plain')
  })
})

describe('Enter between a bracket pair', () => {
  it.each([
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ])('moves %s%s apart with the caret on an indented middle line', (open, close) => {
    const editor = createEditor(`\`\`\`\n  ${open}${close}\n\`\`\``)
    caretAt(editor, 1, 3)

    press(editor, 'Enter')

    expect(source(editor)).toBe(`\`\`\`\n  ${open}\n    \n  ${close}\n\`\`\``)
    expect(caret(editor)).toEqual([2, 4])
  })

  it('leaves a closing bracket at column zero when the line has no indentation', () => {
    const editor = createEditor('```\nf() {}\n```')
    caretAt(editor, 1, 5)

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\nf() {\n  \n}\n```')
    expect(caret(editor)).toEqual([2, 2])
  })

  it('keeps text after the closing bracket on the third line', () => {
    const editor = createEditor('```\nfoo({});\n```')
    caretAt(editor, 1, 5)

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\nfoo({\n  \n});\n```')
  })

  it('does not split brackets of different kinds', () => {
    const editor = createEditor('```\n{]\n```')
    caretAt(editor, 1, 1)

    press(editor, 'Enter')

    expect(source(editor)).toBe('```\n{\n  ]\n```')
  })
})

describe('code block bracket pairing', () => {
  function inputCharacter(editor: Editor, character: string) {
    const { from, to } = editor.state.selection
    const insert = () => editor.state.tr.insertText(character, from, to)
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, character, insert)
    )
    if (!handled) editor.view.dispatch(insert())
  }
  const typeText = (editor: Editor, text: string) => {
    for (const character of text) inputCharacter(editor, character)
  }
  const backspace = (editor: Editor) =>
    Boolean(
      editor.view.someProp('handleKeyDown', (handler) =>
        handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' }))
      )
    )
  const inCodeLine = (text: string) => `\`\`\`\n${text}\n\`\`\``
  const selectedText = (editor: Editor) =>
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')

  function createCodeEditor(text = '', column = 0) {
    const editor = createEditor(inCodeLine(text))
    caretAt(editor, 1, column)
    return editor
  }

  it.each([
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"]
  ])('adds the closer for %s and leaves the caret between', (open, close) => {
    const editor = createCodeEditor()

    typeText(editor, open)

    expect(source(editor)).toBe(inCodeLine(open + close))
    expect(caret(editor)).toEqual([1, 1])
  })

  it.each([
    ['a word follows', 'abc', 0, '(', '(abc'],
    ['a quote follows a word', 'don', 3, "'", "don'"],
    ['a quote is typed before a word', 'abc', 0, '"', '"abc']
  ])('does not pair when %s', (_name, text, column, character, expected) => {
    const editor = createCodeEditor(text, column)

    typeText(editor, character)

    expect(source(editor)).toBe(inCodeLine(expected))
  })

  it.each([
    ['whitespace', ' abc', '() abc'],
    ['a closing bracket', ')', '())'],
    ['a semicolon', ';', '();'],
    ['a comma', ',', '(),']
  ])('pairs before %s', (_name, text, expected) => {
    const editor = createCodeEditor(text)

    typeText(editor, '(')

    expect(source(editor)).toBe(inCodeLine(expected))
  })

  it('steps over closers it inserted', () => {
    const editor = createCodeEditor()

    typeText(editor, '{[a]}')

    expect(source(editor)).toBe(inCodeLine('{[a]}'))
    expect(caret(editor)).toEqual([1, 5])
  })

  it('types a closer it did not insert', () => {
    const editor = createCodeEditor('()', 1)

    typeText(editor, ')')

    expect(source(editor)).toBe(inCodeLine('())'))
  })

  it('forgets its closers once the caret leaves the line', () => {
    const editor = createCodeEditor()
    typeText(editor, '(')

    caretAt(editor, 0)
    caretAt(editor, 1, 1)
    typeText(editor, ')')

    expect(source(editor)).toBe(inCodeLine('())'))
  })

  it('deletes an empty pair it inserted with Backspace', () => {
    const editor = createCodeEditor()
    typeText(editor, '(')

    expect(backspace(editor)).toBe(true)

    expect(source(editor)).toBe(inCodeLine(''))
    expect(caret(editor)).toEqual([1, 0])
  })

  it('leaves Backspace alone once the pair has content', () => {
    const editor = createCodeEditor()
    typeText(editor, '(a')

    expect(backspace(editor)).toBe(false)
  })

  it('leaves Backspace alone in a pair it did not insert', () => {
    const editor = createCodeEditor('()', 1)

    expect(backspace(editor)).toBe(false)
  })

  it('undoes the opener and closer together', () => {
    const editor = createCodeEditor()
    typeText(editor, '(')

    editor.commands.undo()

    expect(source(editor)).toBe(inCodeLine(''))
  })

  it.each([
    ['(', '(abc)'],
    ['"', '"abc"']
  ])('wraps a selection in %s and keeps it selected', (character, expected) => {
    const editor = createCodeEditor('abc')
    selectLines(editor, [1, 0], [1, 3])

    typeText(editor, character)

    expect(source(editor)).toBe(inCodeLine(expected))
    expect(selectedText(editor)).toBe('abc')
  })

  it('wraps a selection across code lines', () => {
    const editor = createEditor('```\na\nb\n```')
    selectLines(editor, [1, 0], [2, 1])

    typeText(editor, '[')

    expect(source(editor)).toBe('```\n[a\nb]\n```')
  })

  it('replaces a selection that reaches outside the block', () => {
    const editor = createEditor('```\nabc\n```\nplain')
    selectLines(editor, [1, 1], [3, 2])

    typeText(editor, '(')

    expect(source(editor)).toBe('```\na(ain')
  })

  it('leaves backticks unpaired', () => {
    const editor = createCodeEditor()

    typeText(editor, '`')

    expect(source(editor)).toBe(inCodeLine('`'))
  })

  it('leaves fence lines alone', () => {
    const editor = createEditor('```\ncode\n```')
    caretAt(editor, 0, 3)

    typeText(editor, '{')

    expect(source(editor)).toBe('```{\ncode\n```')
  })

  it.each([
    ['plain text', 'plain', 0, 5],
    ['a four-space line', 'intro\n\n    code', 2, 8]
  ])('does not pair in %s', (_name, text, line, column) => {
    const editor = createEditor(text)
    caretAt(editor, line, column)

    typeText(editor, '(')

    expect(source(editor).match(/\)/g)).toBeNull()
  })

  it('leaves input to the input method during composition', () => {
    const editor = createCodeEditor()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))

    typeText(editor, '(')

    expect(source(editor)).toBe(inCodeLine('('))
  })
})
