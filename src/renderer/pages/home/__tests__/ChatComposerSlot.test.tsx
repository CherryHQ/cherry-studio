import { type ComposerContextValue, useActiveComposerOverride } from '@renderer/components/composer/ComposerContext'
import type { Topic } from '@renderer/types/topic'
import { render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ChatComposerSlot from '../ChatComposerSlot'

const chatPlacementProps = vi.hoisted(() => ({ current: null as any }))

// The real fallback composer pulls in the whole input toolbar; swap it for a
// sentinel so the test exercises only the override-forwarding wire.
vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: (props: {
    placement: 'home' | 'docked'
    scopeKey: string
    contextUsage: { contextTokens: number; modelId: string } | null
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

const baseProps = {
  placement: 'docked' as const,
  topic,
  contextUsage: { contextTokens: 42, modelId: 'provider::model' as const },
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
        contextUsage: baseProps.contextUsage,
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
      <ChatComposerSlot
        placement="home"
        topic={topic}
        contextUsage={baseProps.contextUsage}
        onSend={baseProps.onSend}
        composerContext={{ overrides: [] }}
      />
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

  it('clears stale conversation controls while an approval override hides the mounted composer', async () => {
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
