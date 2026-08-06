import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invalidateMessages, streamOpen } = vi.hoisted(() => ({
  invalidateMessages: vi.fn(),
  streamOpen: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({ dataApiService: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => streamOpen(input) }
}))
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { settings: {} } })
}))
vi.mock('@renderer/components/chat/messages/utils/messageUiStateCache', () => ({
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
    clearBranchCache: vi.fn(async () => {}),
    deleteMessageTrigger: vi.fn(async () => ({ deletedIds: [] })),
    deleteMessageGroupTrigger: vi.fn(async () => ({ deletedIds: [] })),
    patchMessageTrigger: vi.fn(async () => {}),
    createSiblingTrigger: vi.fn(async () => ({})),
    createMessageTrigger: vi.fn(async () => ({})),
    setActiveNodeTrigger: vi.fn(async () => ({})),
    clearTopicMessagesTrigger: vi.fn(async () => ({ deletedIds: [] }))
  } as unknown as Parameters<typeof useChatWriteActions>[0]['cache']
}

const uiMsg = (id: string, role: string, parentId: string | null, isContextBoundary = false): any => ({
  id,
  role,
  parts: isContextBoundary ? [{ type: 'data-clear', data: {} }] : [],
  metadata: { parentId }
})

function renderActions(
  rootId: string | null,
  uiMessages: ReturnType<typeof uiMsg>[],
  cache = makeCache(),
  activeNodeId = uiMessages.at(-1)?.id ?? null,
  startNewContextBlocked = false,
  siblingsMap: Parameters<typeof useChatWriteActions>[0]['siblingsMap'] = {}
) {
  const scrollToBottom = vi.fn()
  const regenerate = vi.fn(async () => {})
  const setMessages = vi.fn()
  const { result } = renderHook(() =>
    useChatWriteActions({
      topic: { id: 't1' } as Topic,
      uiMessages,
      siblingsMap,
      activeNodeId,
      rootId,
      regenerate,
      setMessages,
      stop: vi.fn(async () => {}),
      refresh: vi.fn(async () => []),
      cache,
      seedReservedMessages: vi.fn(async () => {}),
      scrollToBottom,
      startNewContextBlocked
    })
  )
  return {
    actions: result.current.actions,
    result,
    cache,
    scrollToBottom,
    regenerate
  }
}

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
    const { actions, cache, scrollToBottom } = renderActions('vroot', [], makeCache(), null)

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
        siblingsMap: {},
        activeNodeId: 'u1',
        rootId: 'vroot',
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
    const { actions, cache } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot')], makeCache(), 'u1', true)

    expect(actions.canStartNewContext).toBe(false)
    await act(async () => {
      await actions.startNewContext()
    })

    expect(cache.createMessageTrigger).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('removes the active clear marker without cascading and rolls the cache forward immediately', async () => {
    const { actions, cache, scrollToBottom } = renderActions('vroot', [
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
    const { actions, scrollToBottom } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot')], cache)

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
    const { actions } = renderActions(
      'vroot',
      [uiMsg('u1', 'user', 'vroot'), uiMsg('clear-1', 'user', 'u1', true)],
      cache
    )

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
    const { actions, result } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot')], cache)

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
    const { actions } = renderActions('vroot', tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: true })
    expect(actions.getMessageDeleteAvailability('a1')).toEqual({ enabled: true })
  })

  it('splices a first-turn message onto the virtual root without cascading', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', tree(), cache)

    await actions.deleteMessage('u1')

    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'u1' }, query: { cascade: false } })
    expect(invalidateMessages).toHaveBeenCalledWith(['u1'])
  })

  it('accepts a multi-select plan containing the first turn', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', tree(), cache)

    await actions.deleteMessage('a1', { selectedMessageIds: ['u1', 'a1'] })

    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
  })

  it('splices a deeper (non-first-turn) message', async () => {
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessage('a1', { selectedMessageIds: ['a1'] })
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
    expect(invalidateMessages).toHaveBeenCalledWith(['a1'])
  })

  it('rejects deletion before the authoritative root id is available', async () => {
    const { actions, cache } = renderActions(null, tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: false, reason: 'root-unavailable' })
    await expect(actions.deleteMessage('u1')).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('rejects group deletion when any reply is outside the loaded page', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', [uiMsg('a1', 'assistant', 'u1')], cache)

    expect(actions.getMessageDeleteAvailability('missing')).toEqual({
      enabled: false,
      reason: 'message-unavailable'
    })
    await expect(actions.deleteMessageGroup(['a1', 'missing'])).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageGroupTrigger).not.toHaveBeenCalled()
  })

  it('splices multi-model replies without deleting their user-message parent', async () => {
    const cache = makeCache()
    vi.mocked(cache.deleteMessageGroupTrigger).mockResolvedValueOnce({ deletedIds: ['a1', 'a2'] })
    const messages = [...tree(), uiMsg('a2', 'assistant', 'u1')]
    const { actions } = renderActions('vroot', messages, cache)

    await actions.deleteMessageGroup(['a1', 'a2'])

    expect(cache.deleteMessageGroupTrigger).toHaveBeenCalledWith({ query: { ids: 'a1,a2' } })
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
    expect(invalidateMessages).toHaveBeenCalledWith(['a1', 'a2'])
  })

  it('expands displayed bubbles to their full regenerate bucket before deletion', async () => {
    const cache = makeCache()
    vi.mocked(cache.deleteMessageGroupTrigger).mockResolvedValueOnce({ deletedIds: ['a1-old', 'a1', 'a2'] })
    const messages = [...tree(), uiMsg('a2', 'assistant', 'u1')]
    // a1 was regenerated: the hidden older version shares its sibling group.
    const siblingsMap = {
      a1: [{ id: 'a1-old' }, { id: 'a1' }]
    } as unknown as Parameters<typeof useChatWriteActions>[0]['siblingsMap']
    const { actions } = renderActions('vroot', messages, cache, undefined, false, siblingsMap)

    await actions.deleteMessageGroup(['a1', 'a2'])

    expect(cache.deleteMessageGroupTrigger).toHaveBeenCalledWith({ query: { ids: 'a1-old,a1,a2' } })
    expect(invalidateMessages).toHaveBeenCalledWith(['a1-old', 'a1', 'a2'])
  })

  it('rejects message group deletion before the root is available', async () => {
    const { actions, cache } = renderActions(null, tree())

    await expect(actions.deleteMessageGroup(['a1'])).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageGroupTrigger).not.toHaveBeenCalled()
  })
})

