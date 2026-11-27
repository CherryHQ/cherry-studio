import { act, cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, it, expect, vi } from 'vitest'

import type { RichEditorRef } from '../types'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCodeTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
})
afterEach(() => {
  cleanup()
  if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  if (originalBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

const flushFocus = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

it.each(['mount', 'editable'] as const)(
  'preserves an active rename input when the editor becomes %s',
  async (phase) => {
    const user = userEvent.setup()
    const editorRef: { current: RichEditorRef | null } = { current: null }
    const view = (ready: boolean) => (
      <>
        <input aria-label="Note name" defaultValue="Draft" />
        {(ready || phase === 'editable') && (
          <RichEditor ref={editorRef} initialContent="Note body" editable={ready} showToolbar={false} />
        )}
      </>
    )
    const { getByRole, rerender } = render(view(false))
    if (phase === 'editable') {
      await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('Note body'))
      await flushFocus()
    }
    const name = getByRole('textbox', { name: 'Note name' })
    await user.click(name)
    rerender(view(true))
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('Note body'))
    await flushFocus()
    expect(name).toHaveFocus()
    await user.keyboard(' continued')
    expect(name).toHaveValue('Draft continued')
    expect(editorRef.current?.getMarkdown()).toBe('Note body')
  }
)
