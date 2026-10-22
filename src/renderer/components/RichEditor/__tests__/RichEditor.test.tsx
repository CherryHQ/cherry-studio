import { act, render, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '../types'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

describe('RichEditor accessibility', () => {
  it('restores an editable document after the containing tab hides and resumes', async () => {
    const view = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <RichEditor initialContent="retained document" autoFocus={false} />
      </Activity>
    )
    const { container, rerender } = render(view('visible'))
    await waitFor(() =>
      expect(container.querySelector('[contenteditable="true"]')).toHaveTextContent('retained document')
    )
    rerender(view('hidden'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    rerender(view('visible'))
    await waitFor(() =>
      expect(container.querySelector('[contenteditable="true"]')).toHaveTextContent('retained document')
    )
  })

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

it('loads Markdown without reporting a user edit, then still reports real editing', async () => {
  const editorRef: { current: RichEditorRef | null } = { current: null }
  const onMarkdownChange = vi.fn()
  const { container } = render(
    <RichEditor ref={editorRef} initialContent="ALPHA" autoFocus={false} onMarkdownChange={onMarkdownChange} />
  )
  await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('ALPHA'))

  act(() => editorRef.current?.setMarkdown('__BRAVO__'))
  expect(container.querySelector('[contenteditable="true"]')).toHaveTextContent('BRAVO')
  expect(onMarkdownChange).not.toHaveBeenCalled()

  act(() => container.querySelector<HTMLElement>('[contenteditable="true"]')?.focus())
  act(() => {
    editorRef.current?.insertText('changed')
  })
  await waitFor(() => expect(onMarkdownChange).toHaveBeenCalled())
  expect(onMarkdownChange.mock.lastCall?.[0]).toContain('changed')
})
