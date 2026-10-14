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

  it('reads the live selection and exposes the current draft immediately after edits', async () => {
    const editorRef: { current: RichEditorRef | null } = { current: null }
    render(<RichEditor ref={editorRef} initialContent="alpha beta" autoFocus={false} />)
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('alpha beta'))

    act(() => editorRef.current?.executeCommand('setTextSelection', { from: 7, to: 11 }))
    expect(editorRef.current?.getSelection()).toEqual({ from: 7, to: 11, text: 'beta' })

    act(() => {
      editorRef.current?.insertText('fresh')
      expect(editorRef.current?.getMarkdown()).toBe('alpha fresh')
    })
    expect(editorRef.current?.getSelection()).toEqual({ from: 12, to: 12, text: '' })
  })
})
