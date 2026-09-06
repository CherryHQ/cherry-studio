import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invalidateMessages, loggerError, streamOpen } = vi.hoisted(() => ({
  invalidateMessages: vi.fn(),
  loggerError: vi.fn(),
  streamOpen: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({ dataApiService: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: loggerError }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => streamOpen(input) }
}))
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { settings: {} } })
}))
vi.mock('@renderer/services/messageUiStateCache', () => ({
  invalidateCachedMessageUiStates: invalidateMessages
}))

import type { Topic } from '@renderer/types/topic'

import { useChatWriteActions } from '../useChatWriteActions'

function makeCache() {
  return {
    branchWithoutIds: vi.fn((prev: unknown) => prev),
    seedOptimisticBranch: vi.fn(async () => {}),
    seedReservedMessages: vi.fn(async () => {}),
    patchMessageInBranch: vi.fn(),
    rollbackBranch: vi.fn(async () => {}),
    deleteMessageTrigger: vi.fn(async () => ({ deletedIds: [] })),
    deleteMessageGroupTrigger: vi.fn(async () => ({ deletedIds: [] })),
    patchMessageTrigger: vi.fn(async () => {}),
    createSiblingTrigger: vi.fn(async () => ({})),
    createMessageTrigger: vi.fn(async () => ({})),
    setActiveNodeTrigger: vi.fn(async () => ({}))
  } as unknown as Parameters<typeof useChatWriteActions>[0]['cache']
}

const uiMsg = (
  id: string,
  role: string,
  parentId: string | null,
  isContextBoundary = false,
  status = 'success'
): any => ({
  id,
  role,
  parts: isContextBoundary ? [{ type: 'data-clear', data: {} }] : [],
  metadata: { parentId, status }
})

function renderActions(
  uiMessages: ReturnType<typeof uiMsg>[],
  cache = makeCache(),
  activeNodeId = uiMessages.at(-1)?.id ?? null,
  startNewContextBlocked = false,
  stop: () => Promise<void> = vi.fn(async () => {})
) {
  const scrollToBottom = vi.fn()
  const regenerate = vi.fn<Parameters<typeof useChatWriteActions>[0]['regenerate']>(async () => {})
  const setMessages = vi.fn()
  const seedReservedMessages = vi.fn(async () => {})
  const { result } = renderHook(() =>
    useChatWriteActions({
      topic: { id: 't1' } as Topic,
      uiMessages,
      activeNodeId,
      regenerate,
      setMessages,
      stop,
      refresh: vi.fn(async () => []),
      cache,
      seedReservedMessages,
      scrollToBottom,
      startNewContextBlocked
    })
  )
  return {
    actions: result.current.actions,
    result,
    cache,
    scrollToBottom,
    regenerate,
    seedReservedMessages
  }
}

describe('useChatWriteActions — pause', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logs a failed stream stop instead of exposing a rejected pause callback', async () => {
    const stopError = new Error('abort failed')
    const stop = vi.fn<() => Promise<void>>().mockRejectedValueOnce(stopError)
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot')], makeCache(), 'u1', false, stop)

    const pauseResult = actions.pause() as unknown
    if (pauseResult instanceof Promise) await expect(pauseResult).rejects.toBe(stopError)

    expect(pauseResult).toBeUndefined()
    await vi.waitFor(() =>
      expect(loggerError).toHaveBeenCalledWith('Failed to pause chat stream', { topicId: 't1', error: stopError })
    )
  })
})

