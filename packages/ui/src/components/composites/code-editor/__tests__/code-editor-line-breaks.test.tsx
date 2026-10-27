// @vitest-environment jsdom
import { redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { codeBlockHighlightStyle } from '../../../../code-block'
import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

async function mount(value = 'a\r\nb', sharedSyntax = true) {
  const handle: { current: CodeEditorHandles | null } = { current: null }
  const changes: string[] = []
  const saved: string[] = []
  const props = {
    ref: handle,
    value,
    language: 'text',
    syntaxHighlightStyle: sharedSyntax ? codeBlockHighlightStyle : undefined,
    onChange: (source: string) => changes.push(source),
    onSave: (source: string) => saved.push(source)
  }
  const host = render(<CodeEditor {...props} />)
  await waitFor(() => expect(handle.current?.getContent?.()).toBe(value))
  const view = EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
  act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
  return { ...host, props, handle, view, changes, saved }
}

describe('CodeEditor line-break boundaries', () => {
  // A different clipboard separator must not embed raw newlines inside a logical line.
  it.each([
    { separator: '\r\n', pasted: '\nc\rd', sharedSyntax: true },
    { separator: '\n', pasted: '\r\nc\r\nd', sharedSyntax: true },
    { separator: '\r\n', pasted: '\nc\rd', sharedSyntax: false },
    { separator: '\n', pasted: '\r\nc\r\nd', sharedSyntax: false }
  ])(
    'normalizes $separator clipboard input (shared syntax: $sharedSyntax)',
    async ({ separator, pasted, sharedSyntax }) => {
      const { view, handle, changes, saved } = await mount(`a${separator}b`, sharedSyntax)
      act(() => {
        fireEvent.paste(view.contentDOM, { clipboardData: { getData: () => pasted } })
      })
      expect(view.state.doc.toString()).toBe('a\nb\nc\nd')
      expect(view.state.doc.lines).toBe(4)
      expect(handle.current?.getSelection?.()).toEqual({ from: 7, to: 7, text: '' })
      const expected = ['a', 'b', 'c', 'd'].join(separator)
      expect(changes).toEqual([expected])
      act(() => handle.current?.save?.())
      expect(saved).toEqual([expected])
      act(() => {
        undo(view)
      })
      expect(handle.current?.getContent?.()).toBe(`a${separator}b`)
      act(() => {
        redo(view)
      })
      expect(handle.current?.getContent?.()).toBe(expected)
    }
  )

  it('normalizes imperative insertion without embedding raw newlines in a line', async () => {
    const { view, handle } = await mount()
    act(() => {
      expect(handle.current?.insertText?.('\nc\rd\r\ne')).toBe(true)
    })
    expect(view.state.doc.toString()).toBe('a\nb\nc\nd\ne')
    expect(view.state.doc.lines).toBe(5)
    expect(handle.current?.getSelection?.()).toEqual({ from: 9, to: 9, text: '' })
    expect(handle.current?.getContent?.()).toBe('a\r\nb\r\nc\r\nd\r\ne')
  })

  it('places the replacement caret in document coordinates and retains undo and serialization', async () => {
    const { view, handle } = await mount()
    act(() => {
      expect(handle.current?.replaceRange?.({ from: 0, to: 1 }, 'x\r\ny\nz')).toBe(true)
    })
    expect(view.state.doc.toString()).toBe('x\ny\nz\nb')
    expect(view.state.doc.lines).toBe(4)
    expect(handle.current?.getSelection?.()).toEqual({ from: 5, to: 5, text: '' })
    expect(handle.current?.getContent?.()).toBe('x\r\ny\r\nz\r\nb')
    act(() => {
      undo(view)
    })
    expect(handle.current?.getContent?.()).toBe('a\r\nb')
    act(() => {
      redo(view)
    })
    expect(handle.current?.getContent?.()).toBe('x\r\ny\r\nz\r\nb')
  })

  it('keeps line endings, selection and history independent of syntax styling', async () => {
    const { view, handle, rerender, props } = await mount()
    act(() => {
      handle.current?.insertText?.(' draft')
    })
    const selection = handle.current?.getSelection?.()
    rerender(<CodeEditor {...props} value={'a\r\nb draft'} syntaxHighlightStyle={undefined} />)
    expect(handle.current?.getContent?.()).toBe('a\r\nb draft')
    expect(handle.current?.getSelection?.()).toEqual(selection)
    act(() => {
      undo(view)
    })
    expect(handle.current?.getContent?.()).toBe('a\r\nb')
  })
})
