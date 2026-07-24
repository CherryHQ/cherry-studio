import { dataApiService } from '@data/DataApiService'
import type { Topic } from '@renderer/types/topic'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils, mockUseInvalidateCache, mockUseWriteCache } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { useActiveTopic, useLatestTopic, useTopicMutations } from '../useTopic'

const mockCloseConversationTabs = vi.hoisted(() => vi.fn())

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => mockCloseConversationTabs
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { CHANGE_TOPIC: 'change-topic' },
  EventEmitter: { emit: vi.fn() }
}))

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
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/stats'])
  })

  it('reconciles caches and rethrows when the atomic move fails', async () => {
    vi.mocked(dataApiService.post).mockRejectedValueOnce(new Error('move failed'))

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
    expect(caught).toEqual(new Error('move failed'))
    expect(invalidateSpy).toHaveBeenCalledWith(['/topics', '/topics/stats', '/topics/topic-a'])
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