function clearMessage() {
  return {
    id: 'clear-1',
    topicId: 't1',
    parentId: 'u1',
    role: 'user',
    data: { parts: [{ type: 'data-clear', data: {} }] },
    searchableText: '',
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    messageSnapshot: null,
    stats: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('useChatWriteActions — clear context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when the topic has no active message', async () => {
    const { actions, cache, scrollToBottom } = renderActions([], makeCache(), null)

    expect(actions.canStartNewContext).toBe(false)
    await actions.startNewContext()

    expect(cache.createMessageTrigger).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
    expect(scrollToBottom).not.toHaveBeenCalled()
  })

  it('creates a clear marker under the active message without publishing it as a streaming live node', async () => {
    const cache = makeCache()
    vi.mocked(cache.createMessageTrigger).mockResolvedValueOnce(clearMessage() as never)
    const seedReservedMessages = vi.fn(async () => {})
    const scrollToBottom = vi.fn()
    const { result } = renderHook(() =>
      useChatWriteActions({
        topic: { id: 't1' } as Topic,
        uiMessages: [uiMsg('u1', 'user', 'vroot')],
        activeNodeId: 'u1',
        regenerate: vi.fn(async () => {}),
        setMessages: vi.fn(),
        stop: vi.fn(async () => {}),
        refresh: vi.fn(async () => []),
        cache,
        seedReservedMessages,
        scrollToBottom,
        startNewContextBlocked: false
      })
    )

    await act(async () => {
      await result.current.actions.startNewContext()
    })

    expect(cache.createMessageTrigger).toHaveBeenCalledWith({
      params: { topicId: 't1' },
      body: {
        parentId: 'u1',
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'data-clear', data: {} }] }
      }
    })
    expect(cache.seedReservedMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'clear-1',
        role: 'user',
        parts: [{ type: 'data-clear', data: {} }],
        metadata: expect.objectContaining({ parentId: 'u1', status: 'success' })
      })
    ])
    expect(seedReservedMessages).not.toHaveBeenCalled()
    expect(scrollToBottom).toHaveBeenCalledOnce()
  })

  it('does not start while the shared write gate is blocked', async () => {
    const { actions, cache } = renderActions([uiMsg('u1', 'user', 'vroot')], makeCache(), 'u1', true)

    expect(actions.canStartNewContext).toBe(false)
    await act(async () => {
      await actions.startNewContext()
    })

    expect(cache.createMessageTrigger).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('removes the active clear marker without cascading and rolls the cache forward immediately', async () => {
    const { actions, cache, scrollToBottom } = renderActions([
      uiMsg('u1', 'user', 'vroot'),
      uiMsg('clear-1', 'user', 'u1', true)
    ])

    await act(async () => {
      await actions.startNewContext()
    })

    expect(cache.seedOptimisticBranch).toHaveBeenCalledOnce()
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({
      params: { id: 'clear-1' },
      query: { cascade: false }
    })
    expect(scrollToBottom).toHaveBeenCalledOnce()
  })

  it('rolls back a failed create and leaves the viewport unchanged', async () => {
    const cache = makeCache()
    const error = new Error('create failed')
    vi.mocked(cache.createMessageTrigger).mockRejectedValueOnce(error)
    const { actions, scrollToBottom } = renderActions([uiMsg('u1', 'user', 'vroot')], cache)

    await act(async () => {
      await expect(actions.startNewContext()).rejects.toBe(error)
    })

    expect(cache.rollbackBranch).toHaveBeenCalledOnce()
    expect(scrollToBottom).not.toHaveBeenCalled()
  })

  it('rolls back a failed undo', async () => {
    const cache = makeCache()
    const error = new Error('delete failed')
    vi.mocked(cache.deleteMessageTrigger).mockRejectedValueOnce(error)
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot'), uiMsg('clear-1', 'user', 'u1', true)], cache)

    await act(async () => {
      await expect(actions.startNewContext()).rejects.toBe(error)
    })

    expect(cache.rollbackBranch).toHaveBeenCalledOnce()
  })

  it('shares one in-flight operation across repeated clicks', async () => {
    const cache = makeCache()
    let resolveCreate!: (value: ReturnType<typeof clearMessage>) => void
    vi.mocked(cache.createMessageTrigger).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as typeof resolveCreate
        }) as never
    )
    const { actions, result } = renderActions([uiMsg('u1', 'user', 'vroot')], cache)

    expect(result.current.actions.canStartNewContext).toBe(true)
    let first!: Promise<void>
    act(() => {
      first = actions.startNewContext()
    })
    const second = actions.startNewContext()

    expect(first).toBe(second)
    expect(cache.createMessageTrigger).toHaveBeenCalledOnce()
    expect(result.current.actions.canStartNewContext).toBe(false)

    await act(async () => {
      resolveCreate(clearMessage())
      await first
    })
    expect(result.current.actions.canStartNewContext).toBe(true)
  })
})

