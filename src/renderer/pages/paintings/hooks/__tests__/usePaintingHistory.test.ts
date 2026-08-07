import type { PaintingListResponse } from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { MockUseDataApiUtils, mockUseInfiniteFlatItems, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRecordsToPaintingDataList = vi.hoisted(() => vi.fn())

vi.mock('../../model/mappers/recordToPaintingData', () => ({
  recordsToPaintingDataList: mockRecordsToPaintingDataList
}))

import { type PaintingStripEntry, usePaintingHistory } from '../usePaintingHistory'

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
    mockUseInfiniteFlatItems.mockReset()
    mockRecordsToPaintingDataList.mockReset()
    mockRecordsToPaintingDataList.mockImplementation(async (records: Painting[]) =>
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
  })

  it('uses cursor infinite DataApi pagination for the strip history', async () => {
    const loadNext = vi.fn()
    const page = createPage(0, 90)
    mockUseInfiniteFlatItems.mockReturnValue(page.items)
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

  it('stays loading until the current records finish hydrating', async () => {
    const page = createPage(0, 30)
    mockUseInfiniteFlatItems.mockReturnValue(page.items)
    let resolveHydration: ((items: PaintingStripEntry[]) => void) | undefined
    mockRecordsToPaintingDataList.mockReturnValueOnce(
      new Promise<PaintingStripEntry[]>((resolve) => {
        resolveHydration = resolve
      })
    )
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

    const { result } = renderHook(() => usePaintingHistory())

    expect(result.current.isLoading).toBe(true)
    expect(result.current.items).toEqual([])

    expect(resolveHydration).toBeDefined()
    act(() => {
      resolveHydration!([
        {
          id: 'painting-0',
          providerId: 'silicon',
          mode: 'generate',
          prompt: 'draw a cat',
          files: [],
          inputFiles: [],
          persistedAt: '2026-01-01T00:00:00.000Z',
          model: 'silicon:model-1'
        }
      ])
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(1)
  })

  it('keeps the last mapped items while replacement records hydrate', async () => {
    const initialPage = createPage(0, 30)
    mockUseInfiniteFlatItems.mockReturnValue(initialPage.items)
    mockUseInfiniteQuery.mockReturnValue({
      pages: [initialPage],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue([initialPage]),
      reset: vi.fn().mockResolvedValue([initialPage]),
      mutate: vi.fn().mockResolvedValue([initialPage])
    })

    const { result, rerender } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(result.current.items[0]?.id).toBe('painting-0'))

    const replacementPage = createPage(30, 60)
    let resolveHydration: ((items: PaintingStripEntry[]) => void) | undefined
    mockRecordsToPaintingDataList.mockReturnValueOnce(
      new Promise<PaintingStripEntry[]>((resolve) => {
        resolveHydration = resolve
      })
    )
    mockUseInfiniteQuery.mockReturnValue({
      pages: [replacementPage],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue([replacementPage]),
      reset: vi.fn().mockResolvedValue([replacementPage]),
      mutate: vi.fn().mockResolvedValue([replacementPage])
    })
    mockUseInfiniteFlatItems.mockReturnValue(replacementPage.items)

    rerender()

    expect(result.current.isLoading).toBe(true)
    expect(result.current.items[0]?.id).toBe('painting-0')

    expect(resolveHydration).toBeDefined()
    act(() => {
      resolveHydration!(
        replacementPage.items.map((record) => ({
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
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items[0]?.id).toBe('painting-30')
  })
})
