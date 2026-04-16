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
    { id: 'painting-2', prompt: 'second', files: [] }
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
      files: []
    })
  })
})
