// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

afterEach(cleanup)

describe('CodeEditor range replacement', () => {
  it('inserts at an empty document caret', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    render(<CodeEditor ref={editorRef} value="" language="markdown" />)
    await waitFor(() => expect(editorRef.current?.getSelection?.()).toEqual({ from: 0, to: 0, text: '' }))

    act(() => {
      expect(editorRef.current?.replaceRange?.({ from: 0, to: 0 }, 'first words')).toBe(true)
    })
    expect(editorRef.current?.getContent?.()).toBe('first words')
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 11, to: 11, text: '' })
  })

  it('replaces the supplied range, moves the caret, and preserves change notifications and undo', async () => {
    const user = userEvent.setup()
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    const changes: string[] = []
    render(
      <CodeEditor
        ref={editorRef}
        value="alpha beta"
        language="markdown"
        onChange={(content) => changes.push(content)}
      />
    )
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('alpha beta'))

    act(() => {
      expect(editorRef.current?.replaceRange?.({ from: 6, to: 10 }, '<b>hello</b> **world**\nnext')).toBe(true)
    })

    expect(editorRef.current?.getContent?.()).toBe('alpha <b>hello</b> **world**\nnext')
    expect(editorRef.current?.getSelection?.()).toEqual({ from: 33, to: 33, text: '' })
    expect(changes).toEqual(['alpha <b>hello</b> **world**\nnext'])
    expect(screen.getByRole('textbox')).toBe(document.activeElement)

    await user.keyboard('{Control>}z{/Control}')
    expect(editorRef.current?.getContent?.()).toBe('alpha beta')
    expect(changes).toEqual(['alpha <b>hello</b> **world**\nnext', 'alpha beta'])
  })

  it('rejects invalid ranges without modifying the document or notifying consumers', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    const changes: string[] = []
    render(
      <CodeEditor ref={editorRef} value="alpha" language="markdown" onChange={(content) => changes.push(content)} />
    )
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('alpha'))

    for (const range of [
      { from: -1, to: 1 },
      { from: 4, to: 2 },
      { from: 0, to: 6 },
      { from: 1.5, to: 2 },
      { from: 0, to: Number.NaN }
    ]) {
      expect(editorRef.current?.replaceRange?.(range, 'replacement')).toBe(false)
    }
    expect(editorRef.current?.getContent?.()).toBe('alpha')
    expect(changes).toEqual([])
  })

  it('rejects disabled, read-only and unmounted editors', async () => {
    const editorRef: { current: CodeEditorHandles | null } = { current: null }
    const { rerender, unmount } = render(<CodeEditor ref={editorRef} value="alpha" language="markdown" />)
    await waitFor(() => expect(editorRef.current?.getContent?.()).toBe('alpha'))

    rerender(<CodeEditor ref={editorRef} value="alpha" language="markdown" editable={false} />)
    expect(editorRef.current?.replaceRange?.({ from: 0, to: 5 }, 'replacement')).toBe(false)
    expect(editorRef.current?.getContent?.()).toBe('alpha')

    rerender(<CodeEditor ref={editorRef} value="alpha" language="markdown" readOnly />)
    expect(editorRef.current?.replaceRange?.({ from: 0, to: 5 }, 'replacement')).toBe(false)
    expect(editorRef.current?.getContent?.()).toBe('alpha')

    rerender(<CodeEditor ref={editorRef} value="alpha" language="markdown" />)
    const staleEditor = editorRef.current!
    unmount()
    expect(staleEditor.replaceRange?.({ from: 0, to: 5 }, 'replacement')).toBe(false)
  })
})
