import { act, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import { useRichEditor } from '../useRichEditor'

const CONTENT = 'hello world'

// focus('end') dispatches a selection transaction even when jsdom cannot deliver real DOM focus,
// so the selection position is the reliable observable for the autoFocus gating.
const isSelectionAtEnd = (editor: Editor): boolean => editor.state.selection.eq(Selection.atEnd(editor.state.doc))

const flushFocusTimeout = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('useRichEditor autoFocus', () => {
  it('focuses the end of the document on mount by default', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: CONTENT }))
    await flushFocusTimeout()

    expect(result.current.editor.getText()).toBe(CONTENT)
    expect(isSelectionAtEnd(result.current.editor)).toBe(true)
  })

  it('leaves the selection at the start on mount when autoFocus is false', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: CONTENT, autoFocus: false }))
    await flushFocusTimeout()

    expect(result.current.editor.getText()).toBe(CONTENT)
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)
    expect(result.current.editor.state.selection.from).toBe(Selection.atStart(result.current.editor.state.doc).from)
  })

  it('refocuses the end when the editor becomes editable and autoFocus is enabled', async () => {
    const { result, rerender } = renderHook(({ editable }) => useRichEditor({ initialContent: CONTENT, editable }), {
      initialProps: { editable: false }
    })

    act(() => {
      result.current.editor.commands.setTextSelection(1)
    })
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(result.current.editor.isEditable).toBe(true)
    expect(isSelectionAtEnd(result.current.editor)).toBe(true)
  })

  it('keeps the selection when the editor becomes editable and autoFocus is false', async () => {
    const { result, rerender } = renderHook(
      ({ editable }) => useRichEditor({ initialContent: CONTENT, editable, autoFocus: false }),
      { initialProps: { editable: false } }
    )

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(result.current.editor.isEditable).toBe(true)
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)
  })
})
