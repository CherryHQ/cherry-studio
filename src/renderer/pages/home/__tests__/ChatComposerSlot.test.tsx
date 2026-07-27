import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import type { Topic } from '@renderer/types/topic'
import { render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useLayoutEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ChatComposerSlot from '../ChatComposerSlot'

const chatPlacementProps = vi.hoisted(() => ({ current: null as any }))

vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({ composerContext, fallback }: { composerContext?: ComposerContextValue; fallback?: ReactNode }) => {
    let activeOverride: NonNullable<ComposerContextValue['overrides']>[number] | undefined
    for (const candidate of composerContext?.overrides ?? []) {
      if (!activeOverride || (candidate.priority ?? 0) > (activeOverride.priority ?? 0)) {
        activeOverride = candidate
      }
    }
    return <div data-testid="conversation-composer-slot">{activeOverride ? activeOverride.render({}) : fallback}</div>
  }
}))

// The real fallback composer pulls in the whole input toolbar; swap it for a
// sentinel so the test exercises only the override-forwarding wire.
vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: (props: {
    placement: 'home' | 'docked'
    scopeKey: string
    sendDisabled?: boolean
    onConversationControlsChange?: (snapshot: unknown) => void
  }) => {
    chatPlacementProps.current = props
    const { onConversationControlsChange, scopeKey } = props
    useLayoutEffect(() => {
      onConversationControlsChange?.({ scopeKey })
      return () => onConversationControlsChange?.(null)
    }, [onConversationControlsChange, scopeKey])
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

const baseProps = {
  placement: 'docked' as const,
  topic,
  onSend: vi.fn()
}

describe('ChatComposerSlot', () => {
  it('renders the normal composer when no approval override is active', async () => {
    const assistantContext = { assistant: { id: 'assistant-1' } } as any
    const providers = [{ id: 'provider-1' }] as any
    const onConversationControlsChange = vi.fn()
    render(
      <ChatComposerSlot
        {...baseProps}
        composerContext={{ overrides: [] }}
        assistantContext={assistantContext}
        providers={providers}
        onConversationControlsChange={onConversationControlsChange}
      />
    )

    const composer = await screen.findByTestId('chat-fallback-composer')
    expect(composer).toBeInTheDocument()
    expect(composer).toHaveAttribute('data-placement', 'docked')
    expect(chatPlacementProps.current).toEqual(
      expect.objectContaining({
        resolvedContext: assistantContext,
        resolvedProviders: providers,
        externalContextControls: true,
        onConversationControlsChange
      })
    )
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
  })

  it('mounts the composer while the page-owned assistant context is loading', async () => {
    const assistantContext = { isLoading: true, isModelPending: true } as any
    render(<ChatComposerSlot {...baseProps} assistantContext={assistantContext} composerContext={{ overrides: [] }} />)

    expect(await screen.findByTestId('chat-fallback-composer')).toBeInTheDocument()
    expect(chatPlacementProps.current?.resolvedContext).toBe(assistantContext)
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

  it('clears stale conversation controls while an approval override replaces the composer', async () => {
    const onConversationControlsChange = vi.fn()
    const view = render(
      <ChatComposerSlot
        {...baseProps}
        onConversationControlsChange={onConversationControlsChange}
        composerContext={{ overrides: [] }}
      />
    )

    await waitFor(() => {
      expect(onConversationControlsChange).toHaveBeenLastCalledWith({ scopeKey: topic.id })
    })

    view.rerender(
      <ChatComposerSlot
        {...baseProps}
        onConversationControlsChange={onConversationControlsChange}
        composerContext={{
          overrides: [
            {
              id: 'tool-permission:approval-1',
              priority: 90,
              render: () => <div data-testid="permission-card">approve?</div>
            }
          ]
        }}
      />
    )

    expect(onConversationControlsChange).toHaveBeenLastCalledWith(null)

    view.rerender(
      <ChatComposerSlot
        {...baseProps}
        onConversationControlsChange={onConversationControlsChange}
        composerContext={{ overrides: [] }}
      />
    )
    await waitFor(() => {
      expect(onConversationControlsChange).toHaveBeenLastCalledWith({ scopeKey: topic.id })
    })
  })
})
