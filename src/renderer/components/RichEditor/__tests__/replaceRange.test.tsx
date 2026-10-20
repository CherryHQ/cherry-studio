import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '../types'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

describe('RichEditor range replacement', () => {
  it('inserts at an empty document caret', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    render(<RichEditor ref={editorRef} autoFocus={false} showToolbar={false} />)
    await waitFor(() => expect(editorRef.current?.getSelection()).toEqual({ from: 1, to: 1, text: '' }))

    act(() => {
      expect(editorRef.current?.replaceRange?.({ from: 1, to: 1 }, 'first words')).toBe(true)
    })
    expect(editorRef.current?.getContent()).toBe('first words')
    expect(editorRef.current?.getSelection()).toEqual({ from: 12, to: 12, text: '' })
  })

  it('replaces the supplied range with literal text, moves the caret, and preserves undo', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    const changes: string[] = []
    render(
      <RichEditor
        ref={editorRef}
        initialContent="alpha beta"
        autoFocus={false}
        ariaLabel="Content"
        showToolbar={false}
        onContentChange={(content) => changes.push(content)}
      />
    )
    await waitFor(() => expect(editorRef.current?.getContent()).toBe('alpha beta'))
    act(() => editorRef.current?.executeCommand('setTextSelection', 1))

    act(() => {
      expect(editorRef.current?.replaceRange?.({ from: 7, to: 11 }, '<b>hello</b> **world**\nnext')).toBe(true)
    })

    expect(editorRef.current?.getContent()).toBe('alpha <b>hello</b> **world**\nnext')
    expect(editorRef.current?.getSelection()).toEqual({ from: 34, to: 34, text: '' })
    expect(changes).toEqual(['alpha <b>hello</b> **world**\nnext'])
    expect(screen.getByLabelText('Content')).toHaveFocus()

    act(() => editorRef.current?.executeCommand('undo'))
    expect(editorRef.current?.getContent()).toBe('alpha beta')
    expect(changes).toEqual(['alpha <b>hello</b> **world**\nnext', 'alpha beta'])
  })

  it('rejects invalid ranges without modifying the document or notifying consumers', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    const changes: string[] = []
    render(
      <RichEditor
        ref={editorRef}
        initialContent="alpha"
        autoFocus={false}
        showToolbar={false}
        onContentChange={(content) => changes.push(content)}
      />
    )
    await waitFor(() => expect(editorRef.current?.getContent()).toBe('alpha'))

    for (const range of [
      { from: -1, to: 1 },
      { from: 4, to: 2 },
      { from: 1, to: 100 },
      { from: 1.5, to: 2 },
      { from: 1, to: Number.NaN }
    ]) {
      expect(editorRef.current?.replaceRange?.(range, 'replacement')).toBe(false)
    }
    expect(editorRef.current?.getContent()).toBe('alpha')
    expect(changes).toEqual([])
  })

  it('rejects read-only and destroyed editors', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    const { rerender, unmount } = render(
      <RichEditor ref={editorRef} initialContent="alpha" autoFocus={false} showToolbar={false} />
    )
    await waitFor(() => expect(editorRef.current?.getContent()).toBe('alpha'))

    rerender(
      <RichEditor ref={editorRef} initialContent="alpha" autoFocus={false} showToolbar={false} editable={false} />
    )
    expect(editorRef.current?.replaceRange?.({ from: 1, to: 6 }, 'replacement')).toBe(false)
    expect(editorRef.current?.getContent()).toBe('alpha')

    rerender(<RichEditor ref={editorRef} initialContent="alpha" autoFocus={false} showToolbar={false} />)
    const staleEditor = editorRef.current!
    unmount()
    await waitFor(() => expect(staleEditor.replaceRange?.({ from: 1, to: 6 }, 'replacement')).toBe(false))
  })
})