describe('useChatWriteActions — edit message', () => {
  beforeEach(() => vi.clearAllMocks())

  it('optimistically patches branch messages and persists edited parts', async () => {
    const editedParts = [{ type: 'text', text: 'edited' }]
    const { actions, cache } = renderActions('vroot', [uiMsg('m1', 'user', 'vroot')])

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
    const { actions, cache } = renderActions('vroot', [uiMsg('m1', 'user', 'vroot')])
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
    const { actions, regenerate } = renderActions('vroot', [
      uiMsg('u1', 'user', 'vroot'),
      uiMsg('a1', 'assistant', 'u1')
    ])
    let finishRegenerate: (() => void) | undefined
    regenerate.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRegenerate = resolve)))

    const request = actions.regenerate('a1')

    expect(regenerate).toHaveBeenCalledOnce()

    finishRegenerate?.()
    await request
  })

  it('inherits the persisted turn options when retrying an assistant message', async () => {
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.metadata.turnOptions = { reasoningEffort: 'high', fastMode: true }
    const { actions, regenerate } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot'), assistantMessage])

    await actions.regenerate('a1')

    expect(regenerate).toHaveBeenCalledWith({
      messageId: 'a1',
      body: expect.objectContaining({
        parentAnchorId: 'u1',
        reasoningEffort: 'high',
        fastMode: true
      })
    })
  })

  it('inherits the active assistant turn options when resending its user message', async () => {
    streamOpen.mockReset()
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const assistantMessage = uiMsg('a1', 'assistant', 'u1')
    assistantMessage.metadata.isActiveBranch = true
    assistantMessage.metadata.turnOptions = { reasoningEffort: 'minimal', fastMode: false }
    const { actions } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot'), assistantMessage])

    await actions.resend('u1')

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        parentAnchorId: 'u1',
        reasoningEffort: 'minimal',
        fastMode: false
      })
    )
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
    const { actions } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot')], cache)

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any, {
      reasoningEffort: 'high',
      fastMode: true
    })

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 't1',
        parentAnchorId: 'forked-user',
        reasoningEffort: 'high',
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
    firstAssistant.metadata.turnOptions = { reasoningEffort: 'high', fastMode: true }
    const secondAssistant = uiMsg('a2', 'assistant', 'u1')
    secondAssistant.metadata.modelId = 'provider::model-b'
    secondAssistant.metadata.turnOptions = { reasoningEffort: 'high', fastMode: true }
    const { actions } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot'), firstAssistant, secondAssistant], cache)

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)

    expect(streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedModelIds: ['provider::model-a', 'provider::model-b'],
        reasoningEffort: 'high',
        fastMode: true
      })
    )
  })

  it('rejects edit-and-resend when stream open is blocked', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'blocked', message: 'blocked' })
    const { actions } = renderActions('vroot', [uiMsg('u1', 'user', 'vroot')], cache)

    await expect(actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)).rejects.toThrow('blocked')
  })
})
