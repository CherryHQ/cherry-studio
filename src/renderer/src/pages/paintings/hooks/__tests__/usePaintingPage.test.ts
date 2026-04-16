import type { PaintingCanvas } from '@renderer/types'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePaintingPage } from '../usePaintingPage'

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

describe('usePaintingPage', () => {
  const paintings: PaintingCanvas[] = [
    { id: 'painting-1', prompt: 'first', files: [] },
    { id: 'painting-2', prompt: 'second', files: [{ id: 'file-1' } as any, { id: 'file-2' } as any] }
  ]

  const defaultPainting: PaintingCanvas = { id: 'default-painting', prompt: '', files: [] }
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
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
        onProviderChange: vi.fn()
      })
    )

    expect(createPainting).not.toHaveBeenCalled()
    expect(result.current.painting.id).toBe('default-painting')
  })

  it('should update the selected painting instead of mutating a separate local copy', () => {
    const { result } = renderHook(() =>
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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

  it('should scope loading and fallback URLs to the painting that triggered them', () => {
    const { result } = renderHook(() =>
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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
      usePaintingPage({
        providerId: 'silicon',
        mode: 'generate',
        getDefaultPainting: () => defaultPainting,
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
        usePaintingPage({
          providerId,
          mode,
          getDefaultPainting: () => defaultPainting,
          onProviderChange: vi.fn()
        }),
      {
        initialProps: {
          providerId: 'silicon',
          mode: 'generate' as const
        }
      }
    )

    act(() => {
      result.current.onSelectPainting(paintings[1] as any)
    })

    rerender({
      providerId: 'silicon',
      mode: 'edit' as const
    })

    expect(result.current.selectedPaintingId).toBe('painting-1')

    act(() => {
      result.current.onSelectPainting(paintings[0] as any)
    })

    rerender({
      providerId: 'silicon',
      mode: 'generate' as const
    })

    expect(result.current.selectedPaintingId).toBe('painting-2')
    expect(result.current.painting.id).toBe('painting-2')
  })
})
