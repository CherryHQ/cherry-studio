import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readAskUserQuestionDraftCache,
  writeAskUserQuestionDraftCache
} from '@renderer/components/composer/variants/askUserQuestionDraftCache'
import type * as AgentSessionPartsModule from '@renderer/hooks/useAgentSessionParts'
import { useConversationErrorToasts } from '@renderer/hooks/useConversationErrorToasts'
import type * as TurnControllerModule from '@renderer/hooks/useConversationTurnController'
import { toast } from '@renderer/services/toast'
import type * as ToastServiceModule from '@renderer/services/toast'
import { AutoReadService } from '@renderer/services/voice/AutoReadService'
import { AGENT_SESSION_CLOSING_CACHE_KEY } from '@shared/ai/agentSessionEdit'
import { AGENT_SESSION_TURN_ORIGIN_CACHE_KEY } from '@shared/ai/agentSessionTurnOrigin'
import type { ActiveExecution, AiStreamOpenResponse } from '@shared/ai/transport'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  seedReservedMessages: vi.fn(),
  replaceMessageTail: vi.fn(),
  deleteSessionMessage: vi.fn(),
  useAgentSessionParts: vi.fn(),
  useChatWithHistory: vi.fn(),
  useExecutionOverlay: vi.fn(),
  disposeOverlay: vi.fn(),
  resetOverlay: vi.fn(),
  useTopicOverlayHandoffOnTerminal: vi.fn(),
  sendTurn: vi.fn(),
  streamOpen: vi.fn(),
  streamListeners: new Map<string, Set<(payload: unknown) => void>>(),
  editTarget: vi.fn(),
  editResend: vi.fn(),
  controllerOptions: vi.fn(),
  toastError: vi.fn(),
  chatStop: vi.fn(),
  chatSetMessages: vi.fn(),
  respondToolApproval: vi.fn(),
  invalidateMessages: vi.fn(),
  toastWarning: vi.fn(),
  autoReadUpdate: vi.fn(),
  autoReadConsume: vi.fn(async () => ({ status: 'started' })),
  autoReadEnabled: true
}))

// respondToolApproval now goes through ipcApi.request('ai.tool.respond_approval', …).
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.tool.respond_approval'
        ? mocks.respondToolApproval(input)
        : route === 'ai.agent.session.edit_target'
          ? mocks.editTarget(input)
          : route === 'ai.agent.session.edit_resend'
            ? mocks.editResend(input)
            : route === 'ai.stream.open'
              ? mocks.streamOpen(input)
              : Promise.resolve(undefined),
    on: (event: string, listener: (payload: unknown) => void) => {
      const listeners = mocks.streamListeners.get(event) ?? new Set()
      mocks.streamListeners.set(event, listeners)
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
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

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [mocks.autoReadEnabled, vi.fn()]
}))

vi.mock('@renderer/services/voice', () => ({
  autoReadService: {
    update: mocks.autoReadUpdate,
    consume: mocks.autoReadConsume
  }
}))

vi.mock('@renderer/hooks/useConversationTurnController', () => ({
  useConversationTurnController: (options: unknown) => {
    return mocks.controllerOptions(options) ?? { send: mocks.sendTurn }
  }
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: mocks.useTopicOverlayHandoffOnTerminal
}))

vi.mock('@renderer/services/messageUiStateCache', () => ({
  invalidateCachedMessageUiStates: mocks.invalidateMessages
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useAgentChatRuntimeState } from '../useAgentChatRuntimeState'

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  const { getToastUtilities } = await import('@cherrystudio/ui/components/primitives/toast')
  return { ...MockCherrystudioUI, getToastUtilities }
})

vi.mock('@renderer/services/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastServiceModule>()
  return { toast: { ...actual.toast, error: mocks.toastError, warning: mocks.toastWarning } }
})

// <Activity> harness: tab switches hide/show the session UI without unmounting
// it, so hooks keep their state but effects are destroyed and re-created.
let latestRuntime: ReturnType<typeof useAgentChatRuntimeState> | null = null

function currentRuntime() {
  if (!latestRuntime) throw new Error('RuntimeStateHost has not rendered yet')
  return latestRuntime
}

function RuntimeStateHost({ sessionId }: { sessionId: string }) {
  latestRuntime = useAgentChatRuntimeState({
    sessionId,
    sessionMessagesEnabled: true,
    reservedMessages: []
  })
  return null
}