describe('useChatWriteActions — first-turn delete', () => {
  beforeEach(() => vi.clearAllMocks())

  // vroot → u1(user) → a1(assistant). rootId = 'vroot'.
  const tree = () => [uiMsg('u1', 'user', 'vroot'), uiMsg('a1', 'assistant', 'u1')]

  it('treats the first turn like any other loaded message', () => {
    const { actions } = renderActions(tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: true })
    expect(actions.getMessageDeleteAvailability('a1')).toEqual({ enabled: true })
  })

  it('splices a first-turn message onto the virtual root without cascading', async () => {
    const cache = makeCache()
    const { actions } = renderActions(tree(), cache)

    await actions.deleteMessage('u1')

    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'u1' }, query: { cascade: false } })
    expect(invalidateMessages).toHaveBeenCalledWith(['u1'])
  })

  it('accepts a multi-select plan containing the first turn', async () => {
    const cache = makeCache()
    const { actions } = renderActions(tree(), cache)

    await actions.deleteMessage('a1', { selectedMessageIds: ['u1', 'a1'] })

    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
  })

  it('rejects a multi-select plan containing a generating message before any write', async () => {
    const cache = makeCache()
    const messages = [uiMsg('u1', 'user', 'vroot'), uiMsg('a1', 'assistant', 'u1', false, 'pending')]
    const { actions } = renderActions(messages, cache)

    await expect(actions.deleteMessage('u1', { selectedMessageIds: ['u1', 'a1'] })).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('splices a deeper (non-first-turn) message', async () => {
    const { actions, cache } = renderActions(tree())
    await actions.deleteMessage('a1', { selectedMessageIds: ['a1'] })
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
    expect(invalidateMessages).toHaveBeenCalledWith(['a1'])
  })

  it('rejects a single-message deletion through shared availability while it is generating', async () => {
    const cache = makeCache()
    const { actions } = renderActions([uiMsg('a1', 'assistant', 'u1', false, 'pending')], cache)

    expect(actions.getMessageDeleteAvailability('a1')).toEqual({ enabled: false, reason: 'generating' })
    await expect(actions.deleteMessage('a1')).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('does not couple deletion availability to root metadata loading', async () => {
    const { actions, cache } = renderActions(tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: true })
    await actions.deleteMessage('u1')
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'u1' }, query: { cascade: false } })
  })

  it('rejects group deletion when any reply is outside the loaded page', async () => {
    const cache = makeCache()
    const { actions } = renderActions([uiMsg('a1', 'assistant', 'u1')], cache)

    expect(actions.getMessageDeleteAvailability('missing')).toEqual({
      enabled: false,
      reason: 'not-loaded'
    })
    await expect(actions.deleteMessageGroup(['a1', 'missing'])).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageGroupTrigger).not.toHaveBeenCalled()
  })

  it('splices multi-model replies without deleting their user-message parent', async () => {
    const cache = makeCache()
    vi.mocked(cache.deleteMessageGroupTrigger).mockResolvedValueOnce({ deletedIds: ['a1', 'a2'] })
    const messages = [...tree(), uiMsg('a2', 'assistant', 'u1')]
    const { actions } = renderActions(messages, cache)

    await actions.deleteMessageGroup(['a1', 'a2'])

    expect(cache.deleteMessageGroupTrigger).toHaveBeenCalledWith({ params: { id: 'a1' } })
    expect(cache.seedOptimisticBranch).toHaveBeenCalledTimes(2)
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
    expect(invalidateMessages).toHaveBeenCalledWith(['a1', 'a2'])
  })

  it('reconciles optimistic state with the authoritative deleted ids', async () => {
    const cache = makeCache()
    vi.mocked(cache.deleteMessageGroupTrigger).mockResolvedValueOnce({ deletedIds: ['a1-old', 'a1', 'a2'] })
    const messages = [...tree(), uiMsg('a2', 'assistant', 'u1')]
    const { actions } = renderActions(messages, cache)

    await actions.deleteMessageGroup(['a1', 'a2'])

    expect(cache.deleteMessageGroupTrigger).toHaveBeenCalledWith({ params: { id: 'a1' } })
    expect(cache.seedOptimisticBranch).toHaveBeenCalledTimes(2)
    const reconcile = vi.mocked(cache.seedOptimisticBranch).mock.calls[1][0]
    reconcile([], 'a1')
    expect(cache.branchWithoutIds).toHaveBeenLastCalledWith([], new Set(['a1-old', 'a1', 'a2']), 'a1')
    expect(invalidateMessages).toHaveBeenCalledWith(['a1-old', 'a1', 'a2'])
  })

  it('rejects group deletion through shared availability while a reply is generating', async () => {
    const cache = makeCache()
    const messages = [uiMsg('a1', 'assistant', 'u1', false, 'pending')]
    const { actions } = renderActions(messages, cache)

    expect(actions.getMessageDeleteAvailability('a1')).toEqual({ enabled: false, reason: 'generating' })
    await expect(actions.deleteMessageGroup(['a1'])).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageGroupTrigger).not.toHaveBeenCalled()
  })
})

