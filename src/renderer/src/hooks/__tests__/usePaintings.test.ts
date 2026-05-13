import type { CreatePaintingDto, UpdatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePaintings } from '../usePaintings'

vi.mock('@renderer/data/hooks/useReorder', () => ({
  useReorder: vi.fn(() => ({
    applyReorderedList: vi.fn(),
    isPending: false,
    move: vi.fn()
  }))
}))

describe('usePaintings', () => {
  const record: PaintingRecord = {
    id: 'painting-1',
    providerId: 'silicon',
    modelId: 'model-1',
    mode: 'generate',
    mediaType: 'image',
    prompt: 'draw a cat',
    params: { guidanceScale: 4.5 },
    files: { output: ['file-1'], input: [] },
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('returns raw painting records without hydration', () => {
    MockUseDataApiUtils.mockQueryData('/paintings', {
      items: [record],
      total: 1,
      limit: 100,
      offset: 0
    })

    const { result } = renderHook(() => usePaintings({ providerId: 'silicon', mode: 'generate' }))

    expect(result.current.records).toEqual([record])
    expect(result.current.total).toBe(1)
  })

  it('uses DataApi mutations for create, update, and delete', async () => {
    const createTrigger = vi.fn().mockResolvedValue(record)
    const updateTrigger = vi.fn().mockResolvedValue(record)
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)

    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/paintings') {
        return { trigger: createTrigger, isLoading: false, error: undefined }
      }
      if (method === 'PATCH' && path === '/paintings/:id') {
        return { trigger: updateTrigger, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/paintings/:id') {
        return { trigger: deleteTrigger, isLoading: false, error: undefined }
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined }
    })

    const { result } = renderHook(() => usePaintings())
    const createDto: CreatePaintingDto = {
      id: 'painting-1',
      providerId: 'silicon',
      modelId: 'model-1',
      mode: 'generate',
      mediaType: 'image',
      prompt: 'draw a cat',
      params: { guidanceScale: 4.5 },
      files: { output: [], input: [] }
    }
    const updateDto: UpdatePaintingDto = {
      prompt: 'updated',
      files: { output: ['file-1'], input: [] }
    }

    await act(async () => {
      await result.current.createPainting(createDto)
      await result.current.updatePainting('painting-1', updateDto)
      await result.current.deletePainting('painting-1')
    })

    expect(createTrigger).toHaveBeenCalledWith({ body: createDto })
    expect(updateTrigger).toHaveBeenCalledWith({ params: { id: 'painting-1' }, body: updateDto })
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'painting-1' } })
  })

  it('passes only caller-provided query params to useQuery', async () => {
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
