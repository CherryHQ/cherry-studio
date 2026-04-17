import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../../model/types/paintingData'
import { usePaintingWorkspace } from '../usePaintingWorkspace'

const { mockUsePaintings, mockUseAllProviders } = vi.hoisted(() => ({
  mockUsePaintings: vi.fn(),
  mockUseAllProviders: vi.fn()
}))

vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: mockUsePaintings
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useAllProviders: mockUseAllProviders
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: vi.fn(async (prompt: string) => `en:${prompt}`)
}))

describe('usePaintingWorkspace', () => {
  const paintings: PaintingData[] = [
    { id: 'painting-1', prompt: 'first', files: [] },
    { id: 'painting-2', prompt: 'second', files: [{ id: 'file-1' } as any, { id: 'file-2' } as any] }
  ]

  const defaultPaintingData: PaintingData = { id: 'default-painting', prompt: '', files: [] }
  const createPainting = vi.fn((painting) => painting)
  const deletePainting = vi.fn()
  const updatePainting = vi.fn()
  const reorderPaintings = vi.fn()

  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    mockUseAllProviders.mockReset()
    mockUsePaintings.mockReset()
    createPainting.mockClear()
    deletePainting.mockClear()
    updatePainting.mockClear()
    reorderPaintings.mockClear()

    mockUseAllProviders.mockReturnValue([{ id: 'silicon' }])
    mockUsePaintings.mockReturnValue({
      items: paintings,
      isReady: true,
      createPainting,
      deletePainting,
      updatePainting,
      reorderPaintings
    })
  })

  it('should derive the current painting from selectedPaintingId', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    expect(result.current.painting.id).toBe('painting-1')

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    expect(result.current.selectedPaintingId).toBe('painting-2')
    expect(result.current.painting.id).toBe('painting-2')
  })

  it('should allow selecting another painting while generation is active', () => {
    MockUseCacheUtils.setCacheValue('chat.generating', true)

    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    expect(result.current.selectedPaintingId).toBe('painting-2')
    expect(result.current.painting.id).toBe('painting-2')
  })

  it('should fall back to default painting when the list is empty without creating', () => {
    mockUsePaintings.mockReturnValue({
      items: [],
      isReady: true,
      createPainting,
      deletePainting,
      updatePainting,
      reorderPaintings
    })

    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    expect(createPainting).not.toHaveBeenCalled()
    expect(result.current.painting.id).toBe('default-painting')
  })

  it('should update the selected painting instead of mutating a separate local copy', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    act(() => {
      result.current.patchPainting({ prompt: 'updated second' } as any)
    })

    expect(updatePainting).toHaveBeenCalledWith({
      id: 'painting-2',
      prompt: 'updated second',
      files: [{ id: 'file-1' }, { id: 'file-2' }]
    })
  })

  it('should patch the requested painting even after selection changes', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    act(() => {
      result.current.onSelectPainting(paintings[0] as any)
      result.current.patchPaintingById('painting-2', { prompt: 'patched offscreen' } as any)
    })

    expect(updatePainting).toHaveBeenCalledWith({
      id: 'painting-2',
      prompt: 'patched offscreen',
      files: [{ id: 'file-1' }, { id: 'file-2' }]
    })
  })

  it('should ignore late patches for a painting that was deleted', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.onDeletePainting(paintings[1] as any)
      result.current.patchPaintingById('painting-2', { prompt: 'late update' } as any)
    })

    expect(deletePainting).toHaveBeenCalledWith(paintings[1])
    expect(updatePainting).not.toHaveBeenCalledWith({
      id: 'painting-2',
      prompt: 'late update',
      files: [{ id: 'file-1' }, { id: 'file-2' }]
    })
    expect(createPainting).not.toHaveBeenCalledWith({
      id: 'painting-2',
      prompt: 'late update',
      files: [{ id: 'file-1' }, { id: 'file-2' }]
    })
  })

  it('should scope loading and fallback URLs to the painting that triggered them', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.setIsLoadingForPainting('painting-1', true)
      result.current.setFallbackUrlsForPainting('painting-1', ['https://example.com/image.png'])
      result.current.onSelectPainting(paintings[1] as any)
    })

    expect(result.current.painting.id).toBe('painting-2')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fallbackUrls).toEqual([])

    act(() => {
      result.current.onSelectPainting(paintings[0] as any)
    })

    expect(result.current.painting.id).toBe('painting-1')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.fallbackUrls).toEqual(['https://example.com/image.png'])
  })

  it('should reset the image index when adding a new painting', () => {
    const { result } = renderHook(() =>
      usePaintingWorkspace({
        providerId: 'silicon',
        mode: 'generate',
        createDefaultPaintingData: () => defaultPaintingData,
        onProviderChange: vi.fn()
      })
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
      result.current.nextImage()
    })

    expect(result.current.currentImageIndex).toBe(1)

    act(() => {
      result.current.handleAddPainting()
    })

    expect(result.current.selectedPaintingId).toBe('default-painting')
    expect(result.current.currentImageIndex).toBe(0)
  })

  it('should preserve selection separately for each provider and mode scope', () => {
    const { result, rerender } = renderHook(
      ({ providerId, mode }) =>
        usePaintingWorkspace({
          providerId,
          mode,
          createDefaultPaintingData: () => defaultPaintingData,
          onProviderChange: vi.fn()
        }),
      {
        initialProps: {
          providerId: 'silicon',
          mode: 'generate' as 'generate' | 'edit'
        }
      }
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    rerender({
      providerId: 'silicon',
      mode: 'edit' as 'generate' | 'edit'
    })

    expect(result.current.selectedPaintingId).toBe('painting-1')

    act(() => {
      result.current.onSelectPainting(paintings[0] as any)
    })

    rerender({
      providerId: 'silicon',
      mode: 'generate' as 'generate' | 'edit'
    })

    expect(result.current.selectedPaintingId).toBe('painting-2')
    expect(result.current.painting.id).toBe('painting-2')
  })
})