describe('useChatWriteActions — edit message', () => {
  beforeEach(() => vi.clearAllMocks())

  it('optimistically patches branch messages and persists edited parts', async () => {
    const editedParts = [{ type: 'text', text: 'edited' }]
    const { actions, cache } = renderActions([uiMsg('m1', 'user', 'vroot')])

    await actions.editMessage('m1', editedParts as any)

    expect(cache.seedOptimisticBranch).toHaveBeenCalledOnce()
    expect(cache.patchMessageTrigger).toHaveBeenCalledWith({
      params: { id: 'm1' },
      body: { data: { parts: editedParts } }
    })
    expect(cache.rollbackBranch).not.toHaveBeenCalled()

    const updateBranch = vi.mocked(cache.seedOptimisticBranch).mock.calls[0][0] as (items: any[]) => any[]
    expect(
      updateBranch([
        {
          message: { id: 'm1', data: { parts: [{ type: 'text', text: 'old' }], role: 'user' } },
          siblingsGroup: [{ id: 'm2', data: { parts: [{ type: 'text', text: 'sibling' }] } }]
        },
        {
          message: { id: 'm3', data: { parts: [{ type: 'text', text: 'other' }] } }
        }
      ])
    ).toEqual([
      {
        message: { id: 'm1', data: { parts: editedParts, role: 'user' } },
        siblingsGroup: [{ id: 'm2', data: { parts: [{ type: 'text', text: 'sibling' }] } }]
      },
      {
        message: { id: 'm3', data: { parts: [{ type: 'text', text: 'other' }] } }
      }
    ])
  })

  it('rolls back the optimistic branch when persisting edited parts fails', async () => {
    const editedParts = [{ type: 'text', text: 'edited' }]
    const error = new Error('patch failed')
    const { actions, cache } = renderActions([uiMsg('m1', 'user', 'vroot')])
    vi.mocked(cache.patchMessageTrigger).mockRejectedValueOnce(error)

    await expect(actions.editMessage('m1', editedParts as any)).rejects.toBe(error)

    expect(cache.seedOptimisticBranch).toHaveBeenCalledOnce()
    expect(cache.patchMessageTrigger).toHaveBeenCalledWith({
      params: { id: 'm1' },
      body: { data: { parts: editedParts } }
    })
    expect(cache.rollbackBranch).toHaveBeenCalledOnce()
  })
})

