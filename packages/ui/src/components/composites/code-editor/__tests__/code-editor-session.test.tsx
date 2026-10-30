// @vitest-environment jsdom
import { redo, undo } from '@codemirror/commands'
import { foldEffect, foldedRanges } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { codeBlockHighlightStyle } from '../../../../code-block'
import CodeEditor from '../code-editor'
import type { CodeEditorHandles, CodeEditorProps } from '../types'

describe('CodeEditor retained session', () => {
  it('retains the exact draft, selection and undo across palette changes and remounts with current save handlers', async () => {
    const original = 'const greeting = "你好 🥟";  \r\n\r\n'
    const expected = original + '// draft'
    const stateRef: NonNullable<CodeEditorProps['stateRef']> = { current: null }
    const handle: { current: CodeEditorHandles | null } = { current: null }
    const saves: { owner: string; value: string }[] = []
    const change: string[] = []
    const first = render(
      <CodeEditor
        ref={handle}
        value={original}
        stateRef={stateRef}
        language="ts"
        theme="light"
        syntaxHighlightStyle={codeBlockHighlightStyle}
        onChange={(value) => change.push(value)}
        onSave={(value) => saves.push({ owner: 'first', value })}
      />
    )
    await waitFor(() => expect(handle.current?.getContent?.()).toBe(original))
    const view = EditorView.findFromDOM(first.container.querySelector('.cm-editor')!)!
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '// draft' },
        selection: { anchor: view.state.doc.length + 3, head: view.state.doc.length + 8 }
      })
    )
    expect(change).toEqual([expected])
    expect(handle.current?.getSelection?.()?.text).toBe('draft')
    first.rerender(
      <CodeEditor
        ref={handle}
        value={expected}
        stateRef={stateRef}
        language="ts"
        theme="dark"
        syntaxHighlightStyle={codeBlockHighlightStyle}
        onChange={(value) => change.push(value)}
      />
    )
    await waitFor(() => expect(handle.current?.getContent?.()).toBe(expected))
    expect(change).toEqual([expected])
    first.unmount()
    const second = render(
      <CodeEditor
        ref={handle}
        value={expected}
        stateRef={stateRef}
        language="ts"
        theme="dark"
        syntaxHighlightStyle={codeBlockHighlightStyle}
        onSave={(value) => saves.push({ owner: 'second', value })}
      />
    )
    await waitFor(() => expect(handle.current?.getContent?.()).toBe(expected))
    expect(handle.current?.getSelection?.()?.text).toBe('draft')
    const restored = EditorView.findFromDOM(second.container.querySelector('.cm-editor')!)!
    act(() => {
      undo(restored)
    })
    expect(handle.current?.getContent?.()).toBe(original)
    act(() => {
      redo(restored)
    })
    expect(handle.current?.getContent?.()).toBe(expected)
    act(() => handle.current?.save?.())
    expect(saves).toEqual([{ owner: 'second', value: expected }])
  })

  it('restores folded source ranges with the retained document', async () => {
    const source = 'function greet() {\n  return "hello";\n}\n'
    const stateRef: NonNullable<CodeEditorProps['stateRef']> = { current: null }
    const props = {
      value: source,
      stateRef,
      language: 'ts',
      syntaxHighlightStyle: codeBlockHighlightStyle,
      options: { foldGutter: true }
    }
    const first = render(<CodeEditor {...props} />)
    await waitFor(() => expect(stateRef.current).not.toBeNull())
    const view = EditorView.findFromDOM(first.container.querySelector('.cm-editor')!)!
    const range = { from: source.indexOf('{') + 1, to: source.lastIndexOf('}') }
    act(() => view.dispatch({ effects: foldEffect.of(range) }))
    expect(foldedRanges(view.state).size).toBe(1)
    first.unmount()
    const second = render(<CodeEditor {...props} />)
    await waitFor(() => expect(foldedRanges(stateRef.current!).size).toBe(1))
    const restored = EditorView.findFromDOM(second.container.querySelector('.cm-editor')!)!
    const folded = foldedRanges(restored.state).iter()
    expect({ from: folded.from, to: folded.to }).toEqual(range)
    expect(restored.state.sliceDoc()).toBe(source)
  })

  it('publishes user edits without echoing an external replacement back as a user edit', async () => {
    const handle: { current: CodeEditorHandles | null } = { current: null }
    const emitted: string[] = []
    const onChange = (value: string) => emitted.push(value)
    const view = render(<CodeEditor ref={handle} value="old" language="text" onChange={onChange} />)
    await waitFor(() => expect(handle.current?.getContent?.()).toBe('old'))
    view.rerender(<CodeEditor ref={handle} value="replacement" language="text" onChange={onChange} />)
    await waitFor(() => expect(handle.current?.getContent?.()).toBe('replacement'))
    expect(emitted).toEqual([])
    const editor = EditorView.findFromDOM(view.container.querySelector('.cm-editor')!)!
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: ' user' } }))
    expect(emitted).toEqual(['replacement user'])
  })
})
