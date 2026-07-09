import { dataApiService } from '@data/DataApiService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLatestTopic, useTopicMutations } from '../useTopic'

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
