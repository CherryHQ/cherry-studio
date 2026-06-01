import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchFollowUpComposer from '../BranchFollowUpComposer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function typeFollowUp(value: string) {
  fireEvent.change(screen.getByLabelText('chat.message.anchor.panel.follow_up_label'), {
    target: { value }
  })
}

describe('BranchFollowUpComposer (P1-S2b-2)', () => {
  it('emits the trimmed text on send', () => {
    const onSend = vi.fn()
    render(<BranchFollowUpComposer onSend={onSend} />)

    typeFollowUp('   what about edge cases?   ')
    fireEvent.click(screen.getByTestId('branch-followup-send'))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('what about edge cases?')
  })

  it('clears the textarea after a successful send', () => {
    render(<BranchFollowUpComposer onSend={vi.fn()} />)

    const textarea = screen.getByLabelText('chat.message.anchor.panel.follow_up_label') as HTMLTextAreaElement
    typeFollowUp('next turn')
    expect(textarea.value).toBe('next turn')

    fireEvent.click(screen.getByTestId('branch-followup-send'))
    expect(textarea.value).toBe('')
  })

  it('does not emit on an empty / whitespace-only draft; shows a validation message', () => {
    const onSend = vi.fn()
    render(<BranchFollowUpComposer onSend={onSend} />)

    typeFollowUp('   ')
    fireEvent.click(screen.getByTestId('branch-followup-send'))

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByTestId('branch-followup-validation-error')).toHaveTextContent(
      'chat.message.anchor.panel.error.followup_required'
    )
  })

  it('clears the validation message once the user types again', () => {
    render(<BranchFollowUpComposer onSend={vi.fn()} />)

    fireEvent.click(screen.getByTestId('branch-followup-send'))
    expect(screen.getByTestId('branch-followup-validation-error')).toBeInTheDocument()

    typeFollowUp('a real question')
    expect(screen.queryByTestId('branch-followup-validation-error')).toBeNull()
  })
})
