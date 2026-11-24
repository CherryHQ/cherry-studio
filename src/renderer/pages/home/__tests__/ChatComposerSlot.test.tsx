import { render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type ComposerContextValue, useActiveComposerOverride } from '@renderer/components/composer/ComposerContext'
import type { Topic } from '@renderer/types/topic'
import type { ComposerChatTarget } from '@shared/ai/transport'

import ChatComposerSlot from '../ChatComposerSlot'

const chatPlacementProps = vi.hoisted(() => ({ current: null as any }))
const rightPanelPresentationMock = vi.hoisted(() => ({ maximized: false }))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useRightPanelPresentationMaximized: () => rightPanelPresentationMock.maximized
}))

// The real fallback composer pulls in the whole input toolbar; swap it for a
// sentinel so the test exercises only the override-forwarding wire.
vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: (props: {
    placement: 'home' | 'docked'
    scopeKey: string
    contextUsage: { contextTokens: number; modelId: string } | null
    chatTarget?: ComposerChatTarget
    sendDisabled?: boolean
    onConversationControlsChange?: (snapshot: unknown) => void
  }) => {
    chatPlacementProps.current = props
    const { onConversationControlsChange, scopeKey } = props
    const activeOverride = useActiveComposerOverride()
    useLayoutEffect(() => {
      onConversationControlsChange?.(activeOverride ? null : { scopeKey })
      return () => onConversationControlsChange?.(null)
    }, [activeOverride, onConversationControlsChange, scopeKey])
    return (
      <button
        type="button"
        data-placement={props.placement}
        data-testid="chat-fallback-composer"
        disabled={Boolean(props.sendDisabled)}>
        fallback
      </button>
    )
  }
}))

const topic = { id: 'topic-1' } as Topic
const chatTarget = { parentAnchorId: 'active-node', mode: 'active-path' } as const

const baseProps = {
  placement: 'docked' as const,
  topic,
  contextUsage: { contextTokens: 42, modelId: 'provider::model' as const },
  onSend: vi.fn(),
  chatTarget
}

describe('ChatComposerSlot', () => {
  beforeEach(() => {
    chatPlacementProps.current = null
    rightPanelPresentationMock.maximized = false
  })

  it('surfaces an active composer override while keeping the input mounted and inert', () => {
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
    expect(screen.getByTestId('chat-fallback-composer')).toBeInTheDocument()
    expect(screen.getByTestId('chat-fallback-composer').closest('[data-composer-primary-layer]')).toHaveAttribute(
      'inert'
    )
  })
})