describe('useChatWriteActions — regenerate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for regeneration to finish', async () => {
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.parts = [{ type: 'text', text: 'answer' }]
    const { actions, regenerate } = renderActions([uiMsg('u1', 'user', 'vroot'), assistantMessage])
    let finishRegenerate: (() => void) | undefined
    regenerate.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRegenerate = resolve)))

    const request = actions.regenerate('a1')

    expect(regenerate).toHaveBeenCalledOnce()

    finishRegenerate?.()
    await request
  })

  it('inherits the persisted turn options when retrying an assistant message', async () => {
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.parts = [{ type: 'text', text: 'answer' }]
    assistantMessage.metadata.turnOptions = { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true }
    const { actions, regenerate } = renderActions([uiMsg('u1', 'user', 'vroot'), assistantMessage])

    await actions.regenerate('a1')

    expect(regenerate).toHaveBeenCalledWith({
      messageId: 'a1',
      body: expect.objectContaining({
        parentAnchorId: 'u1',
        reasoningEffort: 'high',
        serviceTier: 'flex',
        fastMode: true
      })
    })
  })

  it('retries a failed assistant in place through Main and seeds the fresh attempt identity', async () => {
    const failedAssistant = uiMsg('a1', 'assistant', 'u1', false, 'error')
    failedAssistant.metadata.modelId = 'provider::model-a'
    failedAssistant.metadata.turnOptions = { serviceTier: 'fast' }
    failedAssistant.parts = [{ type: 'data-error', data: { message: 'failed' } }]
    const activeExecution = {
      executionId: 'provider::model-a',
      attemptId: 2,
      anchorMessageId: 'a1'
    }
    const reservedMessage = {
      ...failedAssistant,
      parts: [],
      metadata: { ...failedAssistant.metadata, status: 'pending' }
    }
    streamOpen.mockResolvedValueOnce({
      mode: 'started',
      reservedMessages: [reservedMessage],
      activeExecutions: [activeExecution]
    })
    const { actions, regenerate, seedReservedMessages } = renderActions([uiMsg('u1', 'user', 'vroot'), failedAssistant])

    await actions.regenerate('a1')

    expect(regenerate).not.toHaveBeenCalled()
    expect(streamOpen).toHaveBeenCalledWith({
      trigger: 'regenerate-message',
      topicId: 't1',
      parentAnchorId: 'u1',
      retryMessageId: 'a1',
      mentionedModelIds: ['provider::model-a'],
      serviceTier: 'fast'
    })
    expect(seedReservedMessages).toHaveBeenCalledWith([reservedMessage], {
      activeExecutions: [activeExecution],
      preserveActiveNode: undefined
    })
  })

  it('lets Main resolve the current model when retrying a failed assistant without a persisted model', async () => {
    const failedAssistant = uiMsg('a1', 'assistant', 'u1', false, 'error')
    failedAssistant.metadata.modelId = null
    failedAssistant.parts = [{ type: 'data-error', data: { message: 'failed' } }]
    const { actions, regenerate } = renderActions([uiMsg('u1', 'user', 'vroot'), failedAssistant])

    await actions.regenerate('a1')

    expect(streamOpen).not.toHaveBeenCalled()
    expect(regenerate).toHaveBeenCalledWith({
      messageId: 'a1',
      body: expect.objectContaining({ parentAnchorId: 'u1' })
    })
    expect(regenerate.mock.calls[0][0]?.body).not.toHaveProperty('mentionedModels')
  })

  it('lets Main resolve the current model when regenerating a successful assistant response', async () => {
    const nonTextAssistant = uiMsg('a1', 'assistant', 'u1', false, 'success')
    nonTextAssistant.metadata.modelId = 'provider::model-a'
    nonTextAssistant.parts = [{ type: 'data-code', data: { content: 'const ok = true', language: 'ts' } }]
    const { actions, regenerate } = renderActions([uiMsg('u1', 'user', 'vroot'), nonTextAssistant])

    await actions.regenerate('a1')

    expect(streamOpen).not.toHaveBeenCalled()
    expect(regenerate).toHaveBeenCalledWith({
      messageId: 'a1',
      body: expect.objectContaining({ parentAnchorId: 'u1' })
    })
    expect(regenerate.mock.calls[0][0]?.body).not.toHaveProperty('mentionedModels')
  })

  it('routes an explicit @ model through Main so a live reply group can append without moving the branch', async () => {
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.metadata.modelId = 'provider::model-a'
    assistantMessage.parts = [{ type: 'text', text: 'answer in progress' }]
    const reservedMessage = {
      ...uiMsg('a2', 'assistant', 'u1', false, 'pending'),
      metadata: {
        ...uiMsg('a2', 'assistant', 'u1', false, 'pending').metadata,
        modelId: 'provider::model-b'
      }
    }
    const activeExecution = {
      executionId: 'provider::model-b',
      attemptId: 2,
      anchorMessageId: 'a2'
    }
    streamOpen.mockResolvedValueOnce({
      mode: 'started',
      reservedMessages: [reservedMessage],
      activeExecutions: [activeExecution],
      preserveActiveNode: true
    })
    const { actions, regenerate, seedReservedMessages } = renderActions([
      uiMsg('u1', 'user', 'vroot'),
      assistantMessage
    ])

    await actions.regenerate('a1', { modelId: 'provider::model-b' })

    expect(regenerate).not.toHaveBeenCalled()
    expect(streamOpen).toHaveBeenCalledWith({
      trigger: 'regenerate-message',
      topicId: 't1',
      parentAnchorId: 'u1',
      appendToLiveGroupMessageId: 'a1',
      mentionedModelIds: ['provider::model-b']
    })
    expect(seedReservedMessages).toHaveBeenCalledWith([reservedMessage], {
      activeExecutions: [activeExecution],
      preserveActiveNode: true
    })
  })

  it('inherits the active assistant turn options when resending its user message', async () => {
    streamOpen.mockReset()
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.metadata.isActiveBranch = true
    assistantMessage.metadata.turnOptions = { reasoningEffort: 'minimal', serviceTier: 'standard', fastMode: false }
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot'), assistantMessage])

    await actions.resend('u1')

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        parentAnchorId: 'u1',
        reasoningEffort: 'minimal',
        serviceTier: 'standard',
        fastMode: false
      })
    )
    expect(streamOpen.mock.calls[0][0]).not.toHaveProperty('mentionedModelIds')
  })
})

