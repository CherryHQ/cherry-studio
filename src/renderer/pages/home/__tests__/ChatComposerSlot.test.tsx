import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import type { Topic } from '@renderer/types/topic'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ChatComposerSlot from '../ChatComposerSlot'

vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({
    composerContext,
    fallback,
    forceNarrowLayout
  }: {
    composerContext?: ComposerContextValue
    fallback?: ReactNode
    forceNarrowLayout?: boolean
  }) => {
    let activeOverride: NonNullable<ComposerContextValue['overrides']>[number] | undefined
    for (const candidate of composerContext?.overrides ?? []) {
      if (!activeOverride || (candidate.priority ?? 0) > (activeOverride.priority ?? 0)) {
        activeOverride = candidate
      }
    }
    return (
      <div data-testid="conversation-composer-slot" data-force-narrow-layout={forceNarrowLayout || undefined}>
        {activeOverride ? activeOverride.render({}) : fallback}
      </div>
    )
  }
}))

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
  it('renders the normal composer when no approval override is active', async () => {
    render(<ChatComposerSlot {...baseProps} composerContext={{ overrides: [] }} />)

    const composer = await screen.findByTestId('chat-fallback-composer')
    expect(composer).toBeInTheDocument()
    expect(composer).toHaveAttribute('data-placement', 'docked')
  })

  it('forwards sendDisabled only for docked placement', async () => {
    render(<ChatComposerSlot {...baseProps} sendDisabled composerContext={{ overrides: [] }} />)

    const composer = await screen.findByTestId('chat-fallback-composer')
    expect(composer).toHaveAttribute('data-placement', 'docked')
    expect(composer).toBeDisabled()
  })

  it('does not forward slot sendDisabled into home placement', async () => {
    render(
      <ChatComposerSlot placement="home" topic={topic} onSend={baseProps.onSend} composerContext={{ overrides: [] }} />
    )

    const composer = await screen.findByTestId('chat-fallback-composer')
    expect(composer).toHaveAttribute('data-placement', 'home')
    expect(composer).not.toBeDisabled()
    expect(screen.getByTestId('conversation-composer-slot')).toHaveAttribute('data-force-narrow-layout', 'true')
  })

  it('lets docked loading follow the global width preference', () => {
    render(<ChatComposerSlot {...baseProps} composerContext={{ overrides: [] }} />)

    expect(screen.getByTestId('conversation-composer-slot')).not.toHaveAttribute('data-force-narrow-layout')
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
