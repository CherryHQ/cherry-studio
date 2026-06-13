import type { Topic as RendererTopic } from '@renderer/types'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useActiveTopic, useTopicMutations } from '../useTopic'

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { CHANGE_TOPIC: 'change-topic' },
  EventEmitter: { emit: vi.fn() }
}))

const buildInfiniteReturn = (items: ApiTopic[] = []) => ({
  pages: items.length > 0 ? [{ items }] : [],
  isLoading: false,
  isRefreshing: false,
  error: undefined,
  hasNext: false,
  loadNext: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn(),
  mutate: vi.fn().mockResolvedValue(undefined)
})

const apiTopic = (id: string): ApiTopic => ({
  id,
  name: id,
  isNameManuallyEdited: false,
  assistantId: 'assistant-1',
  orderKey: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const rendererTopic = (id: string): RendererTopic => ({
  id,
  assistantId: 'assistant-1',
  name: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: id,
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
})

describe('useActiveTopic', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('does not select the first topic when activeTopicId is missing', () => {
    const setActiveTopicId = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn([apiTopic('topic-1')]) as never)

    const { result } = renderHook(() =>
      useActiveTopic({
        activeTopicId: null,
        setActiveTopicId
      })
    )

    expect(result.current.activeTopic).toBeUndefined()
    expect(result.current.topicSource).toBe('none')
    expect(setActiveTopicId).not.toHaveBeenCalled()
  })

  it('does not fall back to the first topic when activeTopicId is not in the loaded list', () => {
    const setActiveTopicId = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn([apiTopic('topic-1')]) as never)

    const { result } = renderHook(() =>
      useActiveTopic({
        activeTopicId: 'missing-topic',
        setActiveTopicId
      })
    )

    expect(result.current.activeTopic).toBeUndefined()
    expect(result.current.topicSource).toBe('none')
    expect(setActiveTopicId).not.toHaveBeenCalled()
  })

  it('keeps a matching pending topic while the loaded list catches up', () => {
    const setActiveTopicId = vi.fn()
    const pendingTopic = rendererTopic('temp-topic')
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn([apiTopic('topic-1')]) as never)

    const { result } = renderHook(() =>
      useActiveTopic({
        initialTopic: pendingTopic,
        activeTopicId: 'temp-topic',
        setActiveTopicId
      })
    )

    expect(result.current.activeTopic).toBe(pendingTopic)
    expect(result.current.topicSource).toBe('pending')
    expect(setActiveTopicId).not.toHaveBeenCalled()
  })
})

describe('useTopicMutations', () => {
  beforeEach(() => {
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
})
