import { act, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('RichEditor silent Markdown synchronization', () => {
  it.each([false, true])(
    'loads changed and empty Markdown silently (focused: %s), then reports typing',
    async (focused) => {
      const editorRef: { current: RichEditorRef | null } = { current: null }
      const onChange = vi.fn()
      const onHtmlChange = vi.fn()
      const onContentChange = vi.fn()
      const user = userEvent.setup()
      const { getByLabelText } = render(
        <RichEditor
          ref={editorRef}
          initialContent="original"
          autoFocus={false}
          ariaLabel="Content"
          onMarkdownChange={onChange}
          onHtmlChange={onHtmlChange}
          onContentChange={onContentChange}
        />
      )
      await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('original'))
      const surface = getByLabelText('Content')
      if (focused) act(() => surface.focus())
      expect(document.activeElement === surface).toBe(focused)
      onChange.mockClear()
      onHtmlChange.mockClear()
      onContentChange.mockClear()

      act(() => editorRef.current?.setMarkdown('# A #'))
      expect(editorRef.current?.getMarkdown()).not.toBe('')
      expect(editorRef.current?.getMarkdown()).toContain('A')
      expect(surface.querySelector('h1')?.textContent).toBe('A')
      expect(surface.textContent).toBe('A')
      expect(onChange.mock.calls).toEqual([])
      expect(onHtmlChange.mock.calls).toEqual([])
      expect(onContentChange.mock.calls).toEqual([])

      act(() => editorRef.current?.setMarkdown(''))
      expect(editorRef.current?.getMarkdown()).toBe('')
      expect(surface.textContent).toBe('')
      expect(onChange.mock.calls).toEqual([])
      expect(onHtmlChange.mock.calls).toEqual([])
      expect(onContentChange.mock.calls).toEqual([])

      act(() => surface.focus())
      // jsdom has no Range layout; ProseMirror reads it when scrolling typed text into view.
      const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
      const originalBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
      Object.defineProperties(Range.prototype, {
        getClientRects: { configurable: true, value: () => [] },
        getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
      })
      try {
        await user.type(surface, 'typed', { skipClick: true })
      } finally {
        if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
        else Reflect.deleteProperty(Range.prototype, 'getClientRects')
        if (originalBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalBounds)
        else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
      }
      expect(editorRef.current?.getMarkdown()).toBe('typed')
      expect(onChange.mock.calls.at(-1)).toEqual(['typed'])
      expect(onContentChange.mock.calls.at(-1)).toEqual(['typed'])
      expect(onHtmlChange.mock.calls.at(-1)).toEqual(['<p>typed</p>'])
    }
  )
})
