import { dataApiService } from '@data/DataApiService'
import type { Topic } from '@renderer/types/topic'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import {
  MockUseDataApiUtils,
  mockUseDataChange,
  mockUseInfiniteQuery,
  mockUseInvalidateCache,
  mockUseMutation,
  mockUseQuery,
  mockUseWriteCache
} from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import {
  getTopicMessages,
  useActiveTopic,
  useTopicById,
  useTopicMutations,
  useTopics,
  useTopicStats
} from '../useTopic'

const mockCloseConversationTabs = vi.hoisted(() => vi.fn())

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => mockCloseConversationTabs
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { CHANGE_TOPIC: 'change-topic' },
  EventEmitter: { emit: vi.fn() }
}))

const apiMessage = (id: string, isContextBoundary = false) => ({
  id,
  topicId: 'topic-a',
  parentId: 'root',
  role: 'user' as const,
  data: {
    parts: isContextBoundary ? [{ type: 'data-clear' as const, data: {} }] : [{ type: 'text' as const, text: id }]
  },
  searchableText: '',
  status: 'success' as const,
  siblingsGroupId: 0,
  modelId: null,
  messageSnapshot: null,
  stats: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('getTopicMessages', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('filters clear markers and does not count them toward maxMessages', async () => {
    vi.mocked(dataApiService.get)
      .mockResolvedValueOnce({
        items: [{ message: apiMessage('clear-1', true) }, { message: apiMessage('newer') }],
        nextCursor: 'older-page',
        activeNodeId: 'newer',
        assistantId: 'assistant-1',
        rootId: 'root'
      } as never)
      .mockResolvedValueOnce({
        items: [{ message: apiMessage('older') }],
        nextCursor: undefined,
        activeNodeId: 'newer',
        assistantId: 'assistant-1',
        rootId: 'root'
      } as never)

    const messages = await getTopicMessages('topic-a', { maxMessages: 2 })

    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(messages.map((message) => message.id)).toEqual(['older', 'newer'])
  })

  it('filters awaiting-input messages and does not count them toward maxMessages', async () => {
    const awaitingInput = {
      ...apiMessage('awaiting-input'),
      data: { parts: [] }
    }

    vi.mocked(dataApiService.get)
      .mockResolvedValueOnce({
        items: [{ message: awaitingInput }, { message: apiMessage('newer') }],
        nextCursor: 'older-page',
        activeNodeId: 'awaiting-input',
        assistantId: 'assistant-1',
        rootId: 'root'
      } as never)
      .mockResolvedValueOnce({
        items: [{ message: apiMessage('older') }],
        nextCursor: undefined,
        activeNodeId: 'awaiting-input',
        assistantId: 'assistant-1',
        rootId: 'root'
      } as never)

    const messages = await getTopicMessages('topic-a', { maxMessages: 2 })

    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(messages.map((message) => message.id)).toEqual(['older', 'newer'])
  })

  it('filters awaiting-input messages from sibling groups', async () => {
    const awaitingInputSibling = {
      ...apiMessage('awaiting-input-sibling'),
      data: { parts: [] }
    }
    const assistantSibling = {
      ...apiMessage('assistant-sibling'),
      role: 'assistant' as const
    }

    vi.mocked(dataApiService.get).mockResolvedValueOnce({
      items: [
        {
          message: apiMessage('user'),
          siblingsGroup: [awaitingInputSibling, assistantSibling]
        }
      ],
      nextCursor: undefined,
      activeNodeId: 'assistant-sibling',
      assistantId: 'assistant-1',
      rootId: 'root'
    } as never)

    const messages = await getTopicMessages('topic-a')

    expect(messages.map((message) => message.id)).toEqual(['user', 'assistant-sibling'])
  })
})

describe('useTopics', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('converges the topic list for every notification regardless of entity hints', () => {
    renderHook(() => useTopics({ pinned: false, sortBy: 'lastActivityAt' }))
    const refresh = mockUseInfiniteQuery.mock.results.at(-1)?.value.refresh
    const listener = mockUseDataChange.mock.calls.at(-1)?.[1]

    listener?.([{ endpoint: '/topics', kind: 'projection', entityIds: [] }])

    expect(refresh).toHaveBeenCalled()
  })
})

