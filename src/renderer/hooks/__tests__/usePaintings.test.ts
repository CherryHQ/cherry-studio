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

// usePaintings is now a transition shim over the unified `/creations` DataApi with `kind: 'image'`.
describe('usePaintings (creation/image shim)', () => {
  const record: PaintingRecord = {
    id: 'painting-1',
    kind: 'image',
    providerId: 'silicon',
    modelId: 'model-1',
    prompt: 'draw a cat',
    files: { output: ['file-1'], input: [] },
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('returns raw creation records without hydration', () => {
    MockUseDataApiUtils.mockQueryData('/creations', {
      items: [record],
      total: 1
    })

    const { result } = renderHook(() => usePaintings({ providerId: 'silicon' }))

    expect(result.current.records).toEqual([record])
    expect(result.current.total).toBe(1)
  })

  it('uses DataApi mutations for create (stamping kind=image), update, and delete', async () => {
    const createTrigger = vi.fn().mockResolvedValue(record)
    const updateTrigger = vi.fn().mockResolvedValue(record)
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)

    mockUseMutation.mockImplementation((method, path) => {
      if (method === 'POST' && path === '/creations') {
        return { trigger: createTrigger, isLoading: false, error: undefined }
      }
      if (method === 'PATCH' && path === '/creations/:id') {
        return { trigger: updateTrigger, isLoading: false, error: undefined }
      }
      if (method === 'DELETE' && path === '/creations/:id') {
        return { trigger: deleteTrigger, isLoading: false, error: undefined }
      }
      return { trigger: vi.fn(), isLoading: false, error: undefined }
    })

    const { result } = renderHook(() => usePaintings())
    const createDto: CreatePaintingDto = {
      id: 'painting-1',
      providerId: 'silicon',
      modelId: 'model-1',
      prompt: 'draw a cat',
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

    // The shim stamps kind:'image' onto the create body.
    expect(createTrigger).toHaveBeenCalledWith({ body: { ...createDto, kind: 'image' } })
    expect(updateTrigger).toHaveBeenCalledWith({ params: { id: 'painting-1' }, body: updateDto })
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'painting-1' } })
  })

  it('passes kind=image plus caller-provided query params to useQuery', async () => {
    MockUseDataApiUtils.mockQueryData('/creations', {
      items: [],
      total: 0
    })

    renderHook(() => usePaintings({ providerId: 'silicon' }))

    await waitFor(() => expect(mockUseQuery).toHaveBeenCalled())

    expect(mockUseQuery).toHaveBeenCalledWith('/creations', {
      query: {
        kind: 'image',
        providerId: 'silicon'
      }
    })
  })
})
