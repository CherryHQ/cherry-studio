// @vitest-environment jsdom

import { EditorView } from '@codemirror/view'
import { act, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

describe('CodeEditor selection contract', () => {
  it('replaces the live selected range and keeps the controlled draft and caret in sync', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    const Harness = () => {
      const [value, setValue] = useState('alpha beta')
      return <CodeEditor ref={editorRef} value={value} language="markdown" onChange={setValue} />
    }
    const { container } = render(<Harness />)
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('alpha beta'))
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view).not.toBeNull()

    act(() => view!.dispatch({ selection: { anchor: 6, head: 10 } }))
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 6, to: 10, text: 'beta' })

    act(() => expect(editorRef.current?.replaceRange?.({ from: 6, to: 10 }, 'spoken')).toBe(true))
    expect(editorRef.current?.getContent?.()).toBe('alpha spoken')
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 12, to: 12, text: '' })
  })

  it('rejects an out of bounds range without changing content', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    render(<CodeEditor ref={editorRef} value="draft" language="markdown" />)
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('draft'))

    expect(editorRef.current?.replaceRange?.({ from: 0, to: 99 }, 'spoken')).toBe(false)
    expect(editorRef.current?.getContent?.()).toBe('draft')
  })
})
