import type { ImageGenerationSupport } from '@shared/data/types/model'
import { mockPrefetch } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'

const prefetchMock = mockPrefetch as unknown as {
  mockImplementation: (
    implementation: (path: string, options?: unknown) => Promise<ImageGenerationSupport | null>
  ) => void
  mockReset: () => void
}

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))

const initialPainting: PaintingData = {
  id: 'painting-1',
  providerId: 'silicon',
  mode: 'generate',
  model: 'old-model',
  prompt: '',
  files: [],
  params: { numImages: 2.5 }
}

describe('usePaintingModelSwitch', () => {
  beforeEach(() => {
    prefetchMock.mockReset()
  })

  it('validates and merges the latest params after support prefetch completes', async () => {
    let resolveNewSupport: (support: ImageGenerationSupport) => void = () => undefined
    const newSupport = new Promise<ImageGenerationSupport>((resolve) => {
      resolveNewSupport = resolve
    })
    prefetchMock.mockImplementation(async (_path, options) => {
      const modelId = (options as { params?: { modelId?: string } } | undefined)?.params?.modelId
      if (modelId === 'new-model') return newSupport
      return { modes: { generate: { supports: {} } } }
    })

    const { result } = renderHook(() => {
      const [painting, setPainting] = useState(initialPainting)
      const patchPainting = useCallback((updates: Partial<PaintingData>) => {
        setPainting((current) => ({ ...current, ...updates }))
      }, [])
      const switchModel = usePaintingModelSwitch({
        painting,
        onPaintingChange: patchPainting,
        ensureProviderCatalog: vi.fn()
      })
      return { painting, setPainting, switchModel }
    })

    let switchPromise: Promise<void> | undefined
    act(() => {
      switchPromise = result.current.switchModel({ providerId: 'silicon', modelId: 'new-model' })
    })
    act(() => {
      result.current.setPainting((current) => ({ ...current, params: { numImages: 2 } }))
    })

    await act(async () => {
      resolveNewSupport({
        modes: { generate: { supports: { numImages: { type: 'range', min: 1, max: 4, default: 1, step: 1 } } } }
      })
      await switchPromise
    })

    expect(result.current.painting.model).toBe('new-model')
    expect(result.current.painting.params).toEqual({ numImages: 2 })
  })
})
