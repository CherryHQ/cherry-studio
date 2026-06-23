import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
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
  resetOverlay: vi.fn(),
  useTopicOverlayHandoffOnTerminal: vi.fn(),
  sendTurn: vi.fn(),
  chatStop: vi.fn(),
  chatSetMessages: vi.fn(),
  respondToolApproval: vi.fn(),
  toastWarning: vi.fn()
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
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: mocks.useTopicOverlayHandoffOnTerminal
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
const askUserQuestionInput = {
  questions: [
    {
      question: 'Choose logger',
      header: 'Logger',
      options: [{ label: 'Winston' }, { label: 'Pino' }],
      multiSelect: false
    }
  ]
}
const askUserQuestionUpdatedInput = {
  ...askUserQuestionInput,
  answers: { 'Choose logger': 'Winston' }
}

function makeAskUserQuestionPart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolName: 'AskUserQuestion',
    toolCallId: 'call-ask',
    state: 'approval-requested',
    input: askUserQuestionInput,
    approval: { id: 'approval-ask' },
    ...overrides
  } as unknown as CherryMessagePart
}

function makeAskUserQuestionApproval(part = makeAskUserQuestionPart()) {
  return {
    match: {
      part,
      state: 'approval-requested',
      toolCallId: 'call-ask',
      messageId: 'assistant-1',
      approvalId: 'approval-ask',
      input: askUserQuestionInput
    },
    approved: true,
    updatedInput: askUserQuestionUpdatedInput
  }
}

describe('useAgentChatRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.respondToolApproval.mockResolvedValue({ ok: true })
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
      reset: mocks.resetOverlay
    })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: mocks.respondToolApproval
          }
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        warning: mocks.toastWarning
      }
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

  it('wires a refresh-then-reset overlay handoff to the terminal status edge', async () => {
    renderHook(() =>
      useAgentChatRuntimeState({
        session,
        activeAgent: undefined,
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    // The deterministic handoff (fires off the live→terminal status edge, where
    // the overlay's onFinish is suppressed) must refresh the DB then drop the overlay.
    const handoff = mocks.useTopicOverlayHandoffOnTerminal.mock.calls[0]?.[1] as (() => Promise<void>) | undefined
    expect(handoff).toEqual(expect.any(Function))

    await act(async () => {
      await handoff?.()
    })

    expect(mocks.refresh).toHaveBeenCalled()
    expect(mocks.resetOverlay).toHaveBeenCalled()
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.resetOverlay.mock.invocationCallOrder[0])
  })

  it('merges live assistant metadata into displayed session messages', () => {
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: {},
      liveAssistants: [
        {
          ...assistantMessage,
          metadata: {
            ...assistantMessage.metadata,
            thoughtsTokens: 256
          }
        } as CherryUIMessage
      ],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })

    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        session,
        activeAgent: undefined,
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    expect(result.current.uiMessages[0]?.metadata?.thoughtsTokens).toBe(256)
  })

  it('stores AskUserQuestion submitted input as a temporary tool input', async () => {
    const part = makeAskUserQuestionPart()
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        session,
        activeAgent: undefined,
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    await act(async () => {
      await result.current.respondToolApproval(makeAskUserQuestionApproval(part))
    })

    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({
      'call-ask': askUserQuestionUpdatedInput
    })
  })

  it('removes the temporary AskUserQuestion input when approval delivery fails', async () => {
    mocks.respondToolApproval.mockRejectedValueOnce(new Error('ipc boom'))
    const part = makeAskUserQuestionPart()
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        session,
        activeAgent: undefined,
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    await act(async () => {
      await expect(result.current.respondToolApproval(makeAskUserQuestionApproval(part))).rejects.toThrow('ipc boom')
    })

    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({})
  })
})
