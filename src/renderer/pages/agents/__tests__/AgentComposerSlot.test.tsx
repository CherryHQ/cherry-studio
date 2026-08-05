import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import AgentComposerSlot from '../AgentComposerSlot'

const agentComposerPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useOptionalRightPanelState: () => null
}))

vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({ fallback }: { fallback?: ReactNode }) => fallback
}))

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: (props: any) => {
    agentComposerPropsMock.last = props
    return <div data-testid="agent-composer" />
  }
}))

const session = { id: 'session-1', agentId: 'agent-1' } as AgentSessionEntity

const baseProps = {
  agentId: 'agent-1',
  isMultiSelectMode: false,
  session,
  sessionId: session.id,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  isStreaming: false,
  sendDisabled: true,
  composerContext: {}
}

describe('AgentComposerSlot', () => {
  it('mounts the real composer while agent metadata is resolving', () => {
    render(<AgentComposerSlot {...baseProps} />)

    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()
    expect(agentComposerPropsMock.last).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        resolvedAgent: undefined,
        sendDisabled: true
      })
    )
  })

  it('mounts the real composer after agent metadata resolves', async () => {
    const activeAgent = { id: 'agent-1', model: 'provider:model-1' } as any
    const activeModel = { id: 'provider:model-1', name: 'Model 1' } as any
    render(
      <AgentComposerSlot
        {...baseProps}
        activeAgent={activeAgent}
        activeModel={activeModel}
        workspaceWarning="Workspace unavailable"
      />
    )

    expect(await screen.findByTestId('agent-composer')).toBeInTheDocument()
    expect(agentComposerPropsMock.last).toMatchObject({
      resolvedAgent: activeAgent,
      resolvedModel: activeModel,
      resolvedWorkspaceWarning: 'Workspace unavailable',
      externalContextControls: true
    })
    expect(agentComposerPropsMock.last?.onAgentChange).toBeUndefined()
    expect(agentComposerPropsMock.last?.onWorkspaceChange).toBeUndefined()
  })

  it('forwards one-shot launch options to the real composer', () => {
    const launchOptions = {
      draftCacheKey: 'agent-feedback-draft-session-1',
      initialDraft: { text: 'Use the issue-reporter skill.', tokens: [] },
      onSent: vi.fn()
    }

    render(<AgentComposerSlot {...baseProps} composerLaunchOptions={launchOptions} />)

    expect(agentComposerPropsMock.last?.launchOptions).toBe(launchOptions)
  })

  it('does not leave an orphan session in a permanent loading state', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} agentId={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('hides the composer in multi-select mode', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} isMultiSelectMode />)

    expect(container).toBeEmptyDOMElement()
  })
})
