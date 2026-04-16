import type { FileMetadata } from '@renderer/types'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePaintings } from '../usePaintings'

const { mockGetFile, mockDeleteFiles } = vi.hoisted(() => ({
  mockGetFile: vi.fn(),
  mockDeleteFiles: vi.fn()
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    getFile: mockGetFile,
    deleteFiles: mockDeleteFiles
  }
}))

describe('usePaintings', () => {
  const file: FileMetadata = {
    id: 'file-1',
    name: 'file-1.png',
    origin_name: 'file-1.png',
    path: '/tmp/file-1.png',
    size: 10,
    ext: '.png',
    type: 'image',
    created_at: '2026-01-01T00:00:00.000Z',
    count: 1
  }

  const record: PaintingRecord = {
    id: 'painting-1',
    providerId: 'silicon',
    mode: 'generate',
    model: 'model-1',
    prompt: 'draw a cat',
    params: { guidanceScale: 4.5 },
    files: { output: ['file-1'], input: [] },
    parentId: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockDataApiUtils.resetMocks()
    mockGetFile.mockReset()
    mockDeleteFiles.mockReset()
    mockGetFile.mockResolvedValue(file)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should hydrate painting records into canvas items', async () => {
    MockUseDataApiUtils.mockQueryData('/paintings', {
      items: [record],
      total: 1,
      limit: 100,
      offset: 0
    })

    const { result } = renderHook(() => usePaintings({ providerId: 'silicon', mode: 'generate' }))

    await waitFor(() => expect(result.current.isReady).toBe(true))

    expect(result.current.items).toEqual([
      {
        id: 'painting-1',
        providerId: 'silicon',
        model: 'model-1',
        prompt: 'draw a cat',
        files: [file],
        guidanceScale: 4.5
      }
    ])
  })

  it('should create paintings and persist the latest update after debounce', async () => {
    vi.useFakeTimers()

    MockUseDataApiUtils.mockQueryData('/paintings', {
      items: [],
      total: 0,
      limit: 100,
      offset: 0
    })

    const { result } = renderHook(() => usePaintings({ providerId: 'silicon', mode: 'generate' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isReady).toBe(true)

    act(() => {
      result.current.createPainting({
        id: 'painting-new',
        prompt: 'draft prompt',
        model: 'model-2',
        files: []
      })
    })

    act(() => {
      result.current.updatePainting({
        id: 'painting-new',
        prompt: 'updated prompt',
        model: 'model-2',
        files: []
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const postCalls = MockDataApiUtils.getCalls('post')
    expect(postCalls[0]).toEqual([
      '/paintings',
      {
        body: {
          id: 'painting-new',
          providerId: 'silicon',
          mode: 'generate',
          model: 'model-2',
          prompt: 'draft prompt',
          params: {},
          files: { output: [], input: [] }
        }
      }
    ])

    expect(MockDataApiUtils.getCalls('patch')[0]).toEqual([
      '/paintings/painting-new',
      {
        body: {
          model: 'model-2',
          prompt: 'updated prompt',
          params: {},
          files: { output: [], input: [] }
        }
      }
    ])
  })

  it('should delete files and remove persisted paintings', async () => {
    MockUseDataApiUtils.mockQueryData('/paintings', {
      items: [record],
      total: 1,
      limit: 100,
      offset: 0
    })

    const { result } = renderHook(() => usePaintings({ providerId: 'silicon', mode: 'generate' }))

    await waitFor(() => expect(result.current.isReady).toBe(true))

    await act(async () => {
      await result.current.deletePainting(result.current.items[0])
    })

    expect(mockDeleteFiles).toHaveBeenCalledWith([file])
    expect(MockDataApiUtils.getCalls('delete')[0]).toEqual(['/paintings/painting-1'])
  })

  it('should not inject pagination params unless the caller provides them', async () => {
    MockUseDataApiUtils.mockQueryData('/paintings', {
      items: [],
      total: 0,
      limit: 20,
      offset: 0
    })

    renderHook(() => usePaintings({ providerId: 'silicon', mode: 'generate' }))

    await waitFor(() => expect(mockUseQuery).toHaveBeenCalled())

    expect(mockUseQuery).toHaveBeenCalledWith('/paintings', {
      query: {
        providerId: 'silicon',
        mode: 'generate'
      }
    })
  })
})
