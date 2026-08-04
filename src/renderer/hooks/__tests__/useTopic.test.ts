import { dataApiService } from '@data/DataApiService'
import type { Topic } from '@renderer/types/topic'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import {
  MockUseDataApiUtils,
  mockUseInfiniteQuery,
  mockUseInvalidateCache,
  mockUseWriteCache
} from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { getTopicMessages, useActiveTopic, useLatestTopic, useTopicMutations, useTopics } from '../useTopic'

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
})

describe('useTopics', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('keeps revalidateAll off while a load-all topic chain is still growing', () => {
    renderHook(() => useTopics({ loadAll: true }))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/topics', {
      query: undefined,
      limit: 200,
      enabled: undefined,
      swrOptions: { revalidateAll: false }
    })
  })

  it('flips revalidateAll on once a load-all topic chain is fully loaded', () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [{ id: 'topic-a' }] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    } as never)

    renderHook(() => useTopics({ loadAll: true }))

    expect(mockUseInfiniteQuery).toHaveBeenLastCalledWith('/topics', {
      query: undefined,
      limit: 200,
      enabled: undefined,
      swrOptions: { revalidateAll: true }
    })
  })

  it('keeps progressive topic sources on first-page revalidation', () => {
    renderHook(() => useTopics())

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/topics', {
      query: undefined,
      limit: 50,
      enabled: undefined,
      swrOptions: { revalidateAll: false }
    })
  })

  it('does not revalidate previously loaded pages while the load-all chain grows', () => {
    // Simulate a multi-page loadAll: each render grows `pages` by one and
    // keeps `hasNext` true until the final page. The auto-paginate effect
    // drives `loadNext`; we assert that across every growth render the
    // `swrOptions.revalidateAll` passed to `useInfiniteQuery` stays false
    // (no quadratic re-fetch of earlier pages) and `loadNext` is invoked
    // once per new page — never extra revalidation-triggered fetches.
    const loadNext = vi.fn()
    let pages: Array<{ items: Array<{ id: string }>; nextCursor?: string }> = [
      { items: [{ id: 't1' }], nextCursor: 'c1' }
    ]
    let hasNext = true

    mockUseInfiniteQuery.mockImplementation(
      () =>
        ({
          pages,
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          hasNext,
          loadNext,
          refresh: vi.fn().mockResolvedValue(undefined),
          reset: vi.fn(),
          mutate: vi.fn().mockResolvedValue(undefined)
        }) as never
    )

    const { rerender } = renderHook(() => useTopics({ loadAll: true, pageSize: 1 }))

    // Page 1 → 2
    pages = [...pages, { items: [{ id: 't2' }], nextCursor: 'c2' }]
    act(() => rerender())
    // Page 2 → 3 (final)
    pages = [...pages, { items: [{ id: 't3' }] }]
    hasNext = false
    act(() => rerender())

    // The auto-paginate effect drives loadNext; the key regression check is
    // that revalidateAll stays false across every growth render so earlier
    // pages are never re-fetched on each setSize (1+2+...+n IPC traffic).
    expect(loadNext).toHaveBeenCalled()

    // All calls during growth (every call except the final post-fully-loaded
    // re-render where the effect flips revalidateAll on) must keep
    // revalidateAll off.
    const growthCalls = mockUseInfiniteQuery.mock.calls.slice(0, -1)
    expect(growthCalls.length).toBeGreaterThan(0)
    for (const call of growthCalls) {
      expect(call[1]).toMatchObject({ swrOptions: { revalidateAll: false } })
    }
    // The final call — after the chain is fully loaded — flips revalidateAll on.
    const lastCall = mockUseInfiniteQuery.mock.calls[mockUseInfiniteQuery.mock.calls.length - 1]
    expect(lastCall[1]).toMatchObject({ swrOptions: { revalidateAll: true } })
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

  it('re-homes a dragged topic into `/topics/:id` before ordering, then revalidates once', async () => {
    const movedTopic = { id: 'topic-a', assistantId: 'assistant-2' }
    const patch = vi
      .mocked(dataApiService.patch)
      .mockResolvedValueOnce(movedTopic as never)
      .mockResolvedValueOnce(undefined as never)

    const { result } = renderHook(() => useTopicMutations())
    const writeCacheSpy = mockUseWriteCache.mock.results[0].value as Mock
    const invalidateSpy = mockUseInvalidateCache.mock.results[0].value as Mock

    await act(async () =>
      result.current.moveTopic('topic-a', { assistantId: 'assistant-2', anchor: { after: 'topic-d' } })
    )

    expect(patch).toHaveBeenNthCalledWith(1, '/topics/topic-a', { body: { assistantId: 'assistant-2' } })
    expect(patch).toHaveBeenNthCalledWith(2, '/topics/topic-a/order', { body: { after: 'topic-d' } })
    // The PATCH response lands in `/topics/:id` before the order write, so an open conversation
    // on the moved topic re-resolves its assistant immediately instead of waiting out the order
    // PATCH bound to the old one.
    expect(writeCacheSpy).toHaveBeenCalledWith('/topics/topic-a', movedTopic)
    expect(writeCacheSpy.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[1])
    // A single combined revalidation after both writes — not mid-flight, which would flash the
    // optimistic reorder overlay back to the old position.
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/topic-a'])
    expect(invalidateSpy.mock.invocationCallOrder[0]).toBeGreaterThan(patch.mock.invocationCallOrder[1])
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
    expect(invalidateSpy).toHaveBeenCalledWith('/topics')
  })

  it('reconciles caches and rethrows when ordering fails after the assistant change committed', async () => {
    vi.mocked(dataApiService.patch)
      .mockResolvedValueOnce({ id: 'topic-a', assistantId: 'assistant-2' } as never)
      .mockRejectedValueOnce(new Error('order failed'))

    const { result } = renderHook(() => useTopicMutations())
    const invalidateSpy = mockUseInvalidateCache.mock.results[0].value as Mock

    // `expect(act(...)).rejects` observes the rejection before moveTopic's catch block finishes,
    // so catch the rethrow manually inside act and assert afterwards.
    let caught: unknown
    await act(async () => {
      try {
        await result.current.moveTopic('topic-a', { assistantId: 'assistant-2', anchor: { after: 'topic-d' } })
      } catch (err) {
        caught = err
      }
    })

    // Rethrown so the caller can roll its optimistic UI back.
    expect(caught).toEqual(new Error('order failed'))
    // The assistant PATCH committed before the failure — server truth must be pulled back in.
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/topic-a'])
  })
})

describe('useLatestTopic', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('keeps first-entry restore gated while cached latest topic is revalidating', () => {
    MockUseDataApiUtils.mockQueryResult('/topics/latest', {
      data: { topic: { id: 'topic-a' } } as never,
      isRefreshing: true
    })

    const { result } = renderHook(() => useLatestTopic())

    expect(result.current.latestTopic?.id).toBe('topic-a')
    expect(result.current.isLoading).toBe(true)
  })
})

describe('useActiveTopic', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('reports not-loading while idle, so first-entry restore is never gated on the topic list', () => {
    // Core of the /latest fast path: with no active id yet the hook resolves the active
    // topic by id (not by scanning the loadAll list), so it is not "loading" and the
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
