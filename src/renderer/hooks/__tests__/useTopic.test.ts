import { dataApiService } from '@data/DataApiService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicMutations } from '../useTopic'

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

  it('deletes selected topics through comma-separated query ids', async () => {
    const response = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
    const deleteTrigger = vi.fn().mockResolvedValue(response)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/topics', deleteTrigger)

    const { result } = renderHook(() => useTopicMutations())
    const deleted = await act(async () => result.current.deleteTopics(['topic-a', 'topic-b']))

    expect(deleteTrigger).toHaveBeenCalledWith({ query: { ids: 'topic-a,topic-b' } })
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
