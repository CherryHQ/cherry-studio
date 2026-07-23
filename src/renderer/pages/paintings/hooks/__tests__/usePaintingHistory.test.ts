import type { PaintingListResponse } from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { MockUseDataApiUtils, mockUseInfiniteFlatItems, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

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

import { recordsToPaintingDataList } from '../../model/mappers/recordToPaintingData'
import { usePaintingHistory } from '../usePaintingHistory'

const mockedRecordsToPaintingDataList = vi.mocked(recordsToPaintingDataList)

function createRecord(id: string, overrides: Partial<Painting> = {}): Painting {
  return {
    id,
    providerId: 'silicon',
    modelId: 'silicon:model-1',
    prompt: 'draw a cat',
    files: { output: [], input: [] },
    orderKey: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
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

function createPageWithItems(items: Painting[]): PaintingListResponse {
  return { items, total: items.length, nextCursor: undefined }
}

function toPaintingData(record: Painting): PaintingData {
  return {
    id: record.id,
    providerId: record.providerId,
    mode: 'generate',
    prompt: record.prompt,
    files: [],
    inputFiles: [],
    persistedAt: record.createdAt,
    model: record.modelId ?? undefined
  }
}

function setPages(pages: PaintingListResponse[], hasNext = false) {
  const loadNext = vi.fn()
  mockUseInfiniteQuery.mockReturnValue({
    pages,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext,
    loadNext,
    refresh: vi.fn().mockResolvedValue(pages),
    reset: vi.fn().mockResolvedValue(pages),
    mutate: vi.fn().mockResolvedValue(pages)
  })
  mockUseInfiniteFlatItems.mockReturnValue(pages.flatMap((page) => page.items))
  return loadNext
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('usePaintingHistory', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    mockedRecordsToPaintingDataList.mockReset()
    mockedRecordsToPaintingDataList.mockImplementation(async (records) => records.map(toPaintingData))
  })

  it('uses cursor infinite DataApi pagination for the strip history', async () => {
    const page = createPage(0, 90)
    const loadNext = setPages([page], true)

    const { result } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(result.current.items).toHaveLength(30))
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/paintings', { limit: 30 })
    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('rehydrates only changed records and reuses unchanged items', async () => {
    const records = Array.from({ length: 30 }, (_, index) => createRecord(`painting-${index}`))
    setPages([createPageWithItems(records)])

    const { result, rerender } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(result.current.items).toHaveLength(30))
    const initialItems = result.current.items
    const changedRecord = createRecord('painting-29', { prompt: 'draw a dog' })
    setPages([createPageWithItems([...records.slice(0, 29), changedRecord])])

    rerender()

    await waitFor(() => expect(result.current.items[29]?.prompt).toBe('draw a dog'))
    expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(2)
    expect(mockedRecordsToPaintingDataList).toHaveBeenLastCalledWith([changedRecord])
    expect(result.current.items.slice(0, 29)).toEqual(initialItems.slice(0, 29))
    expect(result.current.items[0]).toBe(initialItems[0])
  })

  it('detects files-only changes when updatedAt is unchanged', async () => {
    const record = createRecord('painting-1')
    setPages([createPageWithItems([record])])

    const { rerender } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(1))
    const changedRecord = createRecord('painting-1', {
      files: { input: ['input-1'], output: ['output-1'] },
      updatedAt: record.updatedAt
    })
    setPages([createPageWithItems([changedRecord])])

    rerender()

    await waitFor(() => expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(2))
    expect(mockedRecordsToPaintingDataList).toHaveBeenLastCalledWith([changedRecord])
  })

  it('preserves query order and prunes removed records from the cache', async () => {
    const first = createRecord('painting-1')
    const second = createRecord('painting-2')
    const third = createRecord('painting-3')
    setPages([createPageWithItems([first, second, third])])

    const { result, rerender } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(result.current.items).toHaveLength(3))
    setPages([createPageWithItems([third, first])])
    rerender()

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['painting-3', 'painting-1']))
    expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(1)

    setPages([createPageWithItems([third, first, second])])
    rerender()

    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual(['painting-3', 'painting-1', 'painting-2'])
    )
    expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(2)
    expect(mockedRecordsToPaintingDataList).toHaveBeenLastCalledWith([second])
  })

  it('does not let obsolete hydration overwrite newer pages', async () => {
    const oldRecord = createRecord('painting-1', { prompt: 'old prompt' })
    const newRecord = createRecord('painting-1', { prompt: 'new prompt' })
    const oldHydration = createDeferred<PaintingData[]>()
    const newHydration = createDeferred<PaintingData[]>()
    mockedRecordsToPaintingDataList
      .mockImplementationOnce(() => oldHydration.promise)
      .mockImplementationOnce(() => newHydration.promise)
    setPages([createPageWithItems([oldRecord])])

    const { result, rerender } = renderHook(() => usePaintingHistory())

    await waitFor(() => expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(1))
    setPages([createPageWithItems([newRecord])])
    rerender()
    await waitFor(() => expect(mockedRecordsToPaintingDataList).toHaveBeenCalledTimes(2))

    await act(async () => {
      newHydration.resolve([toPaintingData(newRecord)])
      await newHydration.promise
    })
    expect(result.current.items[0]?.prompt).toBe('new prompt')

    await act(async () => {
      oldHydration.resolve([toPaintingData(oldRecord)])
      await oldHydration.promise
    })
    expect(result.current.items[0]?.prompt).toBe('new prompt')
  })
})
