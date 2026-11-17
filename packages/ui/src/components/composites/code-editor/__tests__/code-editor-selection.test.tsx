// @vitest-environment jsdom

import { EditorView } from '@codemirror/view'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

describe('CodeEditor selection contract', () => {
  it('reads the live selected text and reports an empty selection at the caret', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    const { container } = render(<CodeEditor ref={editorRef} value="alpha beta" language="markdown" />)
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('alpha beta'))
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view).not.toBeNull()

    act(() => view!.dispatch({ selection: { anchor: 6, head: 10 } }))
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 6, to: 10, text: 'beta' })

    act(() => view!.dispatch({ selection: { anchor: 6 } }))
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 6, to: 6, text: '' })
    expect(editorRef.current?.getContent?.()).toBe('alpha beta')
  })
})
