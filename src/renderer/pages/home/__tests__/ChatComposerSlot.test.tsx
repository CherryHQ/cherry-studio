import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import type { Topic } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ChatComposerSlot from '../ChatComposerSlot'

// The real fallback composer pulls in the whole input toolbar; swap it for a
// sentinel so the test exercises only the override-forwarding wire.
vi.mock('@renderer/components/chat/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: () => <div data-testid="chat-fallback-composer">fallback</div>
}))

const topic = { id: 'topic-1' } as Topic

const baseProps = {
  isHome: false,
  topic,
  onSend: vi.fn()
}

describe('ChatComposerSlot', () => {
  it('renders the normal composer when no approval override is active', () => {
    render(<ChatComposerSlot {...baseProps} composerContext={{ overrides: [] }} />)

    expect(screen.getByTestId('chat-fallback-composer')).toBeInTheDocument()
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
