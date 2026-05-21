import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BranchPanel from '../BranchPanel'
import type { BranchAnchor } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const fixtureAnchor: BranchAnchor = {
  messageId: 'msg-42',
  blockId: 'blk-13',
  selectedText: 'Distillation transfers behaviour from a larger teacher model to a smaller student.'
}

beforeEach(() => {
  // Global @cherrystudio/ui mock renders Dialog as visible <div> when `open`.
  // No additional stubbing required.
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchPanel (T-006D-1 shell)', () => {
  it('does not render any panel content when open is false', () => {
    render(<BranchPanel anchor={null} open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByTestId('branch-panel-selected-text')).toBeNull()
    expect(screen.queryByTestId('branch-panel-message-id')).toBeNull()
    expect(screen.queryByTestId('branch-panel-block-id')).toBeNull()
  })

  it('renders the anchor selectedText, messageId, blockId, follow-up input, and both buttons when open', () => {
    render(<BranchPanel anchor={fixtureAnchor} open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('branch-panel-selected-text')).toHaveTextContent(fixtureAnchor.selectedText)
    expect(screen.getByTestId('branch-panel-message-id')).toHaveTextContent('msg-42')
    expect(screen.getByTestId('branch-panel-block-id')).toHaveTextContent('blk-13')
    expect(screen.getByLabelText('chat.message.anchor.panel.follow_up_label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat.message.anchor.panel.create_branch' })).toBeInTheDocument()
  })

  it('Cancel button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    render(<BranchPanel anchor={fixtureAnchor} open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Create branch button logs the anchor + follow-up and closes the panel (T-006D-1 placeholder)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const onOpenChange = vi.fn()
    render(<BranchPanel anchor={fixtureAnchor} open onOpenChange={onOpenChange} />)

    const textarea = screen.getByLabelText('chat.message.anchor.panel.follow_up_label')
    fireEvent.change(textarea, { target: { value: 'what does smaller student mean?' } })

    fireEvent.click(screen.getByRole('button', { name: 'chat.message.anchor.panel.create_branch' }))

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('create branch'),
      expect.objectContaining({
        messageId: 'msg-42',
        blockId: 'blk-13',
        selectedText: fixtureAnchor.selectedText,
        followUp: 'what does smaller student mean?'
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Create branch button is disabled when anchor is null', () => {
    render(<BranchPanel anchor={null} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'chat.message.anchor.panel.create_branch' })).toBeDisabled()
  })

  it('clears the follow-up textarea after the panel closes and reopens', () => {
    const { rerender } = render(<BranchPanel anchor={fixtureAnchor} open onOpenChange={vi.fn()} />)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label')
    fireEvent.change(textarea, { target: { value: 'lingering text' } })
    expect(textarea.value).toBe('lingering text')

    rerender(<BranchPanel anchor={fixtureAnchor} open={false} onOpenChange={vi.fn()} />)
    rerender(<BranchPanel anchor={fixtureAnchor} open onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText<HTMLTextAreaElement>('chat.message.anchor.panel.follow_up_label').value).toBe('')
  })
})
