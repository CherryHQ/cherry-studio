import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import AgentComposerSlot from '../AgentComposerSlot'

const agentComposerPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const rightPanelPresentationMock = vi.hoisted(() => ({ maximized: false }))
const previewInputFileInRightPaneMock = vi.hoisted(() => vi.fn())

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

vi.mock('../components/AgentRightPane', () => ({
  useOptionalAgentRightPaneActions: () => ({
    canPreviewInputFileInRightPane: true,
    previewInputFileInRightPane: previewInputFileInRightPaneMock
  })
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
  cancelEditing: vi.fn(),
  resendEditedMessage: vi.fn(),
  composerContext: {}
}

describe('AgentComposerSlot', () => {
  beforeEach(() => {
    agentComposerPropsMock.last = undefined
    rightPanelPresentationMock.maximized = false
  })

  it('lets an unlinked session select an active agent', async () => {
    const user = userEvent.setup()
    const onAgentChange = vi.fn()
    render(<AgentComposerSlot {...baseProps} agentId={undefined} onAgentChange={onAgentChange} />)

    await user.click(screen.getByRole('button', { name: 'Select active agent' }))

    expect(onAgentChange).toHaveBeenCalledWith('agent-2')
  })
})
