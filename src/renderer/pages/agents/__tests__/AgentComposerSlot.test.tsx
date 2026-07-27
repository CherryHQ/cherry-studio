import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { render, screen } from '@testing-library/react'
import { type ReactNode, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'

import AgentComposerSlot from '../AgentComposerSlot'

const agentComposerPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const agentRightPaneActionsMock = vi.hoisted(() => ({
  openAgentToolFlow: vi.fn()
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useOptionalRightPanelState: () => null
}))

vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({ fallback }: { fallback?: ReactNode }) => (
    <Suspense fallback={<div data-testid="lazy-composer-loading" />}>{fallback}</Suspense>
  )
}))

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: (props: any) => {
    agentComposerPropsMock.last = props
    return <div data-testid="agent-composer" />
  }
}))

vi.mock('../components/AgentRightPane', () => ({
  useAgentRightPaneActions: () => ({
    canOpenAgentToolFlow: true,
    openAgentToolFlow: agentRightPaneActionsMock.openAgentToolFlow
  })
}))

const session = { id: 'session-1', agentId: 'agent-1' } as AgentSessionEntity

const baseProps = {
  agentLoading: true,
  isMultiSelectMode: false,
  session,
  sessionId: session.id,
  sendMessage: vi.fn(),
  captureLocalSendScrollEligibility: vi.fn(),
  stop: vi.fn(),
  isStreaming: false,
  sendDisabled: false,
  composerContext: {}
}

describe('AgentComposerSlot', () => {
  it('keeps the composer frame visible while agent metadata is resolving', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} />)

    expect(container.querySelector('[data-conversation-composer-loading]')).toBeInTheDocument()
  })

  it('mounts the real composer after agent metadata resolves', async () => {
    const { rerender } = render(<AgentComposerSlot {...baseProps} />)

    const activeAgent = { id: 'agent-1', model: 'provider:model-1' } as any
    const activeModel = { id: 'provider:model-1', name: 'Model 1' } as any
    rerender(
      <AgentComposerSlot
        {...baseProps}
        agentId="agent-1"
        agentLoading={false}
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
      externalContextControls: true,
      openAgentToolFlow: agentRightPaneActionsMock.openAgentToolFlow,
      captureLocalSendScrollEligibility: baseProps.captureLocalSendScrollEligibility
    })
    expect(agentComposerPropsMock.last?.onAgentChange).toBeUndefined()
    expect(agentComposerPropsMock.last?.onWorkspaceChange).toBeUndefined()
  })

  it('does not leave an orphan session in a permanent loading state', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} agentLoading={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('hides the composer in multi-select mode', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} isMultiSelectMode />)

    expect(container).toBeEmptyDOMElement()
  })
})
