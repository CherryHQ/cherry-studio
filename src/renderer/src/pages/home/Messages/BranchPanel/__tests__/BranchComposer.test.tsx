import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BranchComposer from '../BranchComposer'
import type { BranchAnchor } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const anchor: BranchAnchor = {
  messageId: 'msg-42',
  blockId: 'blk-13',
  selectedText: 'Distillation transfers behaviour from a larger teacher model to a smaller student.',
  selectionStart: 0,
  selectionEnd: 82
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchComposer (T-006D-2B compose state)', () => {
  beforeEach(() => {
    /* nothing — @cherrystudio/ui mock renders primitives statelessly */
  })

  it('renders the selectedText quote, textarea, and both action buttons', () => {
    render(<BranchComposer anchor={anchor} status="idle" onCreate={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByTestId('branch-composer-quote')).toHaveTextContent(anchor.selectedText)
    expect(screen.getByLabelText('chat.message.anchor.panel.follow_up_label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ })).toBeInTheDocument()
  })

  it('blocks Create when followUp is empty and surfaces the validation error', () => {
    const onCreate = vi.fn()
    render(<BranchComposer anchor={anchor} status="idle" onCreate={onCreate} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))

    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByTestId('branch-composer-validation-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.followup_required'
    )
  })

  it('invokes onCreate with the trimmed follow-up text', () => {
    const onCreate = vi.fn()
    render(<BranchComposer anchor={anchor} status="idle" onCreate={onCreate} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: '  what does student mean?  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))

    expect(onCreate).toHaveBeenCalledWith('what does student mean?')
  })

  it("loading state ('creating'): disables both buttons and shows a spinner", () => {
    render(<BranchComposer anchor={anchor} status="creating" onCreate={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ })).toBeDisabled()
    expect(document.querySelector('svg.animate-spin')).toBeTruthy()
  })

  it("error state ('error'): renders errorMessage and keeps followUp draft editable", () => {
    const { rerender } = render(
      <BranchComposer anchor={anchor} status="creating" onCreate={vi.fn()} onCancel={vi.fn()} />
    )

    // The composer's textarea retains user input across status changes.
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label')
    fireEvent.change(textarea, { target: { value: 'my follow up' } })

    rerender(
      <BranchComposer
        anchor={anchor}
        status="error"
        errorMessage="chat.message.anchor.panel.error.create_failed"
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('branch-composer-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.create_failed'
    )
    expect(screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label').value).toBe(
      'my follow up'
    )
    expect(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ })).not.toBeDisabled()
  })

  it('clears the validation error once the user starts typing again', () => {
    render(<BranchComposer anchor={anchor} status="idle" onCreate={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /chat\.message\.anchor\.panel\.create_branch/ }))
    expect(screen.getByTestId('branch-composer-validation-error')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
      target: { value: 'q' }
    })

    expect(screen.queryByTestId('branch-composer-validation-error')).toBeNull()
  })

  it('Cancel calls onCancel when idle; suppressed when creating', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<BranchComposer anchor={anchor} status="idle" onCreate={vi.fn()} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(<BranchComposer anchor={anchor} status="creating" onCreate={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1) // still 1 — creating state suppresses
  })

  it('resets the follow-up draft when the anchor changes (re-anchoring)', () => {
    const { rerender } = render(<BranchComposer anchor={anchor} status="idle" onCreate={vi.fn()} onCancel={vi.fn()} />)
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label')
    fireEvent.change(textarea, { target: { value: 'stale draft' } })
    expect(textarea.value).toBe('stale draft')

    const newAnchor: BranchAnchor = { ...anchor, messageId: 'msg-99', selectedText: 'different selection' }
    rerender(<BranchComposer anchor={newAnchor} status="idle" onCreate={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label').value).toBe('')
  })
})
