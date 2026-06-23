import type { CreationListResponse } from '@shared/data/api/schemas/creations'
import type { Creation } from '@shared/data/types/creation'
import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../paintings/model/mappers/recordToPaintingData', () => ({
  recordsToPaintingDataList: vi.fn(async (records: Creation[]) =>
    records.map((record) => ({
      id: record.id,
      kind: record.kind,
      providerId: record.providerId,
      mode: 'generate',
      prompt: record.prompt,
      files: [],
      inputFiles: [],
      persistedAt: record.createdAt,
      model: record.modelId ?? undefined
    }))
  )
}))

import { useCreationHistory } from '../useCreationHistory'

function createRecord(id: string): Creation {
  return {
    id,
    kind: 'image',
    providerId: 'silicon',
    modelId: 'silicon:model-1',
    prompt: 'draw a cat',
    files: { output: [], input: [] },
    orderKey: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function createPage(offset: number, total: number): CreationListResponse {
  const items = Array.from({ length: 30 }, (_, index) => createRecord(`creation-${offset + index}`))
  return {
    items,
    total,
    nextCursor: offset + items.length < total ? `cursor-${offset}` : undefined
  }
}

describe('useCreationHistory', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('uses cursor infinite DataApi pagination for the creation gallery', async () => {
    const loadNext = vi.fn()
    const page = createPage(0, 90)
    mockUseInfiniteQuery.mockReturnValue({
      pages: [page],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn().mockResolvedValue([page]),
      reset: vi.fn().mockResolvedValue([page]),
      mutate: vi.fn().mockResolvedValue([page])
    })

    const { result } = renderHook(() => useCreationHistory())

    await waitFor(() => expect(result.current.items).toHaveLength(30))
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/creations', { limit: 30 })
    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('keeps the optional kind filter for scoped consumers', () => {
    const page = createPage(0, 30)
    mockUseInfiniteQuery.mockReturnValue({
      pages: [page],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue([page]),
      reset: vi.fn().mockResolvedValue([page]),
      mutate: vi.fn().mockResolvedValue([page])
    })

    renderHook(() => useCreationHistory('video'))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/creations', { query: { kind: 'video' }, limit: 30 })
  })
})
