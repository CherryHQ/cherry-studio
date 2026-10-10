import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ComposerContextProvider, type ComposerOverride } from '../ComposerContext'
import ComposerCore from '../ComposerCore'

function StatefulComposer({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [undoDepth, setUndoDepth] = useState(0)

  useEffect(() => {
    onMount()
    return onUnmount
  }, [onMount, onUnmount])

  return (
    <div>
      <textarea aria-label="composer input" value={text} onChange={(event) => setText(event.target.value)} />
      <button type="button" onClick={() => setAttachments((current) => [...current, 'notes.txt'])}>
        add attachment
      </button>
      <button type="button" onClick={() => setUndoDepth((current) => current + 1)}>
        edit document
      </button>
      <div data-testid="attachments">{attachments.join(',')}</div>
      <div data-testid="undo-depth">{undoDepth}</div>
    </div>
  )
}

const permissionOverride: ComposerOverride = {
  id: 'tool-permission:approval-1',
  priority: 90,
  render: () => <button type="button">permission override</button>
}

const askUserQuestionOverride: ComposerOverride = {
  id: 'ask-user-question:approval-2',
  priority: 100,
  render: () => <button type="button">ask user question override</button>
}

function renderComposer(overrides: readonly ComposerOverride[], onMount: () => void, onUnmount: () => void) {
  return (
    <ComposerContextProvider value={{ overrides }}>
      <ComposerCore fallback={<StatefulComposer onMount={onMount} onUnmount={onUnmount} />} />
    </ComposerContextProvider>
  )
}

describe('ComposerCore', () => {
  it('keeps the primary composer instance and editor state mounted across approval overrides', () => {
    const onMount = vi.fn()
    const onUnmount = vi.fn()
    const view = render(renderComposer([], onMount, onUnmount))
    const input = screen.getByRole('textbox', { name: 'composer input' }) as HTMLTextAreaElement

    fireEvent.change(input, { target: { value: 'draft with attachment' } })
    fireEvent.click(screen.getByRole('button', { name: 'add attachment' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit document' }))
    input.focus()
    input.setSelectionRange(6, 10)

    view.rerender(renderComposer([permissionOverride, askUserQuestionOverride], onMount, onUnmount))

    const primaryLayer = view.container.querySelector('[data-composer-primary-layer]')
    expect(screen.getByRole('button', { name: 'ask user question override' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'permission override' })).not.toBeInTheDocument()
    expect(primaryLayer).toHaveAttribute('inert')
    expect(primaryLayer).toHaveAttribute('aria-hidden', 'true')
    expect(primaryLayer).toHaveClass('invisible', 'pointer-events-none', 'absolute')
    expect(view.container.querySelector('textarea')).toBe(input)
    expect(input).toHaveValue('draft with attachment')
    expect(screen.getByTestId('attachments')).toHaveTextContent('notes.txt')
    expect(screen.getByTestId('undo-depth')).toHaveTextContent('1')
    expect(document.activeElement).toBe(document.body)

    view.rerender(renderComposer([permissionOverride], onMount, onUnmount))

    expect(screen.getByRole('button', { name: 'permission override' })).toBeInTheDocument()
    expect(view.container.querySelector('textarea')).toBe(input)
    expect(onMount).toHaveBeenCalledTimes(1)
    expect(onUnmount).not.toHaveBeenCalled()

    view.rerender(renderComposer([], onMount, onUnmount))

    expect(view.container.querySelector('textarea')).toBe(input)
    expect(input).toHaveValue('draft with attachment')
    expect(input.selectionStart).toBe(6)
    expect(input.selectionEnd).toBe(10)
    expect(document.activeElement).toBe(input)
    expect(primaryLayer).not.toHaveAttribute('inert')
    expect(primaryLayer).not.toHaveAttribute('aria-hidden')
    expect(onMount).toHaveBeenCalledTimes(1)
    expect(onUnmount).not.toHaveBeenCalled()
  })
})
