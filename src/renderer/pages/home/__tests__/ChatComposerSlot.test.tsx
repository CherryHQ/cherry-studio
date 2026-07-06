import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import type { Topic } from '@renderer/types/topic'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ChatComposerSlot from '../ChatComposerSlot'

// The real fallback composer pulls in the whole input toolbar; swap it for a
// sentinel so the test exercises only the override-forwarding wire.
vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: ({ placement, sendDisabled }: { placement: 'home' | 'docked'; sendDisabled?: boolean }) => (
    <button
      type="button"
      data-placement={placement}
      data-testid="chat-fallback-composer"
      disabled={Boolean(sendDisabled)}>
      fallback
    </button>
  )
}))

const topic = { id: 'topic-1' } as Topic

const baseProps = {
  placement: 'docked' as const,
  topic,
  onSend: vi.fn()
}

describe('ChatComposerSlot', () => {
  it('renders the normal composer when no approval override is active', () => {
    render(<ChatComposerSlot {...baseProps} composerContext={{ overrides: [] }} />)

    expect(screen.getByTestId('chat-fallback-composer')).toBeInTheDocument()
    expect(screen.getByTestId('chat-fallback-composer')).toHaveAttribute('data-placement', 'docked')
  })

  it('forwards sendDisabled only for docked placement', () => {
    render(<ChatComposerSlot {...baseProps} sendDisabled composerContext={{ overrides: [] }} />)

    expect(screen.getByTestId('chat-fallback-composer')).toHaveAttribute('data-placement', 'docked')
    expect(screen.getByTestId('chat-fallback-composer')).toBeDisabled()
  })

  it('does not forward slot sendDisabled into home placement', () => {
    render(
      <ChatComposerSlot placement="home" topic={topic} onSend={baseProps.onSend} composerContext={{ overrides: [] }} />
    )

    expect(screen.getByTestId('chat-fallback-composer')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('chat-fallback-composer')).not.toBeDisabled()
  })

  it('surfaces an active composer override (tool-approval card) in place of the input', () => {
    const composerContext: ComposerContextValue = {
      overrides: [
        {
          id: 'tool-permission:approval-1',
          priority: 90,
          render: () => <div data-testid="permission-card">approve?</div>
        }
      ]
    }

    render(<ChatComposerSlot {...baseProps} composerContext={composerContext} />)

    expect(screen.getByTestId('permission-card')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-fallback-composer')).not.toBeInTheDocument()
  })
})