describe('useTopicById', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('scopes concrete topic notifications by route and filters their entity id', () => {
    renderHook(() => useTopicById('topic-a'))
    const mutate = mockUseQuery.mock.results.at(-1)?.value.mutate
    const listener = mockUseDataChange.mock.calls.at(-1)?.[1]
    expect(mockUseDataChange).toHaveBeenCalledWith('/topics/:id', expect.any(Function), {
      routeParams: { id: 'topic-a' }
    })

    listener?.([{ endpoint: '/topics/:id', entityIds: ['topic-b'] }])
    expect(mutate).not.toHaveBeenCalled()

    listener?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
    expect(mutate).toHaveBeenCalledOnce()
  })
})

describe('useTopicMutations', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('deletes a topic and closes the matching assistant conversation tab', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics/:id', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    await act(async () => result.current.deleteTopic('topic-a'))

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'topic-a' } })
    expect(mockCloseConversationTabs).toHaveBeenCalledWith('assistants', ['topic-a'])
  })

  it('refreshes stats only when a topic patch changes its name or owner', () => {
    renderHook(() => useTopicMutations())

    const updateMutationCall = mockUseMutation.mock.calls.find(
      ([method, path]) => method === 'PATCH' && path === '/topics/:id'
    )
    const refresh = updateMutationCall?.[2]?.refresh as (context: {
      args: { params: { id: string }; body: Record<string, unknown> }
    }) => unknown[]

    expect(refresh({ args: { params: { id: 'topic-a' }, body: { name: 'Renamed topic' } } })).toEqual([
      '/topics',
      '/topics/stats',
      '/topics/topic-a'
    ])
    expect(refresh({ args: { params: { id: 'topic-a' }, body: { isNameManuallyEdited: true } } })).toEqual([
      '/topics',
      '/topics/topic-a'
    ])
  })

  it('deletes selected topics through comma-separated query ids', async () => {
    const response = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
    const deleteTrigger = vi.fn().mockResolvedValue(response)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    const deleted = await act(async () => result.current.deleteTopics(['topic-a', 'topic-b']))

    expect(deleteTrigger).toHaveBeenCalledWith({ query: { ids: 'topic-a,topic-b' } })
    expect(mockCloseConversationTabs).toHaveBeenCalledWith('assistants', response.deletedIds)
    expect(deleted).toBe(response)
  })

  it('deletes assistant topics and closes the deleted assistant conversation tabs', async () => {
    const response = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
    const deleteTrigger = vi.fn().mockResolvedValue(response)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/assistants/:assistantId/topics', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    const deleted = await act(async () => result.current.deleteTopicsByAssistantId('assistant-a'))

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { assistantId: 'assistant-a' } })
    expect(mockCloseConversationTabs).toHaveBeenCalledWith('assistants', response.deletedIds)
    expect(deleted).toBe(response)
  })

  it('exposes selected-topic delete loading through isDeleting', () => {
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics', vi.fn(), { isLoading: true })

    const { result } = renderHook(() => useTopicMutations())

    expect(result.current.isDeleting).toBe(true)
  })

  it('batch updates topics and returns per-topic settled results', async () => {
    const failed = new Error('move failed')
    vi.mocked(dataApiService.patch)
      .mockResolvedValueOnce({ id: 'topic-a' } as never)
      .mockRejectedValueOnce(failed)

    const { result } = renderHook(() => useTopicMutations())
    const settled = await act(async () =>
      result.current.batchUpdateTopics([
        { id: 'topic-a', dto: { assistantId: 'assistant-next' } },
        { id: 'topic-b', dto: { assistantId: 'assistant-next' } }
      ])
    )

    expect(dataApiService.patch).toHaveBeenNthCalledWith(1, '/topics/topic-a', {
      body: { assistantId: 'assistant-next' }
    })
    expect(dataApiService.patch).toHaveBeenNthCalledWith(2, '/topics/topic-b', {
      body: { assistantId: 'assistant-next' }
    })
    expect(settled[0]?.status).toBe('fulfilled')
    expect(settled[1]).toEqual({ status: 'rejected', reason: failed })
  })

  it('moves a topic atomically, updates its by-id cache, then revalidates once', async () => {
    const cachedTopic = { id: 'topic-a', assistantId: 'assistant-1', name: 'Topic A' }
    MockUseDataApiUtils.seedCache('/topics/topic-a', cachedTopic as never)
    const post = vi.mocked(dataApiService.post).mockResolvedValueOnce(undefined as never)

    const { result } = renderHook(() => useTopicMutations())
    const writeCacheSpy = mockUseWriteCache.mock.results[0].value as Mock
    const invalidateSpy = mockUseInvalidateCache.mock.results[0].value as Mock

    await act(async () =>
      result.current.moveTopic('topic-a', { assistantId: 'assistant-2', anchor: { after: 'topic-d' } })
    )

    expect(post).toHaveBeenCalledWith('/topics/topic-a/move', {
      body: { assistantId: 'assistant-2', order: { after: 'topic-d' } }
    })
    expect(dataApiService.patch).not.toHaveBeenCalled()
    // The atomic move commits before the by-id cache changes, so an open conversation follows
    // the new assistant without exposing a partially moved server state.
    expect(writeCacheSpy).toHaveBeenCalledWith('/topics/topic-a', {
      ...cachedTopic,
      assistantId: 'assistant-2'
    })
    expect(writeCacheSpy.mock.invocationCallOrder[0]).toBeGreaterThan(post.mock.invocationCallOrder[0])
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/stats', '/topics/topic-a'])
    expect(invalidateSpy.mock.invocationCallOrder[0]).toBeGreaterThan(writeCacheSpy.mock.invocationCallOrder[0])
  })

  it('reorders without an assistant change using only the order write and a list refresh', async () => {
    const patch = vi.mocked(dataApiService.patch).mockResolvedValueOnce(undefined as never)

    const { result } = renderHook(() => useTopicMutations())
    const writeCacheSpy = mockUseWriteCache.mock.results[0].value as Mock
    const invalidateSpy = mockUseInvalidateCache.mock.results[0].value as Mock

    await act(async () => result.current.moveTopic('topic-a', { anchor: { before: 'topic-b' } }))

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith('/topics/topic-a/order', { body: { before: 'topic-b' } })
    expect(writeCacheSpy).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics'])
  })

  it('reconciles caches and rethrows when the atomic move fails', async () => {
    vi.mocked(dataApiService.post).mockRejectedValueOnce(new Error('move failed'))

    const { result } = renderHook(() => useTopicMutations())
    const invalidateSpy = mockUseInvalidateCache.mock.results[0].value as Mock

    let caught: unknown
    await act(async () => {
      try {
        await result.current.moveTopic('topic-a', { assistantId: 'assistant-2', anchor: { after: 'topic-d' } })
      } catch (err) {
        caught = err
      }
    })

    // Rethrown so the caller can roll its optimistic UI back.
    expect(caught).toEqual(new Error('move failed'))
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/stats', '/topics/topic-a'])
  })
})