function ActivityHarness({ sessionId, mode }: { sessionId: string; mode: 'visible' | 'hidden' }) {
  return (
    <Activity mode={mode}>
      <RuntimeStateHost sessionId={sessionId} />
    </Activity>
  )
}

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
  it('blocks edit entry while the session is closing even after the stream stops', async () => {
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_CLOSING_CACHE_KEY('session-1'), true)
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )

    expect(result.current.editBusy).toBe(true)
    await act(() => result.current.startEditing('user-1'))
    expect(mocks.editTarget).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('allows edit entry when the session is no longer closing', async () => {
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_CLOSING_CACHE_KEY('session-1'), false)
    const draft = { messageId: 'user-1', version: 'version-1', parts: [{ type: 'text' as const, text: 'Original' }] }
    mocks.editTarget.mockResolvedValue(draft)
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )

    expect(result.current.editBusy).toBe(false)
    await act(() => result.current.startEditing('user-1'))
    expect(mocks.editTarget).toHaveBeenCalledWith({ sessionId: 'session-1', messageId: 'user-1' })
    expect(result.current.editing).toMatchObject(draft)
  })

  it('replaces the edited tail before streaming even when history refresh still returns cached rows', async () => {
    MockUseDataApiUtils.resetMocks()
    const { useAgentSessionParts } = await vi.importActual<typeof AgentSessionPartsModule>(
      '@renderer/hooks/useAgentSessionParts'
    )
    mocks.useAgentSessionParts.mockImplementation(useAgentSessionParts)
    const draft = { messageId: 'edited-user', version: 'version-1', parts: [{ type: 'text', text: 'Original' }] }
    const history = ['earlier-user', 'earlier-assistant', draft.messageId, 'old-answer', 'later-user', 'later-answer']
    MockUseDataApiUtils.seedInfiniteQuery(
      '/agent-sessions/:sessionId/messages',
      [
        {
          items: history.toReversed().map(
            (id): AgentSessionMessageEntity => ({
              id,
              sessionId: 'session-1',
              role: id.endsWith('user') ? 'user' : 'assistant',
              data: { parts: [{ type: 'text', text: id }] },
              status: 'success',
              modelId: null,
              messageSnapshot: null,
              stats: null,
              searchableText: id,
              runtimeResumeToken: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            })
          )
        }
      ],
      { params: { sessionId: 'session-1' }, query: { deferToolOutputs: true }, limit: 50 }
    )
    const reserved: CherryUIMessage[] = [
      {
        id: 'replacement-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Replacement' }],
        metadata: { createdAt: '2026-01-02T00:00:00.000Z' }
      },
      {
        id: 'replacement-answer',
        role: 'assistant',
        parts: [],
        metadata: { status: 'pending', createdAt: '2026-01-02T00:00:01.000Z' }
      }
    ]
    mocks.editTarget.mockResolvedValue(draft)
    mocks.editResend.mockResolvedValue({ mode: 'started', reservedMessages: reserved })
    mocks.sendTurn.mockImplementation(async (input) => {
      const { openStream, buildStreamRequest, ensureConversation, historyAdapter } =
        mocks.controllerOptions.mock.lastCall![0]
      const ack = await openStream(buildStreamRequest(input, ensureConversation()), input)
      await historyAdapter.seedReservedMessages(ack.reservedMessages)
      return true
    })
    const { result, rerender } = renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )
    await act(() => result.current.startEditing(draft.messageId))
    await act(() => result.current.resendEditedMessage({ text: 'Replacement' }))
    expect(result.current.uiMessages.map((message) => message.id)).toEqual([
      'earlier-user',
      'earlier-assistant',
      'replacement-user',
      'replacement-answer'
    ])
    mocks.useExecutionOverlay.mockReturnValue({
      ...mocks.useExecutionOverlay(),
      overlay: { 'replacement-answer': [{ type: 'text', text: 'New response in progress' }] },
      liveAssistants: [{ ...reserved[1], parts: [{ type: 'text', text: 'New response in progress' }] }]
    })
    rerender()
    expect(result.current.uiMessages.map((message) => message.id)).toEqual([
      'earlier-user',
      'earlier-assistant',
      'replacement-user',
      'replacement-answer'
    ])
    expect(result.current.partsByMessageId['replacement-answer']).toEqual([
      { type: 'text', text: 'New response in progress' }
    ])
  })

  it('shows the edit reason when resending from an unsupported checkpoint fails', async () => {
    const draft = {
      messageId: 'user-1',
      version: 'version-1',
      parts: [{ type: 'text' as const, text: 'Original question' }]
    }
    mocks.editTarget.mockResolvedValue(draft)
    mocks.editResend.mockRejectedValue(
      new IpcError(aiErrorCodes.AI_AGENT_SESSION_EDIT_FAILED, 'checkpoint_unsupported', {
        reason: 'checkpoint_unsupported'
      })
    )
    mocks.sendTurn.mockImplementation(async (input) => {
      const { openStream, buildStreamRequest, ensureConversation } = mocks.controllerOptions.mock.lastCall![0]
      await openStream(buildStreamRequest(input, ensureConversation()), input)
      return true
    })

    const { result } = renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )
    await act(() => result.current.startEditing(draft.messageId))
    await act(() => result.current.resendEditedMessage({ text: 'Replacement' }))

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('agent.edit_resend.error.checkpoint_unsupported')
    expect(mocks.toastError).not.toHaveBeenCalledWith('agent_session_fork.unsupported_checkpoint')
  })

  it('retains the edited draft after a failed resend and clears it only on acceptance or cancel', async () => {
    const draft = {
      messageId: 'edited-user',
      version: 'version-1',
      parts: [{ type: 'text' as const, text: 'Original question' }]
    }
    const history: CherryUIMessage[] = [
      { id: 'earlier-user', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
      { id: 'earlier-assistant', role: 'assistant', parts: [{ type: 'text', text: 'Earlier answer' }] },
      { id: draft.messageId, role: 'user', parts: draft.parts },
      { ...assistantMessage, parts: [{ type: 'text', text: 'Old answer' }] },
      { id: 'later-user', role: 'user', parts: [{ type: 'text', text: 'Later question' }] },
      { id: 'later-assistant', role: 'assistant', parts: [{ type: 'text', text: 'Later answer' }] }
    ]
    mocks.useAgentSessionParts.mockReturnValue({ ...mocks.useAgentSessionParts(), messages: history })
    mocks.editTarget.mockResolvedValue(draft)
    mocks.editResend.mockResolvedValue({ mode: 'started', reservedMessages: [] })
    mocks.sendTurn.mockImplementation(async (input) => {
      const { openStream, buildStreamRequest, ensureConversation } = mocks.controllerOptions.mock.lastCall![0]
      await openStream(buildStreamRequest(input, ensureConversation()), input)
      return true
    })
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )
    await act(() => result.current.startEditing(draft.messageId))
    expect(result.current.editing).toMatchObject(draft)
    const sending = Promise.withResolvers<unknown>()
    mocks.editResend.mockReturnValueOnce(sending.promise)
    let resend: Promise<boolean>
    act(() => {
      resend = result.current.resendEditedMessage({ text: 'Replacement' })
    })
    expect(result.current.uiMessages.map((item) => item.id)).toEqual([
      'earlier-user',
      'earlier-assistant',
      draft.messageId
    ])
    expect(result.current.partsByMessageId[draft.messageId]).toEqual([{ type: 'text', text: 'Replacement' }])
    await act(async () => {
      sending.reject(new Error('Rejected'))
      await resend
    })
    expect(result.current.uiMessages).toEqual(history)
    expect(result.current.editing).toMatchObject(draft)
    expect(mocks.toastError).toHaveBeenCalledWith('Rejected')
    await act(() => result.current.resendEditedMessage({ text: 'Replacement' }))
    expect(mocks.editResend).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { messageId: draft.messageId, version: draft.version } })
    )
    expect(result.current.editing).toBeUndefined()
    await act(() => result.current.startEditing(draft.messageId))
    act(() => result.current.cancelEditing())
    expect(result.current.editing).toBeUndefined()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    toast.closeAll()
    mocks.controllerOptions.mockReset()
    mocks.streamOpen.mockReset()
    mocks.streamListeners.clear()
    MockCacheUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    mocks.respondToolApproval.mockResolvedValue({ ok: true })
    mocks.refresh.mockResolvedValue([assistantMessage])
    mocks.seedReservedMessages.mockResolvedValue(undefined)
    mocks.deleteSessionMessage.mockResolvedValue(undefined)
    mocks.chatStop.mockResolvedValue(undefined)
    mocks.sendTurn.mockReset()
    mocks.sendTurn.mockResolvedValue(true)
    mocks.autoReadUpdate.mockReset()
    mocks.autoReadConsume.mockClear()
    mocks.autoReadEnabled = true
    mocks.useAgentSessionParts.mockReturnValue({
      messages: [assistantMessage],
      persistedPartsByMessageId: {},
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: mocks.refresh,
      seedReservedMessages: mocks.seedReservedMessages,
      replaceMessageTail: mocks.replaceMessageTail,
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
      value: {}
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        warning: mocks.toastWarning
      }
    })
  })

  it('reports a blocked stream open as not sent', async () => {
    mocks.sendTurn.mockResolvedValueOnce(false)
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    let sent: boolean | undefined
    await act(async () => {
      sent = await result.current.sendMessage({ text: 'keep this draft' })
    })

    expect(sent).toBe(false)
  })

  it.each([
    { beforeAck: false, queued: false },
    { beforeAck: true, queued: false },
    { beforeAck: false, queued: true },
    { beforeAck: true, queued: true }
  ])(
    'reports an accepted send without an overlay finish (error before ack: $beforeAck, queued: $queued)',
    async ({ beforeAck, queued }) => {
      const { useConversationTurnController } = await vi.importActual<typeof TurnControllerModule>(
        '@renderer/hooks/useConversationTurnController'
      )
      mocks.controllerOptions.mockImplementation(useConversationTurnController)
      mocks.useChatWithHistory.mockReturnValue({ ...mocks.useChatWithHistory(), activeExecutions: [] })
      let acknowledge!: (ack: AiStreamOpenResponse) => void
      mocks.streamOpen.mockImplementationOnce(() => new Promise((resolve) => (acknowledge = resolve)))
      const { result } = renderHook(() =>
        useAgentChatRuntimeState({
          sessionId: 'session-1',
          agentType: 'claude-code',
          sessionMessagesEnabled: true,
          reservedMessages: []
        })
      )
      const execution: ActiveExecution = {
        executionId: 'provider::model',
        attemptId: 2,
        anchorMessageId: 'assistant-1'
      }
      const message: CherryUIMessage = { ...assistantMessage, metadata: { parentId: 'user-1' } }
      const error = queued
        ? { name: 'Error', message: 'context window exceeded', stack: null }
        : { name: 'Error', message: 'invalid_api_key', statusCode: 401, stack: null }
      const emitError = (attemptId = execution.attemptId, userMessageId = queued ? 'user-1' : undefined) => {
        mocks.streamListeners
          .get('ai.stream.error')
          ?.forEach((listener) =>
            listener({ topicId: 'agent-session:session-1', ...execution, attemptId, userMessageId, error })
          )
      }
      const emitPassiveErrors = () => {
        for (let attemptId = 100; attemptId < 356; attemptId++) emitError(attemptId, 'other-window-user')
      }
      await act(async () => emitPassiveErrors())
      expect(toast.getToastQueue().toasts).toEqual([])
      let send!: Promise<boolean>
      await act(async () => {
        send = result.current.sendMessage(
          { text: 'ordinary message' },
          queued
            ? {
                body: {
                  agentId: 'agent-1',
                  sessionId: 'session-1',
                  userMessageParts: [{ type: 'file', mediaType: 'text/plain', url: 'file:///fixture.txt' }]
                }
              }
            : undefined
        )
      })
      if (beforeAck) {
        await act(async () => emitError())
        expect(toast.getToastQueue().toasts).toEqual([])
      }
      const ack: AiStreamOpenResponse = queued
        ? {
            mode: 'injected',
            activeExecutions: beforeAck ? [] : [{ ...execution, attemptId: 1, anchorMessageId: 'old-assistant' }],
            reservedMessages: [{ id: 'user-1', role: 'user', parts: [] }]
          }
        : { mode: 'started', activeExecutions: [execution], reservedMessages: [message] }
      await act(async () => {
        acknowledge(ack)
        expect(await send).toBe(true)
      })
      if (!beforeAck)
        await act(async () => {
          emitPassiveErrors()
          emitError()
        })
      await waitFor(() => expect(toast.getToastQueue().toasts).toHaveLength(1))
      const notification = toast.getToastQueue().toasts[0]
      expect(notification).toMatchObject({ key: 'error:agent-session:session-1:assistant-1', type: 'warning' })
      expect(notification.details).toContain(error.message)
      expect(notification.action).toBeDefined()
      if (queued) {
        mocks.streamOpen.mockResolvedValueOnce({ mode: 'blocked', reason: 'paused' })
        await act(async () => notification.action!.onClick())
        expect(mocks.streamOpen).toHaveBeenLastCalledWith(
          expect.objectContaining({
            userMessageParts: [{ type: 'text', text: '/compact' }]
          })
        )
      }
      toast.closeToast(notification.key)
      await act(async () => {
        mocks.controllerOptions.mock.lastCall?.[0]?.onAccepted(ack)
        emitError()
        mocks.useExecutionOverlay.mock.lastCall?.[3]?.onFinish(execution.executionId, {
          attemptId: execution.attemptId,
          message: { ...message, parts: [{ type: 'data-error', data: error }] },
          isError: true,
          isAbort: false
        })
        if (queued) emitError(3)
      })
      expect(toast.getToastQueue().toasts).toEqual([])
    }
  )

  it.each(['success', 'paused', 'scope-change'] as const)(
    'releases queued-message ownership after %s',
    async (outcome) => {
      const topicId = 'agent-session:session-1'
      const { result, rerender } = renderHook(({ scope }) => useConversationErrorToasts(scope), {
        initialProps: { scope: topicId }
      })
      const identity = {
        topicId,
        executionId: 'provider::model',
        userMessageId: 'queued-user',
        anchorMessageId: 'queued-assistant'
      }
      await act(async () => {
        result.current.track([], [{ id: 'queued-user', role: 'user', parts: [] }])
      })
      if (outcome === 'scope-change') {
        rerender({ scope: 'agent-session:session-2' })
        rerender({ scope: topicId })
      } else {
        await act(async () => {
          mocks.streamListeners
            .get('ai.stream.done')
            ?.forEach((listener) => listener({ ...identity, attemptId: 2, status: outcome }))
        })
      }
      await act(async () => {
        mocks.streamListeners.get('ai.stream.error')?.forEach((listener) =>
          listener({
            ...identity,
            attemptId: 3,
            error: { name: 'Error', message: 'context window exceeded', stack: null }
          })
        )
      })
      expect(toast.getToastQueue().toasts).toEqual([])
    }
  )

  it.each<{ dismissed: boolean; blocked: boolean; afterAck?: boolean }>([
    { dismissed: false, blocked: false },
    { dismissed: true, blocked: false },
    { dismissed: false, blocked: true },
    { dismissed: true, blocked: true },
    { dismissed: false, blocked: false, afterAck: true },
    { dismissed: true, blocked: false, afterAck: true }
  ])(
    'keeps compact startup feedback in its recovery toast ($dismissed, $blocked, $afterAck)',
    async ({ dismissed, blocked, afterAck }) => {
      const { useConversationTurnController } = await vi.importActual<typeof TurnControllerModule>(
        '@renderer/hooks/useConversationTurnController'
      )
      mocks.controllerOptions.mockImplementation(useConversationTurnController)
      mocks.streamOpen.mockRejectedValueOnce(new Error('context window exceeded'))
      const { result } = renderHook(() =>
        useAgentChatRuntimeState({
          sessionId: 'session-1',
          agentType: 'claude-code',
          sessionMessagesEnabled: true,
          reservedMessages: []
        })
      )
      await act(async () => {
        expect(await result.current.sendMessage({ text: 'ordinary message' })).toBe(false)
      })
      const original = toast.getToastQueue().toasts[0]
      expect(original.action).toBeDefined()
      let finishStartup!: () => void
      const execution: ActiveExecution = {
        executionId: 'provider::model',
        attemptId: 2,
        anchorMessageId: 'assistant-1'
      }
      if (afterAck) {
        mocks.streamOpen.mockResolvedValueOnce({
          mode: 'started',
          activeExecutions: [execution],
          reservedMessages: [assistantMessage]
        })
        mocks.seedReservedMessages.mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              finishStartup = () => reject(new Error('compact startup failed'))
            })
        )
      } else {
        mocks.streamOpen.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finishStartup = () =>
                blocked
                  ? resolve({ mode: 'blocked', reason: 'agent-session-workspace', message: 'compact startup failed' })
                  : reject(new Error('compact startup failed'))
            })
        )
      }
      let recovery!: Promise<void>
      await act(async () => {
        recovery = Promise.resolve(original.action!.onClick())
      })
      await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledTimes(2))
      expect(toast.getToastQueue().toasts[0]).toMatchObject({ key: original.key, type: 'loading' })
      if (dismissed) toast.closeToast(original.key)
      await act(async () => {
        finishStartup()
        await recovery
        if (afterAck) {
          mocks.streamListeners.get('ai.stream.error')?.forEach((listener) =>
            listener({
              topicId: 'agent-session:session-1',
              ...execution,
              error: { name: 'Error', message: 'late compact failure', stack: null }
            })
          )
        }
      })

      if (dismissed) expect(toast.getToastQueue().toasts).toEqual([])
      else {
        expect(toast.getToastQueue().toasts).toEqual([
          expect.objectContaining({
            key: original.key,
            type: 'error',
            title: expect.stringContaining('compact startup failed')
          })
        ])
      }
      expect(mocks.toastError).not.toHaveBeenCalled()
      mocks.streamOpen.mockRejectedValueOnce(new Error('manual compact failed'))
      await act(async () => {
        expect(await result.current.sendMessage({ text: '/compact' })).toBe(false)
      })
      expect(toast.getToastQueue().toasts).toEqual([
        expect.objectContaining({ type: 'error', title: expect.stringContaining('manual compact failed') })
      ])
    }
  )

  it.each<{
    beforeAck: boolean
    outcome: 'success' | 'error' | 'paused'
    cleanup?: 'dismiss' | 'switch'
    overlay?: boolean
    queued?: boolean
  }>([
    { beforeAck: true, outcome: 'success' },
    { beforeAck: true, outcome: 'error' },
    { beforeAck: true, outcome: 'paused' },
    { beforeAck: false, outcome: 'success' },
    { beforeAck: false, outcome: 'error' },
    { beforeAck: false, outcome: 'paused' },
    { beforeAck: true, outcome: 'error', overlay: true },
    { beforeAck: false, outcome: 'error', cleanup: 'dismiss' },
    { beforeAck: true, outcome: 'error', cleanup: 'switch' },
    { beforeAck: true, outcome: 'error', queued: true },
    { beforeAck: false, outcome: 'success', queued: true },
    { beforeAck: false, outcome: 'error', cleanup: 'dismiss', queued: true }
  ])(
    'settles compact recovery from its terminal event ($beforeAck, $outcome, $cleanup, $overlay, queued: $queued)',
    async ({ beforeAck, outcome, cleanup, overlay, queued }) => {
      const { useConversationTurnController } = await vi.importActual<typeof TurnControllerModule>(
        '@renderer/hooks/useConversationTurnController'
      )
      mocks.controllerOptions.mockImplementation(useConversationTurnController)
      mocks.useChatWithHistory.mockReturnValue({ ...mocks.useChatWithHistory(), activeExecutions: [] })
      mocks.streamOpen.mockRejectedValueOnce(new Error('context window exceeded'))
      const { result, rerender, unmount } = renderHook(
        ({ sessionId }) =>
          useAgentChatRuntimeState({
            sessionId,
            agentType: 'claude-code',
            sessionMessagesEnabled: true,
            reservedMessages: []
          }),
        { initialProps: { sessionId: 'session-1' } }
      )
      await act(async () => {
        await result.current.sendMessage({ text: 'ordinary message' })
      })
      const original = toast.getToastQueue().toasts[0]
      const execution: ActiveExecution = { executionId: 'provider::model', attemptId: 2, anchorMessageId: 'compact' }
      let acknowledge!: (ack: AiStreamOpenResponse) => void
      mocks.streamOpen.mockImplementationOnce(() => new Promise((resolve) => (acknowledge = resolve)))
      let recovery!: Promise<void>
      await act(async () => {
        recovery = Promise.resolve(original.action!.onClick())
      })
      await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledTimes(2))
      if (cleanup === 'dismiss') toast.closeToast(original.key)
      if (cleanup === 'switch') rerender({ sessionId: 'session-2' })
      const emit = (event: string, payload: unknown) => {
        mocks.streamListeners.get(event)?.forEach((listener) => listener(payload))
      }
      const error = { name: 'Error', message: 'compact execution failed', stack: null }
      const finish = () => {
        if (overlay) {
          mocks.useExecutionOverlay.mock.lastCall?.[3]?.onFinish(execution.executionId, {
            attemptId: execution.attemptId,
            message: { id: 'compact', role: 'assistant', parts: [{ type: 'data-error', data: error }] },
            isError: true,
            isAbort: false
          })
          return
        }
        emit(outcome === 'error' ? 'ai.stream.error' : 'ai.stream.done', {
          topicId: 'agent-session:session-1',
          ...execution,
          ...(queued ? { userMessageId: 'compact-user' } : {}),
          ...(outcome === 'error' ? { error } : { status: outcome })
        })
      }
      await act(async () => {
        emit('ai.stream.done', { topicId: 'other-session', ...execution, status: 'success' })
        emit('ai.stream.done', { topicId: 'agent-session:session-1', ...execution, attemptId: 1, status: 'success' })
        if (beforeAck) finish()
      })
      if (!cleanup) expect(toast.getToastQueue().toasts[0]).toMatchObject({ key: original.key, type: 'loading' })
      await act(async () => {
        acknowledge(
          queued
            ? {
                mode: 'injected',
                activeExecutions: [],
                reservedMessages: [{ id: 'compact-user', role: 'user', parts: [] }]
              }
            : { mode: 'started', activeExecutions: [execution] }
        )
      })
      if (!beforeAck) {
        if (!cleanup) expect(toast.getToastQueue().toasts[0]).toMatchObject({ key: original.key, type: 'loading' })
        await act(async () => finish())
      }
      await waitFor(() => expect(toast.getToastQueue().toasts[0]?.type).not.toBe('loading'))
      await recovery
      if (cleanup || outcome === 'paused') expect(toast.getToastQueue().toasts).toEqual([])
      else {
        expect(toast.getToastQueue().toasts).toEqual([
          expect.objectContaining({ key: original.key, type: outcome === 'error' ? 'error' : 'success' })
        ])
        if (outcome === 'error') expect(toast.getToastQueue().toasts[0].title).toContain('compact execution failed')
      }
      unmount()
      expect([...mocks.streamListeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
    }
  )

  it('settles concurrent model retries independently through the shared recovery waiter', async () => {
    const executions: ActiveExecution[] = [
      { executionId: 'provider::a', attemptId: 3 },
      { executionId: 'provider::b', attemptId: 4 }
    ]
    const { result } = renderHook(() =>
      useConversationErrorToasts('topic-1', {
        retry: async (_message, modelId) => {
          result.current.track(executions.filter((execution) => execution.executionId === modelId))
        }
      })
    )
    for (const execution of executions) {
      await act(async () => {
        const message: CherryUIMessage = {
          ...assistantMessage,
          id: execution.executionId,
          metadata: { parentId: 'user-1' }
        }
        const failedExecution = { ...execution, attemptId: execution.attemptId - 2, anchorMessageId: message.id }
        mocks.streamListeners.get('ai.stream.error')?.forEach((listener) =>
          listener({
            topicId: 'topic-1',
            ...failedExecution,
            error: { name: 'Error', message: 'fetch failed', stack: null }
          })
        )
        result.current.track([failedExecution], [message])
      })
    }
    const originals = [...toast.getToastQueue().toasts]
    const recoveries: Promise<void>[] = []
    for (const original of originals) {
      await act(async () => {
        recoveries.push(Promise.resolve(original.action!.onClick()))
      })
    }
    expect(toast.getToastQueue().toasts.map(({ type }) => type)).toEqual(['loading', 'loading'])
    await act(async () => {
      mocks.streamListeners
        .get('ai.stream.done')
        ?.forEach((listener) => listener({ topicId: 'topic-1', ...executions[1], status: 'success' }))
      await recoveries[1]
    })
    expect(toast.getToastQueue().toasts.map(({ key, type }) => ({ key, type }))).toEqual([
      { key: originals[0].key, type: 'loading' },
      { key: originals[1].key, type: 'success' }
    ])
    await act(async () => {
      mocks.streamListeners.get('ai.stream.error')?.forEach((listener) =>
        listener({
          topicId: 'topic-1',
          ...executions[0],
          error: { name: 'Error', message: 'retry failed', stack: null }
        })
      )
      await recoveries[0]
    })
    expect(toast.getToastQueue().toasts.map(({ key, type }) => ({ key, type }))).toEqual([
      { key: originals[0].key, type: 'error' },
      { key: originals[1].key, type: 'success' }
    ])
  })

  it('reads a live manual Agent answer while excluding autonomous turns', async () => {
    const spoken: string[] = []
    const coordinator = new AutoReadService({
      supportsStreaming: async () => true,
      playback: {
        start: async (input) => {
          spoken.push(input.text)
          return { status: 'started' }
        },
        stopAutoRead: async () => true
      }
    })
    mocks.autoReadUpdate.mockImplementation((input) => coordinator.update(input))
    renderHook(() =>
      useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
    )
    const onUpdate = mocks.useExecutionOverlay.mock.calls[0]?.[3]?.onUpdate
    await act(async () => {
      onUpdate?.('provider::model', {
        attemptId: 8,
        message: {
          ...assistantMessage,
          id: 'background',
          parts: [{ type: 'text', text: 'Background.' }],
          metadata: { turnOrigin: { kind: 'background-work' } }
        }
      })
      onUpdate?.('provider::model', {
        attemptId: 9,
        message: {
          ...assistantMessage,
          id: 'manual',
          parts: [
            { type: 'reasoning', text: 'Secret.' },
            { type: 'text', text: 'Manual answer. ' }
          ]
        }
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(spoken).toEqual(['Manual answer.'])
    await coordinator.setEnabled(true)
    await coordinator.setEnabled(false)
  })

  it('wires auto-read to overlay finish without taking over the terminal refresh handoff', () => {
    renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    const onFinish = mocks.useExecutionOverlay.mock.calls[0]?.[3]?.onFinish
    expect(onFinish).toEqual(expect.any(Function))
    const completed = {
      ...assistantMessage,
      parts: [{ type: 'text', text: 'final answer' }]
    } as CherryUIMessage
    act(() => {
      onFinish?.('provider::model', {
        attemptId: 4,
        message: completed,
        isAbort: false,
        isError: false
      })
    })

    expect(mocks.autoReadConsume).toHaveBeenCalledWith({
      enabled: true,
      message: completed,
      attemptId: 4,
      isAbort: false,
      isError: false,
      eligible: true
    })
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.disposeOverlay).not.toHaveBeenCalled()
  })

  it.each(['goal-round', 'background-work'] as const)('skips %s autonomous turns for auto-read', (kind) => {
    const autonomous = {
      ...assistantMessage,
      parts: [{ type: 'text', text: 'background result' }],
      metadata: {
        ...assistantMessage.metadata,
        turnOrigin: kind === 'goal-round' ? { kind, round: 2 } : { kind }
      }
    } as CherryUIMessage
    mocks.useAgentSessionParts.mockReturnValue({
      messages: [autonomous],
      persistedPartsByMessageId: {},
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: mocks.refresh,
      seedReservedMessages: mocks.seedReservedMessages,
      deleteMessage: mocks.deleteSessionMessage
    })
    renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )
    const onFinish = mocks.useExecutionOverlay.mock.calls[0]?.[3]?.onFinish

    act(() => {
      onFinish?.('provider::model', {
        attemptId: 9,
        message: { ...autonomous, metadata: undefined } as CherryUIMessage,
        isAbort: false,
        isError: false
      })
    })

    expect(mocks.autoReadConsume).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ id: autonomous.id }), eligible: false })
    )
  })

  it.each(['goal-round', 'background-work', 'manual'] as const)(
    'uses live turn origin for %s before history loads',
    (kind) => {
      mocks.useAgentSessionParts.mockReturnValue({
        ...mocks.useAgentSessionParts.getMockImplementation()!(),
        messages: [],
        isLoading: true
      })
      renderHook(() =>
        useAgentChatRuntimeState({ sessionId: 'session-1', sessionMessagesEnabled: true, reservedMessages: [] })
      )
      MockCacheUtils.setInitialState({
        shared: [
          [
            AGENT_SESSION_TURN_ORIGIN_CACHE_KEY('session-1', assistantMessage.id),
            kind === 'manual' ? null : kind === 'goal-round' ? { kind, round: 2 } : { kind }
          ],
          [AGENT_SESSION_TURN_ORIGIN_CACHE_KEY('another-session', assistantMessage.id), { kind: 'background-work' }]
        ]
      })
      const onFinish = mocks.useExecutionOverlay.mock.calls[0]?.[3]?.onFinish
      act(() => {
        onFinish?.('provider::model', {
          attemptId: 9,
          message: { ...assistantMessage, metadata: undefined },
          isAbort: false,
          isError: false
        })
      })

      expect(mocks.autoReadConsume).toHaveBeenCalledWith(expect.objectContaining({ eligible: kind === 'manual' }))
    }
  )

  it('invalidates disclosure state after deleting a session message', async () => {
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    await act(async () => {
      await result.current.deleteMessage('assistant-1')
    })

    expect(mocks.deleteSessionMessage).toHaveBeenCalledWith('assistant-1')
    expect(mocks.invalidateMessages).toHaveBeenCalledWith(['assistant-1'])
  })

  it('merges live assistant metadata into displayed session messages', () => {
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: {},
      liveAssistants: [
        {
          ...assistantMessage,
          metadata: {
            ...assistantMessage.metadata,
            totalTokens: 256
          }
        } as CherryUIMessage
      ],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })

    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    expect(result.current.uiMessages[0]?.metadata?.totalTokens).toBe(256)
  })

  it('keeps the history contract and composer callback stable across stream snapshots', () => {
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: { 'assistant-1': [{ type: 'text', text: 'a' }] },
      liveAssistants: [{ ...assistantMessage, parts: [{ type: 'text', text: 'a' }] } as CherryUIMessage],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })
    const { result, rerender } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )
    const streamingLayers = result.current.streamingLayers
    const sendMessage = result.current.sendMessage

    mocks.useExecutionOverlay.mockReturnValue({
      overlay: { 'assistant-1': [{ type: 'text', text: 'ab' }] },
      liveAssistants: [{ ...assistantMessage, parts: [{ type: 'text', text: 'ab' }] } as CherryUIMessage],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })
    rerender()

    expect(result.current.streamingLayers).toBe(streamingLayers)
    expect(result.current.streamingLayers.liveMessageIds).toEqual(['assistant-1'])
    expect(result.current.sendMessage).toBe(sendMessage)
  })

  it('stores AskUserQuestion submitted input as a temporary tool input', async () => {
    const part = makeAskUserQuestionPart()
    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
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
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    await act(async () => {
      await expect(result.current.respondToolApproval(makeAskUserQuestionApproval(part))).rejects.toThrow('ipc boom')
    })

    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({})
  })

  it('preserves optimistic AskUserQuestion inputs across an <Activity> hide/show and clears them on session change', async () => {
    latestRuntime = null
    const part = makeAskUserQuestionPart()
    const view = render(<ActivityHarness mode="visible" sessionId="session-1" />)

    await act(async () => {
      await currentRuntime().respondToolApproval(makeAskUserQuestionApproval(part))
    })
    expect(currentRuntime().optimisticAskUserQuestionInputsByToolCallId).toEqual({
      'call-ask': askUserQuestionUpdatedInput
    })

    // Same session hidden→visible: effects re-run with an unchanged topic id,
    // and the submitted input must survive the tab switch.
    view.rerender(<ActivityHarness mode="hidden" sessionId="session-1" />)
    view.rerender(<ActivityHarness mode="visible" sessionId="session-1" />)
    expect(currentRuntime().optimisticAskUserQuestionInputsByToolCallId).toEqual({
      'call-ask': askUserQuestionUpdatedInput
    })

    // Actual session change: the stale input must be dropped.
    view.rerender(<ActivityHarness mode="visible" sessionId="session-2" />)
    expect(currentRuntime().optimisticAskUserQuestionInputsByToolCallId).toEqual({})
  })

  it('evicts the AskUserQuestion draft cache only when the persisted part settles the answers', async () => {
    MockCacheUtils.resetMocks()
    writeAskUserQuestionDraftCache('approval-ask', {
      selectedAnswers: { 0: ['Winston'] },
      customAnswers: {},
      currentIndex: 0
    })
    const { result, rerender } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    await act(async () => {
      await result.current.respondToolApproval(makeAskUserQuestionApproval())
    })

    // The dispatch ack lands before the assistant row is durably persisted, so
    // the draft must still be readable for a remount in that window.
    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({
      'call-ask': askUserQuestionUpdatedInput
    })
    expect(readAskUserQuestionDraftCache('approval-ask').selectedAnswers[0]).toEqual(['Winston'])

    const liveAnswer = makeAskUserQuestionPart({ state: 'output-available', input: askUserQuestionUpdatedInput })
    mocks.useAgentSessionParts.mockReturnValue({
      ...mocks.useAgentSessionParts(),
      messages: [{ ...assistantMessage, parts: [liveAnswer] }],
      persistedPartsByMessageId: { 'assistant-1': [makeAskUserQuestionPart()] }
    })
    mocks.useExecutionOverlay.mockReturnValue({
      ...mocks.useExecutionOverlay(),
      overlay: { 'assistant-1': [liveAnswer] }
    })
    rerender()
    expect(readAskUserQuestionDraftCache('approval-ask').selectedAnswers[0]).toEqual(['Winston'])

    // Only the database update allows the draft to be retired.
    mocks.useAgentSessionParts.mockReturnValue({
      messages: [
        {
          ...assistantMessage,
          parts: [makeAskUserQuestionPart({ state: 'approval-responded', input: askUserQuestionUpdatedInput })]
        }
      ],
      persistedPartsByMessageId: {
        'assistant-1': [makeAskUserQuestionPart({ state: 'approval-responded', input: askUserQuestionUpdatedInput })]
      },
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: mocks.refresh,
      seedReservedMessages: mocks.seedReservedMessages,
      deleteMessage: mocks.deleteSessionMessage
    })
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: {},
      liveAssistants: [],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })
    await act(async () => {
      rerender()
    })

    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({})
    expect(readAskUserQuestionDraftCache('approval-ask')).toEqual({
      selectedAnswers: {},
      customAnswers: {},
      currentIndex: 0
    })
  })

  it('evicts the AskUserQuestion draft cache from persisted parts after a remount or session change', async () => {
    // The settlement happened in a previous mount/session, so this mount never
    // dispatched the approval and holds no optimistic ids to sweep from.
    mocks.useExecutionOverlay.mockReturnValue({
      overlay: {},
      liveAssistants: [],
      disposeOverlay: mocks.disposeOverlay,
      reset: mocks.resetOverlay
    })
    mocks.useAgentSessionParts.mockReturnValue({
      messages: [
        {
          ...assistantMessage,
          parts: [makeAskUserQuestionPart({ state: 'approval-responded', input: askUserQuestionUpdatedInput })]
        }
      ],
      persistedPartsByMessageId: {
        'assistant-1': [makeAskUserQuestionPart({ state: 'approval-responded', input: askUserQuestionUpdatedInput })]
      },
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: mocks.refresh,
      seedReservedMessages: mocks.seedReservedMessages,
      deleteMessage: mocks.deleteSessionMessage
    })
    writeAskUserQuestionDraftCache('approval-ask', {
      selectedAnswers: { 0: ['Winston'] },
      customAnswers: {},
      currentIndex: 0
    })

    const { result } = renderHook(() =>
      useAgentChatRuntimeState({
        sessionId: 'session-1',
        sessionMessagesEnabled: true,
        reservedMessages: []
      })
    )

    expect(result.current.optimisticAskUserQuestionInputsByToolCallId).toEqual({})
    expect(readAskUserQuestionDraftCache('approval-ask')).toEqual({
      selectedAnswers: {},
      customAnswers: {},
      currentIndex: 0
    })
  })
})
