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

  it('keeps the last same-provider model selected when support requests finish out of order', async () => {
    const supportResolvers = new Map<string, (support: ImageGenerationSupport) => void>()
    prefetchMock.mockImplementation(async (_path, options) => {
      const modelId = (options as { params?: { modelId?: string } } | undefined)?.params?.modelId
      if (modelId === 'old-model') return { modes: { generate: { supports: {} } } }
      return new Promise<ImageGenerationSupport>((resolve) => {
        supportResolvers.set(modelId ?? '', resolve)
      })
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
      return { painting, switchModel }
    })

    let firstSwitch: Promise<void> | undefined
    let secondSwitch: Promise<void> | undefined
    act(() => {
      firstSwitch = result.current.switchModel({ providerId: 'silicon', modelId: 'first-model' })
      secondSwitch = result.current.switchModel({ providerId: 'silicon', modelId: 'second-model' })
    })

    await act(async () => {
      supportResolvers.get('second-model')?.({ modes: { generate: { supports: {} } } })
      await secondSwitch
    })
    expect(result.current.painting.model).toBe('second-model')

    await act(async () => {
      supportResolvers.get('first-model')?.({ modes: { generate: { supports: {} } } })
      await firstSwitch
    })
    expect(result.current.painting.model).toBe('second-model')
  })

  it('preserves prompt edits made while a cross-provider catalog is loading', async () => {
    let resolveCatalog: (models: []) => void = () => undefined
    const ensureProviderCatalog = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveCatalog = resolve
        })
    )
    const { result } = renderHook(() => {
      const [painting, setPainting] = useState(initialPainting)
      const patchPainting = useCallback((updates: Partial<PaintingData>) => {
        setPainting((current) => ({ ...current, ...updates }))
      }, [])
      const switchModel = usePaintingModelSwitch({ painting, onPaintingChange: patchPainting, ensureProviderCatalog })
      return { painting, setPainting, switchModel }
    })

    let switchPromise: Promise<void> | undefined
    act(() => {
      switchPromise = result.current.switchModel({ providerId: 'dashscope', modelId: 'wan-model' })
    })
    act(() => {
      result.current.setPainting((current) => ({ ...current, prompt: 'edited while loading' }))
    })

    await act(async () => {
      resolveCatalog([])
      await switchPromise
    })

    expect(result.current.painting.providerId).toBe('dashscope')
    expect(result.current.painting.model).toBe('wan-model')
    expect(result.current.painting.prompt).toBe('edited while loading')
  })
})