describe('useTopicStats', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('refetches mounted stats when Main publishes a stats change', () => {
    renderHook(() => useTopicStats())
    const refetch = mockUseQuery.mock.results.at(-1)?.value.refetch
    const listener = mockUseDataChange.mock.calls.at(-1)?.[1]

    listener?.([{ endpoint: '/topics/stats' }])

    expect(refetch).toHaveBeenCalled()
  })
})

describe('useActiveTopic', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('reports not-loading while idle, so first-entry restore is never gated on the topic list', () => {
    // Core of the /latest fast path: with no active id yet the hook resolves the active
    // topic by id (not by scanning a paged list), so it is not "loading" and the
    // first-entry effect is free to resume the latest topic immediately.
    const { result } = renderHook(() => useActiveTopic({ activeTopicId: null, setActiveTopicId: vi.fn() }))

    expect(result.current.activeTopic).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
  })

  it('renders the pending topic immediately while the by-id query is still loading', () => {
    MockUseDataApiUtils.mockQueryLoading('/topics/topic-a')
    const topic = { id: 'topic-a', name: 'A' } as unknown as Topic

    const { result } = renderHook(() =>
      useActiveTopic({ initialTopic: topic, activeTopicId: 'topic-a', setActiveTopicId: vi.fn() })
    )

    expect(result.current.activeTopic?.id).toBe('topic-a')
    expect(result.current.topicSource).toBe('pending')
    expect(result.current.isLoading).toBe(false)
  })

  it('stays loading while a specific active id resolves with no pending fallback (route/tab restore)', () => {
    // The by-id gate is what keeps first-entry from overriding an in-flight route topic.
    MockUseDataApiUtils.mockQueryLoading('/topics/topic-a')

    const { result } = renderHook(() => useActiveTopic({ activeTopicId: 'topic-a', setActiveTopicId: vi.fn() }))

    expect(result.current.activeTopic).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })
})
