import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '../types'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

describe('RichEditor accessibility', () => {
  // Asserted on the attribute rather than through `getByRole('textbox', { name })`: ProseMirror
  // leaves the contenteditable without an explicit `role`, and giving every editor in the app one
  // changes how assistive tech navigates rich content — a separate decision from naming this one.
  it('names the editing surface for callers with no visible label', () => {
    const { container } = render(<RichEditor initialContent="" autoFocus={false} ariaLabel="Content" />)

    expect(container.querySelector('[contenteditable="true"]')).toHaveAttribute('aria-label', 'Content')
  })

  it('leaves the editing surface unnamed when no label is supplied', () => {
    const { container } = render(<RichEditor initialContent="" autoFocus={false} />)

    expect(container.querySelector('[contenteditable="true"]')).not.toHaveAttribute('aria-label')
  })

  it('reads and replaces the current TipTap selection, then moves the caret after inserted text', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    render(<RichEditor ref={editorRef} initialContent="alpha beta" autoFocus={false} />)
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('alpha beta'))

    act(() => editorRef.current?.executeCommand('setTextSelection', { from: 7, to: 11 }))
    expect(editorRef.current?.getSelection()).toEqual({ from: 7, to: 11, text: 'beta' })

    act(() => expect(editorRef.current?.replaceRange({ from: 7, to: 11 }, 'spoken')).toBe(true))
    expect(editorRef.current?.getMarkdown()).toBe('alpha spoken')
    expect(editorRef.current?.getSelection()).toEqual({ from: 13, to: 13, text: '' })
  })

  it('rejects an out of bounds TipTap range without touching the draft', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    render(<RichEditor ref={editorRef} initialContent="draft" autoFocus={false} />)
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('draft'))

    expect(editorRef.current?.replaceRange({ from: 1, to: 999 }, 'spoken')).toBe(false)
    expect(editorRef.current?.getMarkdown()).toBe('draft')
  })
})
