import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamOpen } = vi.hoisted(() => ({ streamOpen: vi.fn() }))

vi.mock('@data/DataApiService', () => ({ dataApiService: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => streamOpen(...args) }
}))
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { settings: {} } })
}))

import type { Topic } from '@renderer/types/topic'

import { useChatWriteActions } from '../useChatWriteActions'

function makeCache() {
  return {
    branchWithoutIds: vi.fn((prev: unknown) => prev),
    seedOptimisticBranch: vi.fn(async () => {}),
    patchMessageInBranch: vi.fn(),
    rollbackBranch: vi.fn(async () => {}),
    clearBranchCache: vi.fn(async () => {}),
    deleteMessageTrigger: vi.fn(async () => ({ deletedIds: [] })),
    patchMessageTrigger: vi.fn(async () => {}),
    createSiblingTrigger: vi.fn(async () => ({})),
    setActiveNodeTrigger: vi.fn(async () => ({})),
    clearTopicMessagesTrigger: vi.fn(async () => ({ deletedIds: [] }))
  } as unknown as Parameters<typeof useChatWriteActions>[0]['cache']
}

const uiMsg = (id: string, role: string, parentId: string | null): any => ({
  id,
  role,
  parts: [],
  metadata: { parentId }
})

function renderActions(rootId: string | null, uiMessages: ReturnType<typeof uiMsg>[], cache = makeCache()) {
  const captureLocalSendScrollEligibility = vi.fn()
  const onLocalSendStarted = vi.fn()
  const { result } = renderHook(() =>
    useChatWriteActions({
      topic: { id: 't1' } as Topic,
      uiMessages,
      rootId,
      regenerate: vi.fn(async () => {}),
      setMessages: vi.fn(),
      stop: vi.fn(async () => {}),
      refresh: vi.fn(async () => []),
      cache,
      seedReservedMessages: vi.fn(async () => {}),
      captureLocalSendScrollEligibility,
      onLocalSendStarted
    })
  )
  return { actions: result.current.actions, cache, captureLocalSendScrollEligibility, onLocalSendStarted }
}

describe('useChatWriteActions — first-turn delete', () => {
  beforeEach(() => vi.clearAllMocks())

  // vroot → u1(user) → a1(assistant). rootId = 'vroot'.
  const tree = () => [uiMsg('u1', 'user', 'vroot'), uiMsg('a1', 'assistant', 'u1')]

  it('reports first-turn deletion availability from the authoritative root id', () => {
    const { actions } = renderActions('vroot', tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: false, reason: 'first-turn' })
    expect(actions.getMessageDeleteAvailability('a1')).toEqual({ enabled: true })
  })

  it('rejects direct first-turn deletion before any write', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', tree(), cache)

    await expect(actions.deleteMessage('u1')).rejects.toThrow()

    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('rejects a multi-select plan containing a first-turn user before deleting its assistant first', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', tree(), cache)

    await expect(actions.deleteMessage('a1', { selectedMessageIds: ['u1', 'a1'] })).rejects.toThrow()

    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('splices a deeper (non-first-turn) message', async () => {
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessage('a1', { selectedMessageIds: ['a1'] })
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
  })

  it('rejects deletion before the authoritative root id is available', async () => {
    const { actions, cache } = renderActions(null, tree())

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({ enabled: false, reason: 'root-unavailable' })
    await expect(actions.deleteMessage('u1')).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('rejects group deletion when the parent message is outside the loaded page', async () => {
    const cache = makeCache()
    const { actions } = renderActions('vroot', [uiMsg('a1', 'assistant', 'u1')], cache)

    expect(actions.getMessageDeleteAvailability('u1')).toEqual({
      enabled: false,
      reason: 'message-unavailable'
    })
    await expect(actions.deleteMessageGroup('u1')).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it('deleteMessageGroup on a first-turn group (parent = rootId) clears the topic', async () => {
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessageGroup('vroot')
    expect(cache.clearTopicMessagesTrigger).toHaveBeenCalledWith({ params: { topicId: 't1' } })
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
  })

  it.each([
    [null, 'a1'],
    ['vroot', 'u1']
  ])('rejects unavailable message group deletion (rootId: %s, id: %s)', async (rootId, id) => {
    const { actions, cache } = renderActions(rootId, tree())

    await expect(actions.deleteMessageGroup(id)).rejects.toThrow()
    expect(cache.seedOptimisticBranch).not.toHaveBeenCalled()
    expect(cache.deleteMessageTrigger).not.toHaveBeenCalled()
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

  it('marks a successful edit-and-resend as a local send', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    const { actions, captureLocalSendScrollEligibility, onLocalSendStarted } = renderActions(
      'vroot',
      [uiMsg('u1', 'user', 'vroot')],
      cache
    )

    await actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)

    expect(captureLocalSendScrollEligibility).toHaveBeenCalledOnce()
    expect(captureLocalSendScrollEligibility.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cache.createSiblingTrigger).mock.invocationCallOrder[0]
    )
    expect(streamOpen).toHaveBeenCalledWith(
      'ai.stream_open',
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 't1',
        parentAnchorId: 'forked-user'
      })
    )
    expect(onLocalSendStarted).toHaveBeenCalledOnce()
  })

  it('does not mark edit-and-resend when stream open is blocked', async () => {
    const cache = makeCache()
    vi.mocked(cache.createSiblingTrigger).mockResolvedValueOnce(createForkedUser() as never)
    streamOpen.mockResolvedValueOnce({ mode: 'blocked', message: 'blocked' })
    const { actions, captureLocalSendScrollEligibility, onLocalSendStarted } = renderActions(
      'vroot',
      [uiMsg('u1', 'user', 'vroot')],
      cache
    )

    await expect(actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }] as any)).rejects.toThrow('blocked')

    expect(captureLocalSendScrollEligibility).toHaveBeenCalledOnce()
    expect(onLocalSendStarted).not.toHaveBeenCalled()
  })
})
