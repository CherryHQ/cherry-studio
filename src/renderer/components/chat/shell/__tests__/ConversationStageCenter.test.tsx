import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationStageCenter from '../ConversationStageCenter'

const optionalShellState = vi.hoisted(() => ({
  value: undefined as { maximized: boolean } | undefined
}))

vi.mock('../../panes/Shell', () => ({
  useOptionalShellState: () => optionalShellState.value
}))

describe('ConversationStageCenter', () => {
  beforeEach(() => {
    optionalShellState.value = undefined
  })

  it('provides the shared full-height center frame around the composer stage', () => {
    const { container } = render(
      <ConversationStageCenter
        placement="home"
        main={<div>messages</div>}
        composer={<div>composer</div>}
        homeWelcomeText="Welcome"
      />
    )

    expect(container.firstElementChild).toHaveClass('h-full', 'min-h-0', 'flex-1')
    expect(screen.getByText('messages')).toBeInTheDocument()
    expect(screen.getByText('composer')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('composer').closest('[data-conversation-composer-stage]')).toHaveAttribute(
      'data-placement',
      'home'
    )
  })

  it('elevates the composer when an optional right pane shell is maximized', () => {
    optionalShellState.value = { maximized: true }

    render(<ConversationStageCenter placement="docked" main={<div />} composer={<div />} />)

    expect(document.querySelector('[data-conversation-composer-stage]')).toHaveAttribute(
      'data-composer-elevated',
      'true'
    )
  })
})
