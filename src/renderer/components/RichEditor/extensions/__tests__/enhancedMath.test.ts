import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { EnhancedMath } from '../enhancedMath'

let editor: Editor | undefined

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const math = (latex: string): JSONContent => ({ type: 'inlineMath', attrs: { latex } })

function make(content: JSONContent[], position: number, inList = false): Editor {
  const paragraph = { type: 'paragraph', content }
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, EnhancedMath],
    content: {
      type: 'doc',
      content: inList ? [{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph] }] }] : [paragraph]
    }
  })
  editor.commands.setTextSelection(position)
  return editor
}

function typeText(instance: Editor, value: string) {
  for (const character of value) {
    const { from } = instance.state.selection
    const handled = instance.view.someProp('handleTextInput', (handler) =>
      handler(instance.view, from, from, character, () => instance.state.tr.insertText(character, from))
    )
    if (!handled) instance.view.dispatch(instance.state.tr.insertText(character, from))
  }
}

function inlineContent(instance: Editor): JSONContent[] {
  return instance.state.selection.$from.parent.toJSON().content ?? []
}

function mathContents(instance: Editor, type = 'inlineMath'): string[] {
  const values: string[] = []
  instance.state.doc.descendants((node) => {
    if (node.type.name === type) values.push(node.attrs.latex)
  })
  return values
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('inline math typing preserves adjacent content', () => {
  it('closes only the formula and inserts subsequent digits at the caret', () => {
    const instance = make([text('1234$a1234')], 7)

    typeText(instance, '$')

    expect.soft(inlineContent(instance)).toEqual([text('1234'), math('a'), text('1234')])
    expect.soft(mathContents(instance)).toEqual(['a'])
    expect.soft(instance.state.selection.from).toBe(6)

    typeText(instance, '9')
    typeText(instance, '8')

    expect(inlineContent(instance)).toEqual([text('1234'), math('a'), text('981234')])
    expect(mathContents(instance)).toEqual(['a'])
    expect(instance.state.selection.from).toBe(8)
  })

  it.each([
    { offset: 0, expected: '91234' },
    { offset: 2, expected: '12934' },
    { offset: 4, expected: '12349' }
  ])('inserts in trailing text at offset $offset without replacing the existing atom', ({ offset, expected }) => {
    const instance = make([text('1234'), math('a'), text('1234')], 6 + offset)

    typeText(instance, '9')

    expect(inlineContent(instance)).toEqual([text('1234'), math('a'), text(expected)])
    expect(mathContents(instance)).toEqual(['a'])
    expect(instance.state.selection.from).toBe(7 + offset)
  })

  it('does not rediscover an earlier literal formula when typing later prose', () => {
    const instance = make([text('x$a$1234')], 8)

    typeText(instance, '9')

    expect(inlineContent(instance)).toEqual([text('x$a$12394')])
    expect(mathContents(instance)).toEqual([])
    expect(instance.state.selection.from).toBe(9)
  })

  it('converts a second text-backed formula separated from an existing atom by a space', () => {
    const instance = make([text('1234'), math('a'), text(' $b')], 9)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([text('1234'), math('a'), text(' '), math('b')])
    expect(mathContents(instance)).toEqual(['a', 'b'])
    expect(instance.state.selection.from).toBe(8)
  })

  it('converts at paragraph start without consuming trailing prose', () => {
    const instance = make([text('$a1234')], 3)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([math('a'), text('1234')])
    expect(mathContents(instance)).toEqual(['a'])
    expect(instance.state.selection.from).toBe(2)
  })

  it('does not use an existing atom as the opening delimiter of a new formula', () => {
    const instance = make([text('1234'), math('a'), text('1234')], 10)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([text('1234'), math('a'), text('1234$')])
    expect(mathContents(instance)).toEqual(['a'])
    expect(instance.state.selection.from).toBe(11)
  })

  it('converts across marked text in a list while preserving outside text and marks', () => {
    const before = { ...text('left'), marks: [{ type: 'bold' }] }
    const after = { ...text('right'), marks: [{ type: 'italic' }] }
    const instance = make([before, text('$a'), { ...text('b'), marks: [{ type: 'bold' }] }, text('c'), after], 11, true)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([before, math('abc'), after])
    expect(mathContents(instance)).toEqual(['abc'])
    expect(instance.state.selection.from).toBe(8)
  })

  it('keeps an empty dollar pair literal', () => {
    const instance = make([text('$')], 2)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([text('$$')])
    expect(mathContents(instance)).toEqual([])
  })

  it('keeps double-dollar input literal until the unchanged block rule completes', () => {
    const instance = make([], 1)

    typeText(instance, '$$a$')

    expect(inlineContent(instance)).toEqual([text('$$a$')])
    expect(mathContents(instance)).toEqual([])

    typeText(instance, '$')

    expect(mathContents(instance, 'blockMath')).toEqual(['a'])
    expect(mathContents(instance)).toEqual([])
    expect(instance.state.doc.textContent).toBe('')
  })

  it('does not convert a formula across a literal newline', () => {
    const instance = make([text('$a\nb')], 5)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([text('$a\nb$')])
    expect(mathContents(instance)).toEqual([])
  })

  it('preserves a hard break and surrounding text inside dollar delimiters', () => {
    const instance = make([text('$a'), { type: 'hardBreak' }, text('b')], 5)

    typeText(instance, '$')

    expect(inlineContent(instance)).toEqual([text('$a'), { type: 'hardBreak' }, text('b$')])
    expect(mathContents(instance)).toEqual([])
  })

  it('undoes conversion without losing adjacent text or the typed closing delimiter', () => {
    const instance = make([text('1234$a1234')], 7)
    typeText(instance, '$')
    expect(inlineContent(instance)).toEqual([text('1234'), math('a'), text('1234')])

    instance.commands.undoInputRule()

    expect(inlineContent(instance)).toEqual([text('1234$a$1234')])
    expect(mathContents(instance)).toEqual([])
    expect(instance.state.selection.from).toBe(8)
  })
})
