import type { Topic } from '@renderer/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/DataApiService', () => ({ dataApiService: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { settings: {} } })
}))

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
      seedReservedMessages: vi.fn(async () => {})
    })
  )
  return { actions: result.current.actions, cache }
}

describe('useChatWriteActions — first-turn delete', () => {
  beforeEach(() => vi.clearAllMocks())

  // vroot → u1(user) → a1(assistant). rootId = 'vroot'.
  const tree = () => [uiMsg('u1', 'user', 'vroot'), uiMsg('a1', 'assistant', 'u1')]

  it('cascades a first-turn USER delete (parentId === rootId), not a splice', async () => {
    // Regression: classifying via the projected `askId` (undefined for user rows) made this
    // a splice, stranding a1 on the virtual root. Real parentId === rootId ⇒ cascade.
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessage('u1')
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'u1' }, query: { cascade: true } })
  })

  it('splices a deeper (non-first-turn) message', async () => {
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessage('a1')
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'a1' }, query: { cascade: false } })
  })

  it('does not over-classify when rootId is unknown (fail-safe to splice)', async () => {
    const { actions, cache } = renderActions(null, tree())
    await actions.deleteMessage('u1')
    expect(cache.deleteMessageTrigger).toHaveBeenCalledWith({ params: { id: 'u1' }, query: { cascade: false } })
  })

  it('deleteMessageGroup on a first-turn group (parent = rootId) clears the topic', async () => {
    const { actions, cache } = renderActions('vroot', tree())
    await actions.deleteMessageGroup('vroot')
    expect(cache.clearTopicMessagesTrigger).toHaveBeenCalledWith({ params: { topicId: 't1' } })
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