describe('useChatWriteActions — fork and resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamOpen.mockReset()
  })

  function createForkedUser() {
    return {
      id: 'forked-user',
      parentId: 'vroot',
      siblingsGroupId: 1,
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  }

  it('opens a stream after a successful edit-and-resend', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot')], cache)

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any, {
      reasoningEffort: 'high',
      serviceTier: 'flex',
      fastMode: true
    })

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 't1',
        parentAnchorId: 'forked-user',
        reasoningEffort: 'high',
        serviceTier: 'flex',
        fastMode: true
      })
    )
  })

  it('inherits the source turn options when a historical multi-model user message is edited', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const firstAssistant = uiMsg('a1', 'assistant', 'u1')
    firstAssistant.metadata.modelId = 'provider::model-a'
    firstAssistant.metadata.turnOptions = { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true }
    const secondAssistant = uiMsg('a2', 'assistant', 'u1')
    secondAssistant.metadata.modelId = 'provider::model-b'
    secondAssistant.metadata.turnOptions = { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true }
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot'), firstAssistant, secondAssistant], cache)

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedModelIds: ['provider::model-a', 'provider::model-b'],
        reasoningEffort: 'high',
        serviceTier: 'flex',
        fastMode: true
      })
    )
  })

  it('inherits separator-containing raw snapshots as distinct models', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const authoritativeReply = uiMsg('a1', 'assistant', 'u1')
    authoritativeReply.metadata.modelId = 'provider::model-a'
    authoritativeReply.metadata.messageSnapshot = {
      model: { id: 'model-a', provider: 'provider' }
    }
    const legacyReply = uiMsg('a2', 'assistant', 'u1')
    legacyReply.metadata.modelId = null
    legacyReply.metadata.messageSnapshot = {
      model: { id: 'provider::model-a', provider: 'provider' }
    }
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot'), authoritativeReply, legacyReply], cache)

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({ mentionedModelIds: ['provider::model-a', 'provider::provider::model-a'] })
    )
  })

  it('rejects edit-and-resend when stream open is blocked', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'blocked', message: 'blocked' })
    const { actions } = renderActions([uiMsg('u1', 'user', 'vroot')], cache)

    await expect(actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)).rejects.toThrow('blocked')
  })
})
