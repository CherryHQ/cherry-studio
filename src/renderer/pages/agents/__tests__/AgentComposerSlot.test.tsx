import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import type { AgentSessionFollowup } from '@shared/ai/agentSessionFollowups'
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
  default: ({ composerContext, fallback }: { composerContext?: ComposerContextValue; fallback?: ReactNode }) =>
    composerContext?.overrides?.[0]?.render({}) ?? fallback
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

  it('keeps a queued draft open when its revision is stale and cancels back to the original composer', async () => {
    const request = vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({ ok: true, data: false })
    const send = vi.fn()
    const original = { initialDraft: { text: 'Original composer draft', tokens: [] } }
    const topicId = 'agent-session:session-1'
    const item: AgentSessionFollowup = {
      id: 'queued-1',
      revision: 1,
      parts: [{ type: 'text', text: 'Original queued input' }]
    }
    const parts = [{ type: 'text', text: 'Attempted edit' }]
    render(
      <AgentComposerSlot
        {...baseProps}
        isStreaming
        sendDisabled={false}
        composerLaunchOptions={original}
        sendMessage={send}
      />
    )

    await act(async () => {
      agentComposerPropsMock.last.onEditQueuedFollowup(topicId, item)
    })
    expect(agentComposerPropsMock.last.sendDisabled).toBe(false)
    await act(async () => {
      await agentComposerPropsMock.last.sendMessage(undefined, { body: { userMessageParts: parts } })
    })

    expect(request).toHaveBeenCalledWith('ai.agent.session.change_followups', {
      topicId,
      change: { type: 'edit', inputId: item.id, revision: item.revision, parts }
    })
    expect(agentComposerPropsMock.last.launchOptions.editing.messageId).toBe(item.id)
    expect(send).not.toHaveBeenCalled()
    await act(async () => {
      agentComposerPropsMock.last.launchOptions.editing.onCancel()
    })
    expect(agentComposerPropsMock.last.launchOptions).toEqual(original)
  })
})
