import type { PaintingListResponse } from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../model/mappers/recordToPaintingData', () => ({
  recordsToPaintingDataList: vi.fn(async (records: Painting[]) =>
    records.map((record) => ({
      id: record.id,
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

import { usePaintingHistory } from '../usePaintingHistory'

function createRecord(id: string): Painting {
  return {
    id,
    providerId: 'silicon',
    modelId: 'silicon:model-1',
    prompt: 'draw a cat',
    files: { output: [], input: [] },
    orderKey: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function createPage(offset: number, total: number): PaintingListResponse {
  const items = Array.from({ length: 30 }, (_, index) => createRecord(`painting-${offset + index}`))
  return {
    items,
    total,
    nextCursor: offset + items.length < total ? `cursor-${offset}` : undefined
  }
}

describe('usePaintingHistory', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('uses cursor infinite DataApi pagination for the strip history', async () => {
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

    const { result } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(result.current.items).toHaveLength(30))
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/paintings', { limit: 30 })
    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })
})
