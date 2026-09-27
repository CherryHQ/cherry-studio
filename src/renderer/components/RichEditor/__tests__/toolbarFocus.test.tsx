import { act, fireEvent, render, screen } from '@testing-library/react'
import { t } from 'i18next'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RichEditorRef } from '../types'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

describe('RichEditor toolbar focus', () => {
  it('keeps focus and emits markdown when bold is pressed', () => {
    const editorRef: RefObject<RichEditorRef | null> = { current: null }
    const changes: string[] = []
    const { container } = render(
      <RichEditor
        ref={editorRef}
        initialContent="hello world"
        autoFocus={false}
        ariaLabel="Content"
        onMarkdownChange={(markdown) => changes.push(markdown)}
      />
    )
    const editingSurface = container.querySelector<HTMLElement>('[contenteditable="true"]')!
    const boldButton = screen.getByRole('button', { name: t('richEditor.toolbar.bold') })

    act(() => editingSurface.focus())
    act(() => editorRef.current?.executeCommand('setTextSelection', { from: 1, to: 6 }))
    expect(editingSurface).toHaveFocus()

    // jsdom does not move focus on mousedown; browsers focus the button unless the press is prevented.
    const moveFocus = (event: MouseEvent) => {
      if (!event.defaultPrevented && event.target instanceof HTMLElement) event.target.focus()
    }
    document.addEventListener('mousedown', moveFocus)
    try {
      fireEvent.mouseDown(boldButton)
      fireEvent.click(boldButton)
    } finally {
      document.removeEventListener('mousedown', moveFocus)
    }

    expect(changes).toContain('**hello** world')
    expect(editingSurface).toHaveFocus()
  })
})
