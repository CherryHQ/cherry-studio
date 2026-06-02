import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryUIMessage } from '@shared/data/types/message'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  seedReservedMessages: vi.fn(),
  deleteSessionMessage: vi.fn(),
  useAgentSessionParts: vi.fn(),
  useChatWithHistory: vi.fn(),
  useExecutionOverlay: vi.fn(),
  disposeOverlay: vi.fn(),
  sendTurn: vi.fn(),
  chatStop: vi.fn(),
  chatSetMessages: vi.fn()
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: mocks.useAgentSessionParts
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: mocks.useChatWithHistory
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: mocks.useExecutionOverlay
}))

vi.mock('@renderer/hooks/useConversationTurnController', () => ({
  useConversationTurnController: () => ({
    send: mocks.sendTurn
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false })
}))

vi.mock('@renderer/components/chat/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => []
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useAgentChatRuntimeState } from '../useAgentChatRuntimeState'

const session = { id: 'session-1' } as AgentSessionEntity
const assistantMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [],
  metadata: { status: 'pending' }
} as CherryUIMessage

describe('useAgentChatRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refresh.mockResolvedValue([assistantMessage])
    mocks.seedReservedMessages.mockResolvedValue(undefined)
    mocks.deleteSessionMessage.mockResolvedValue(undefined)
    mocks.chatStop.mockResolvedValue(undefined)
    mocks.useAgentSessionParts.mockReturnValue({
      messages: [assistantMessage],
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: mocks.refresh,
      seedReservedMessages: mocks.seedReservedMessages,
      deleteMessage: mocks.deleteSessionMessage
    })
    mocks.useChatWithHistory.mockReturnValue({
      activeExecutions: [{ executionId: 'provider::model', anchorMessageId: 'assistant-1' }],
      sendMessage: vi.fn(),
      stop: mocks.chatStop,
      setMessages: mocks.chatSetMessages,
      status: 'ready',
      error: undefined,
      chat: {}
    })
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: {
        'assistant-1': [
          {
            type: 'dynamic-tool',
            toolCallId: 'tool-1',
            toolName: 'Agent',
            state: 'input-available'
          }
        ]
      },
      liveAssistants: [],
      disposeOverlay: mocks.disposeOverlay,
      reset: vi.fn()
    })
  })

  it('refreshes persisted agent messages and drops stale overlay when an execution terminates', async () => {
    renderHook(() =>
      useAgentChatRuntimeState({
        session,
        activeAgent: undefined,
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    const options = mocks.useExecutionOverlay.mock.calls[0]?.[3] as
      | {
          onFinish?: (
            executionId: string,
            event: { message: CherryUIMessage; isAbort: boolean; isError: boolean }
          ) => void | Promise<void>
        }
      | undefined
    expect(options?.onFinish).toEqual(expect.any(Function))

    await act(async () => {
      await options?.onFinish?.('provider::model', {
        message: {
          ...assistantMessage,
          parts: [{ type: 'text', text: 'partial response' }]
        } as CherryUIMessage,
        isAbort: true,
        isError: false
      })
    })

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    expect(mocks.disposeOverlay).toHaveBeenCalledWith('assistant-1')
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.disposeOverlay.mock.invocationCallOrder[0])
  })
})
