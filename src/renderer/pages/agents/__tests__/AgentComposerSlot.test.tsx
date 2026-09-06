import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentComposerSlot from '../AgentComposerSlot'

const agentComposerPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const rightPanelPresentationMock = vi.hoisted(() => ({ maximized: false }))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useRightPanelPresentationMaximized: () => rightPanelPresentationMock.maximized
}))

vi.mock('@renderer/components/composer/ConversationComposerSlot', () => ({
  default: ({ fallback }: { fallback?: ReactNode }) => fallback
}))

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: (props: any) => {
    agentComposerPropsMock.last = props
    return <div data-testid="agent-composer" />
  },
  MissingAgentHomeComposer: ({
    onAgentChange,
    agentChanging
  }: {
    onAgentChange?: (agentId: string | null) => void | Promise<void>
    agentChanging?: boolean
  }) => (
    <button type="button" disabled={agentChanging} onClick={() => void onAgentChange?.('agent-2')}>
      Select active agent
    </button>
  )
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
  beforeEach(() => {
    agentComposerPropsMock.last = undefined
    rightPanelPresentationMock.maximized = false
  })

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
    const activeAgent = { id: 'agent-1', model: 'provider::model-1' } as any
    const activeModel = { id: 'provider::model-1', name: 'Model 1' } as any
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
      initialDraft: { text: 'Use the cherry-studio-feedback skill.', tokens: [] },
      onSent: vi.fn()
    }

    render(<AgentComposerSlot {...baseProps} composerLaunchOptions={launchOptions} />)

    expect(agentComposerPropsMock.last?.launchOptions).toBe(launchOptions)
  })

  it.each([true, false])('uses the shared right-panel presentation state when maximized is %s', (maximized) => {
    rightPanelPresentationMock.maximized = maximized

    render(<AgentComposerSlot {...baseProps} />)

    expect(agentComposerPropsMock.last?.compactWhenSingleLine).toBe(maximized)
  })

  it('lets an unlinked session select an active agent', async () => {
    const user = userEvent.setup()
    const onAgentChange = vi.fn()
    render(<AgentComposerSlot {...baseProps} agentId={undefined} onAgentChange={onAgentChange} />)

    await user.click(screen.getByRole('button', { name: 'Select active agent' }))

    expect(onAgentChange).toHaveBeenCalledWith('agent-2')
  })

  it('hides the composer in multi-select mode', () => {
    const { container } = render(<AgentComposerSlot {...baseProps} isMultiSelectMode />)

    expect(container).toBeEmptyDOMElement()
  })
})
